import {it,expect,vi} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOfflineClaudeSemanticReviewer} from '../../src/providers/클로드검수.js';
import type {QueryFactory} from '../../src/providers/클로드.js';
import type {SemanticReviewInput} from '../../src/shared/포트.js';
const projectId='11111111-1111-4111-8111-111111111111',cardId='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333',model='claude-haiku-4-5-20251001';
it.each(['ok','wrong-model','tool','auth','quota','duplicate'])('도구 없는 Claude 검수의 실제 query 경계 %s',async mode=>{
 const cwd=resolve('실행데이터/실사용검수복구/모델선택/기존검수',randomUUID());await mkdir(cwd,{recursive:true});
 const input:SemanticReviewInput={projectId,cards:[{cardId,title:'합성',body:'사실 문장 아님',sourceIds:[]}],claims:[],sources:[]};
 const close=vi.fn(),account={apiProvider:'firstParty',apiKeySource:'none',tokenSource:'oauth',subscriptionType:'Claude Team'};
 const fake:QueryFactory=({prompt,options})=>Object.assign((async function*(){
  expect(options!.tools).toEqual([]);expect(options!.resume).toBeUndefined();expect(options!.model).toBe(model);
  if(typeof prompt!=='string')for await(const _ of prompt){}
  yield {type:'system',subtype:'init',session_id:sid,cwd,tools:['StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:mode==='wrong-model'?'other':model} as any;
  if(mode==='tool')yield {type:'assistant',session_id:sid,message:{content:[{type:'tool_use',id:'bad',name:'Read',input:{}}]}} as any;
  if(mode==='quota')yield {type:'rate_limit_event',session_id:sid,rate_limit_info:{status:'rejected'}} as any;
  const result={type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:{verdict:'supported',reviewedCardIds:[cardId],reviewedClaimIndices:[],issues:[]}};
  yield result as any;if(mode==='duplicate')yield result as any;
 })(),{close,initializationResult:async()=>({account}),accountInfo:async()=>mode==='auth'?{...account,apiKeySource:'api_key'}:account}) as never;
 const reviewer=createOfflineClaudeSemanticReviewer({selection:{provider:'claude',model},livePermission:{inference:true,approvalReference:'명시 시험'}},fake);
 try{const call=reviewer.review({projectId,runId:randomUUID(),attempt:1,cwd},input);if(mode==='ok')expect(await call).toMatchObject({verdict:'supported',actualModel:model});else await expect(call).rejects.toMatchObject({code:mode==='wrong-model'?'MODEL_UNAVAILABLE':mode==='tool'?'TOOL_PERMISSION_DENIED':mode==='auth'?'AUTH_PATH_FORBIDDEN':mode==='quota'?'SUBSCRIPTION_QUOTA':'FACT_REVIEW_FAILED'});}finally{await reviewer.dispose();}
 expect(close).toHaveBeenCalledOnce();
});
