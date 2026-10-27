import {it,expect,vi} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOfflineClaudeSemanticReviewer} from '../../src/providers/클로드검수.js';
import type {QueryFactory} from '../../src/providers/클로드.js';
import type {SemanticReviewInput} from '../../src/shared/포트.js';

const projectId='11111111-1111-4111-8111-111111111111',cardId='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
it.each([
 ['sonnet','sonnet','MODEL_UNAVAILABLE'],['unknown','unknown','MODEL_UNAVAILABLE'],
 ['sonnet','claude-opus-5-5','MODEL_UNAVAILABLE'],['unknown','claude-sonnet-5-5','MODEL_UNAVAILABLE'],
 ['claude-sonnet-5-5','claude-sonnet-5','MODEL_UNAVAILABLE'],['sonnet','claude-sonnet-5-5-extra','MODEL_UNAVAILABLE'],
 ['sonnet','claude-sonnet-5-5','TOOL_PERMISSION_DENIED'],['sonnet',null,null],
] as const)('query 선택 %s / 관측 %s / 차단 %s는 fallback 없이 검사된다',async(model,observed,error)=>{
 const cwd=resolve('실행데이터/실사용검수복구/모델선택/부정경계',randomUUID());await mkdir(cwd,{recursive:true});
 const input:SemanticReviewInput={projectId,cards:[{cardId,title:'합성',body:'오프라인 경계',sourceIds:[]}],claims:[],sources:[]};
 const account={apiProvider:'firstParty',apiKeySource:'none',tokenSource:'oauth',subscriptionType:'Claude Team'},close=vi.fn();
 const fake:QueryFactory=vi.fn(({prompt,options})=>Object.assign((async function*(){
  expect(options!.model).toBe(model);if(typeof prompt!=='string')for await(const _ of prompt){}
  yield {type:'system',subtype:'init',session_id:sid,cwd,tools:['StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',...(observed===null?{}:{model:observed})} as any;
  if(error==='TOOL_PERMISSION_DENIED')yield {type:'assistant',session_id:sid,message:{content:[{type:'tool_use',id:'malicious',name:'WebSearch',input:{query:'must not run'}}]}} as any;
  yield {type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:{verdict:'supported',reviewedCardIds:[cardId],reviewedClaimIndices:[],issues:[]}} as any;
 })(),{close,initializationResult:async()=>({account}),accountInfo:async()=>account}) as never);
 const selection={provider:'claude' as const,model},reviewer=createOfflineClaudeSemanticReviewer({selection,livePermission:{inference:true,approvalReference:'오프라인 부정경계'}},fake);
 try{
  const call=reviewer.review({projectId,runId:randomUUID(),attempt:1,cwd},input);
  if(error)await expect(call).rejects.toMatchObject({code:error});
  else expect(await call).toMatchObject({reviewer:selection,actualModel:null});
 }finally{await reviewer.dispose();}
 expect(fake).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it('sonnet 선택은 같은 query의 구독 확인·모델전환 거절을 유지하며 실제 init ID로 보고된다',async()=>{
 const cwd=resolve('실행데이터/실사용검수복구/모델선택/별칭',randomUUID());await mkdir(cwd,{recursive:true});
 const input:SemanticReviewInput={projectId,cards:[{cardId,title:'합성',body:'별칭 경계 시험',sourceIds:[]}],claims:[],sources:[]};
 const close=vi.fn(),account={apiProvider:'firstParty',apiKeySource:'none',tokenSource:'oauth',subscriptionType:'Claude Team'};
 const initialize=vi.fn(async()=>({account})),accountInfo=vi.fn(async()=>account);
 const fake:QueryFactory=vi.fn(({prompt,options})=>Object.assign((async function*(){
  expect(initialize).toHaveBeenCalledOnce();expect(accountInfo).toHaveBeenCalledOnce();
  expect(options!.model).toBe('sonnet');expect(options!.tools).toEqual([]);expect(options!.resume).toBeUndefined();expect(options!.persistSession).toBe(false);
  const hook=options!.hooks!.PreModelSwitch![0]!.hooks[0]!;
  expect(await hook({hook_event_name:'PreModelSwitch',session_id:sid,cwd,transcript_path:'offline',source:'sdk',model:'claude-opus-5-5'} as any,undefined,{signal:new AbortController().signal})).toMatchObject({hookSpecificOutput:{hookEventName:'PreModelSwitch',permissionDecision:'deny'}});
  if(typeof prompt!=='string')for await(const _ of prompt){}
  yield {type:'system',subtype:'init',session_id:sid,cwd,tools:['StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:'claude-sonnet-5-5'} as any;
  yield {type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:{verdict:'supported',reviewedCardIds:[cardId],reviewedClaimIndices:[],issues:[]}} as any;
 })(),{close,initializationResult:initialize,accountInfo}) as never);
 const selection={provider:'claude' as const,model:'sonnet'};
 const reviewer=createOfflineClaudeSemanticReviewer({selection,livePermission:{inference:true,approvalReference:'오프라인 대역 시험'}},fake);
 try{expect(await reviewer.review({projectId,runId:randomUUID(),attempt:1,cwd},input)).toMatchObject({verdict:'supported',reviewer:selection,actualModel:'claude-sonnet-5-5'});}finally{await reviewer.dispose();}
 expect(fake).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(selection.model).toBe('sonnet');
});
