import {randomUUID} from 'node:crypto';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {startManualReviewFixture} from '../직접확인/호스트.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../../../src/providers/클로드.js';
import {semanticInputHash} from '../../../../src/providers/검수내용.js';
import type * as C from '../../../../src/shared/포트.js';

/** TEST ONLY: 실제 HTTP/Store/collector validator/worker/UI에 SDK 전송만 대역으로 제공합니다. */
export async function startFactRecoveryFixture(semanticFailures=0){
 const calls={collector:0,fetch:0,repair:0,semantic:0};
 const cleanup=(runId:string|null):C.CleanupReport=>({runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_OFFLINE_TEST',children:[]});
 const h=await startManualReviewFixture({
  createClaudeAdapter:options=>{
   let snapshot:C.ProjectSnapshot;
   const session=randomUUID(),fetchId=randomUUID(),sourceId=randomUUID();
   const query:QueryFactory=()=>{
    async function* stream(){
     calls.collector++;
     const current=snapshot.result!.cards,old=snapshot.sources[0]!,evidence='TEST_ONLY_CURRENT_EVIDENCE';
     const source={...old,sourceId,candidateId:snapshot.selectedCandidateIds[0]!,access:'opened' as const,accessedAt:new Date().toISOString(),evidence};
     const draft:C.FactProposalDraft={kind:'factReview',sources:[source],findings:[{claimIndex:0,cardIds:current.slice(0,6).map(c=>c.cardId),classification:'supported',reason:'[TEST] 수집 모델의 귀속 표현 제안이며 내용 판단은 별도 검수 대역이 합니다.',afterClaim:{...snapshot.claims[0]!,text:'[TEST] 매체에 귀속한 문장과 카드 요약은 표현이 다릅니다.',kind:'publisher_claim',sourceIds:[sourceId]},comparisons:[]}],cards:current.map(c=>({cardId:c.cardId,title:c.title,body:c.body+' [TEST 수정 후보]',sourceIds:[sourceId]}))};
     const messages:unknown[]=[
      {type:'system',subtype:'init',session_id:session,cwd:currentContext.cwd,tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:'claude-sonnet-5-5'},
      {type:'assistant',session_id:session,message:{role:'assistant',content:[{type:'tool_use',id:fetchId,name:'WebFetch',input:{url:source.url,prompt:'[TEST] 원문 처리 대역'}}]}},
      {type:'user',session_id:session,message:{role:'user',content:[{type:'tool_result',tool_use_id:fetchId,content:evidence}]},tool_use_result:{url:source.url,code:200,codeText:'OK',bytes:100,result:evidence,durationMs:1}},
      {type:'result',subtype:'success',session_id:session,is_error:false,queued_turn_count:0,permission_denials:[],structured_output:draft}
     ];
     for(const m of messages){if((m as {type:string}).type==='user')calls.fetch++;yield m as SDKMessage;}
    }
    return Object.assign(stream(),{close(){}});
   };
   let currentContext:C.EngineContext;
   const base=createOfflineClaudeAdapter(options,query);
   return {...base,async *start(context,input){currentContext=context;snapshot=(input as {snapshot:C.ProjectSnapshot}).snapshot;yield*base.start(context,input);}};
  },
  createFactLinkRepairer:()=>{let runId:string|null=null;return {
   async repair(context,input){runId=context.runId;calls.repair++;return {decision:{status:'repaired',links:[{claimIndex:0,cardIds:[input.draft.cards.at(-1)!.cardId]}],reason:'[TEST] 제공된 미확인 주장에 마지막 합성 카드의 연결을 추가합니다.'},actualModel:'claude-sonnet-5-5'};},
   async cancel(id){return cleanup(id);},async dispose(){return [cleanup(runId)];}
  };},
  createSemanticReviewer:options=>{let runId:string|null=null;return {
   async review(context,input){
    runId=context.runId;calls.semantic++;if(calls.semantic<=semanticFailures)throw Object.assign(Error('REVIEW_TIMEOUT'),{code:'REVIEW_TIMEOUT'});
    return {reviewer:options.selection,actualModel:options.selection.model??'claude-sonnet-5-5',reviewedAt:new Date().toISOString(),inputHash:semanticInputHash(input),verdict:'unverifiable',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[{cardId:input.cards[0]!.cardId,claimIndex:0,sourceIds:input.sources.map(s=>s.sourceId),message:'[TEST] 합성 자료이며 사실 검증 성공이 아닙니다.',suggestion:null}]};
   },async cancel(id){return cleanup(id);},async dispose(){return [cleanup(runId)];}
  };}
 },'부분복구');
 return {...h,recoveryCalls:calls};
}
