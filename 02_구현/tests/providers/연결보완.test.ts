import {it,expect,vi} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import * as native from '../../src/providers/클로드검수.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import type {QueryFactory} from '../../src/providers/클로드.js';
it.each(['ok','web','wrong-model','auth','duplicate'])('연결 보완 추론 전용 same-child 경계 %s',async mode=>{
 expect(typeof (native as any).createOfflineClaudeFactLinkRepairer).toBe('function');
 const snapshot=createMockSnapshot('storyboard'),card=snapshot.storyboard!.cards[0],runId=randomUUID(),model='claude-sonnet-5-5';
 snapshot.claims=[{text:'기존 주장',kind:'uncertain',availability:'unknown',conditions:[],sourceIds:[]}];snapshot.factReview={runId,claimIndices:[0],cardIds:[card.cardId],state:'pending',baseVersion:snapshot.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),readyVersion:null,proposal:null};
 const input={snapshot,draft:{kind:'factReview',sources:[],findings:[{claimIndex:0,cardIds:[],classification:'unverifiable',reason:'미확인',afterClaim:snapshot.claims[0],comparisons:[]}],cards:[{cardId:card.cardId,title:card.title,body:card.body,sourceIds:[I.source]}]},issues:[{code:'FACT_CARD_LINK_MISSING',message:'누락',claimIndex:null,cardIds:[card.cardId],sourceIds:[]}]};
 const cwd=resolve('실행데이터/부분복구/backend/native',randomUUID());await mkdir(cwd,{recursive:true});const account={apiProvider:'firstParty',apiKeySource:'none',tokenSource:'oauth',subscriptionType:'Claude Team'},close=vi.fn();let prompts=0;
 const decision={status:'repaired',links:[{claimIndex:0,cardIds:[card.cardId]}],reason:'저장된 주장에만 연결'};
 const query:QueryFactory=({prompt,options})=>Object.assign((async function*(){
 expect(options!.tools).toEqual([]);expect(options!.resume).toBeUndefined();expect(options!.persistSession).toBe(false);expect(options!.model).toBe(model);
 const tool=await options!.canUseTool!('WebFetch',{url:'https://example.com'},{signal:new AbortController().signal,toolUseID:'x',requestId:'x'});expect(tool?.behavior).toBe('deny');
 if(typeof prompt!=='string')for await(const p of prompt){prompts++;expect(p.message.content).toContain('UNTRUSTED_DATA_JSON');}
 yield {type:'system',subtype:'init',session_id:runId,cwd,tools:['StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:mode==='wrong-model'?'other':model} as any;
 if(mode==='web')yield {type:'assistant',session_id:runId,message:{content:[{type:'tool_use',id:'x',name:'WebFetch',input:{url:'https://example.com'}}]}} as any;
 const result={type:'result',subtype:'success',session_id:runId,is_error:false,permission_denials:[],structured_output:decision};yield result as any;if(mode==='duplicate')yield result as any;
 })(),{close,initializationResult:async()=>({account}),accountInfo:async()=>mode==='auth'?{...account,apiKeySource:'api_key'}:account}) as never;
 const repairer=(native as any).createOfflineClaudeFactLinkRepairer({requestedModel:model,livePermission:{inference:true,approvalReference:'명시 offline fake'}},query);
 try{const call=repairer.repair({projectId:snapshot.projectId,runId,attempt:1,cwd},input);if(mode==='ok')expect(await call).toEqual({decision,actualModel:model});else await expect(call).rejects.toMatchObject({code:mode==='web'?'TOOL_PERMISSION_DENIED':mode==='wrong-model'?'MODEL_UNAVAILABLE':mode==='auth'?'AUTH_PATH_FORBIDDEN':'FACT_REVIEW_FAILED'});}finally{expect((await repairer.dispose())[0].status).toBe('confirmed');}
 expect(close).toHaveBeenCalledOnce();expect(prompts).toBe(mode==='auth'?0:1);
});
