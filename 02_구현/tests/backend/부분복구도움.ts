import {randomUUID} from 'node:crypto';
import {createWorkerHealth} from '../../src/backend/실행상태.js';
import {setup} from './도움.js';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {prepareFactCheckpoint,captureFetchReceipt} from '../../src/providers/사실재검증.js';
import type * as C from '../../src/shared/포트.js';
export async function prepared(health=true,reviewOptions:Pick<C.FactReviewRequest,'reviewer'|'reviewEffort'>={reviewer:'claude'}){const fixture=createMockSnapshot('selection');const state=await setup('1080x1080',[{text:'기존 수치',kind:'uncertain',sourceIds:[fixture.sources[0].sourceId],availability:'unknown',conditions:[]}],'실행데이터/연결쌍복구/서버/격리검사');
 if(health)createWorkerHealth(state.options.dataDir,randomUUID(),()=>new Date().toISOString()).update('ready');
 const {s,target,claim}=state,p=await s.getProject(target.projectId);
 await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.storyboard!.cards.map(c=>c.cardId),...reviewOptions});
 const job=await claim(),source={...p.sources[0],sourceId:randomUUID(),evidence:'확인된 수치 10',access:'opened' as const,accessedAt:new Date().toISOString()};
 const draft:C.FactProposalDraft={kind:'factReview',sources:[source],findings:[{claimIndex:0,cardIds:[p.storyboard!.cards[0].cardId],classification:'factual_error',reason:'테스트 정정',afterClaim:{...p.claims[0],text:source.evidence,kind:'verified',sourceIds:[source.sourceId]},comparisons:[]}],cards:p.storyboard!.cards.map(c=>({cardId:c.cardId,title:c.title,body:source.evidence,sourceIds:[source.sourceId]}))};
 const receipts=[captureFetchReceipt('f1',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,source.accessedAt)];
 return {...state,job,draft,receipts,p};}
export async function fail(s:C.Store,j:C.ClaimedJob){await s.commit(j.fence,{type:'failure',error:{code:'FACT_SCOPE_INVALID',message:'연결 누락',retryable:false,nextActions:['reverify_facts'],projectId:j.run.projectId,runId:j.run.runId,currentVersion:null,details:{}},externalOutcome:'known',retryAllowed:false});}
