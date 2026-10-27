import {z} from 'zod';
import {makeFactLinkRepairer} from './연결보완.js';
import type {FactLinkRepairerOptions,FactLinkRepairer} from '../shared/포트.js';
import {FactLinkRepairDecisionSchema} from '../shared/포트.js';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {Options} from '@anthropic-ai/claude-agent-sdk';
import type {QueryFactory} from './클로드.js';
import type {ReviewContext,SemanticReviewInput,SemanticReviewerOptions,SemanticReviewer} from '../shared/포트.js';
import {SemanticReviewDecisionSchema} from '../shared/포트.js';
import {inspectAccountMetadata} from './구독검증.js';
import {childEnvironment,assertChildEnvironment} from './자식환경.js';
import {ownedDescendantsExited} from './프로세스격리.js';
import {trackOwnedChild,childrenReport,report,bounded} from './정리증거.js';
import {fail} from './오류.js';
import {matchesReviewModel} from './검수내용.js';
import {makeReviewer,reviewPrompt,reviewDecisionJsonSchema,abortable,checkAborted,type ReviewTransport} from './의미검수.js';

/** Separate fresh query: no source-collection session, tools, bridge or approval mutations. */
export async function openClaudeReview(context:ReviewContext,input:SemanticReviewInput,options:SemanticReviewerOptions,signal:AbortSignal,fakeQuery?:QueryFactory):Promise<ReviewTransport>{
 return openClaudeStructured(context,{prompt:reviewPrompt(input),schema:reviewDecisionJsonSchema,valid:raw=>SemanticReviewDecisionSchema.safeParse(raw).success},options,signal,fakeQuery);
}
/** Same-child subscription and owned-process transport shared by two inference-only roles. */
export async function openClaudeStructured(context:ReviewContext,role:{prompt:string;schema:Record<string,unknown>;valid:(raw:unknown)=>boolean},options:SemanticReviewerOptions,signal:AbortSignal,fakeQuery?:QueryFactory):Promise<ReviewTransport>{
 let queryHandle:ReturnType<QueryFactory>|undefined,closed=false,opened=false;
 const tracked:ReturnType<typeof trackOwnedChild>[]=[],exits:Promise<void>[]=[];
 const controller=new AbortController(),onAbort=()=>controller.abort();signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
 return {async execute(){
  checkAborted(signal);
  if(options.selection.provider!=='claude')fail('PROVIDER_PROTOCOL_ERROR');
  if(!fakeQuery&&await ownedDescendantsExited()!==true)fail('PROCESS_SCOPE_UNVERIFIED');
  const prompt=role.prompt;if(Buffer.byteLength(prompt)>2*1024*1024)fail('FACT_REVIEW_FAILED');
  let release:(allowed:boolean)=>void=()=>{};
  const promptGate=new Promise<boolean>(r=>{release=r;});
  const permitted=(name:string,args:unknown)=>name==='StructuredOutput'&&role.valid(args);
  const sdkOptions:Options={cwd:context.cwd,model:options.selection.model??undefined,abortController:controller,env:childEnvironment(),settingSources:[],strictMcpConfig:true,mcpServers:{},plugins:[],tools:[],permissionMode:'default',persistSession:false,maxTurns:4,
   settings:{autoMemoryEnabled:false,disableAllHooks:true,forceLoginMethod:'claudeai',apiKeyHelper:''},outputFormat:{type:'json_schema',schema:role.schema},
   hooks:{PreModelSwitch:[{hooks:[async()=>({hookSpecificOutput:{hookEventName:'PreModelSwitch' as const,permissionDecision:'deny' as const,permissionDecisionReason:'검수 모델 자동 전환 금지'}})]}],PreToolUse:[{hooks:[async hook=>hook.hook_event_name==='PreToolUse'&&permitted(hook.tool_name,hook.tool_input)?{}:{hookSpecificOutput:{hookEventName:'PreToolUse' as const,permissionDecision:'deny' as const,permissionDecisionReason:'검수는 제공된 자료만 읽습니다'}}]}]},
   canUseTool:async(name,args)=>permitted(name,args)?{behavior:'allow',updatedInput:args}:{behavior:'deny',message:'검수 도구 사용 금지',interrupt:true},
   spawnClaudeCodeProcess:spawnOptions=>{
    if(fakeQuery)fail('AUTH_PATH_FORBIDDEN');checkAborted(signal);assertChildEnvironment(spawnOptions.env);
    if(resolve(spawnOptions.cwd??'')!==resolve(context.cwd))fail('PROVIDER_PROTOCOL_ERROR');
    const child=spawn(spawnOptions.command,spawnOptions.args,{cwd:spawnOptions.cwd,env:spawnOptions.env,signal:spawnOptions.signal,shell:false,stdio:['pipe','pipe','pipe'],windowsHide:true});
    tracked.push(trackOwnedChild(child));exits.push(new Promise<void>(ok=>{child.once('close',()=>ok());child.once('error',()=>ok());}));return child;
   }
  };
  async function* messages(){if(await promptGate){checkAborted(signal);yield {type:'user' as const,message:{role:'user' as const,content:prompt},parent_tool_use_id:null,session_id:''};}}
  try{
   const open=fakeQuery??(await import('@anthropic-ai/claude-agent-sdk')).query;
   queryHandle=open({prompt:messages(),options:sdkOptions});opened=true;
   if(!queryHandle.initializationResult||!queryHandle.accountInfo)fail('AUTH_MODE_UNKNOWN');
   await abortable((async()=>{inspectAccountMetadata((await queryHandle!.initializationResult!()).account);inspectAccountMetadata(await queryHandle!.accountInfo!());})(),signal,25000);
   release(true);
   let sessionId:string|null=null,initialized=false,observedModel:string|null=null,result:unknown,hasResult=false,bytes=0;
   for await(const message of queryHandle){
    checkAborted(signal);bytes+=Buffer.byteLength(JSON.stringify(message));if(bytes>2*1024*1024)fail('FACT_REVIEW_FAILED');
    if('session_id'in message&&typeof message.session_id==='string'){if(sessionId&&sessionId!==message.session_id)fail('PROVIDER_PROTOCOL_ERROR');sessionId=message.session_id;}
    if(message.type==='system'&&message.subtype==='init'){
     if(initialized||!sessionId||resolve(message.cwd)!==resolve(context.cwd)||message.mcp_servers.length||message.permissionMode!=='default'||message.apiKeySource!=='none'||message.tools.some(tool=>tool!=='StructuredOutput'))fail('TOOL_PERMISSION_DENIED');
     observedModel=message.model??null;if(!matchesReviewModel(options.selection,observedModel))fail('MODEL_UNAVAILABLE');initialized=true;
    }else if(message.type==='assistant'){
     if(message.error==='rate_limit')fail('SUBSCRIPTION_QUOTA');if(message.error==='authentication_failed')fail('LOGIN_REQUIRED');if(message.error)fail('FACT_REVIEW_FAILED');
     if(!initialized)fail('PROVIDER_PROTOCOL_ERROR');
     for(const block of message.message.content)if(block.type==='tool_use'&&!permitted(block.name,block.input))fail('TOOL_PERMISSION_DENIED');
    }else if(message.type==='rate_limit_event'){
     const rate=message.rate_limit_info;if(rate.isUsingOverage||rate.overageInUse||rate.overageEnabled)fail('AUTH_PATH_FORBIDDEN');if(rate.status==='rejected')fail('SUBSCRIPTION_QUOTA');
    }else if(message.type==='auth_status')fail('AUTH_MODE_UNKNOWN');
    else if(message.type==='result'){
     if(!initialized||hasResult||message.subtype!=='success'||message.is_error||message.permission_denials?.length||(message.queued_turn_count??0)>0)fail('FACT_REVIEW_FAILED');
     result=message.structured_output;hasResult=true;
    }
   }
   if(!hasResult)fail('FACT_REVIEW_FAILED');return {decision:result,actualModel:observedModel};
  }finally{release(false);}
 },async cleanup(){
  signal.removeEventListener('abort',onAbort);let failed=false;
  if(!closed){closed=true;try{queryHandle?.close();}catch{failed=true;}}
  controller.abort();try{await bounded(Promise.all(exits));}catch{failed=true;}
  if(fakeQuery)return report(context.runId,failed?'failed':'confirmed','EXPLICIT_FAKE_QUERY_NO_CHILD');
  const children=await Promise.all(tracked.map(child=>child.cleanup()));
  if(!children.length)return report(context.runId,opened?'unknown':'not_started',opened?'REVIEW_QUERY_CHILD_NOT_OBSERVED':'QUERY_NOT_STARTED');
  return childrenReport(context.runId,children,failed);
 }};
}
export function createClaudeFactLinkRepairer(options:FactLinkRepairerOptions):FactLinkRepairer{return makeFactLinkRepairer(options,false,openClaudeStructured);}
export function createOfflineClaudeFactLinkRepairer(options:FactLinkRepairerOptions,query:QueryFactory):FactLinkRepairer{return makeFactLinkRepairer(options,true,(c,role,o,s)=>openClaudeStructured(c,role,o,s,query));}
export function createOfflineClaudeSemanticReviewer(options:SemanticReviewerOptions,query:QueryFactory):SemanticReviewer {
 return makeReviewer(options,true,(context,input,signal)=>openClaudeReview(context,input,options,signal,query));
}
