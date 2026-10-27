import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareFactCheckpoint,applyFactLinkRepair,validateFactReview} from '../providers/사실재검증.js';
import {checkpointMatches} from '../backend/부분복구.js';
import {DEFAULT_FACT_REVIEWER} from '../shared/포트.js';
import {buildSemanticReviewInput,validateSemanticReport} from '../providers/검수내용.js';
import type * as C from '../shared/포트.js';
import {AppErrorSchema} from '../shared/포트.js';
import {ProviderFailure} from '../providers/오류.js';
import {workerError,normalizeError,validateEvent} from './실행단계.js';
import {produce,exportResult} from './제작.js';
import {bounded,waitForSettlement,cleanupAccepted} from './프로세스관리.js';
import {waitForStoredAnswer} from './질문대기.js';
import {assertRecoverySupported,canReusePersistedRevision} from './복구.js';
import {createWorkerHealth} from '../backend/실행상태.js';
function semanticProgressMessage(event:Parameters<NonNullable<C.SemanticReviewerOptions['onProgress']>>[0]):string{
 if(event.phase==='connected')return '검수 엔진 연결 확인';
 if(event.phase==='generating')return '검수 진행 프레임 수신 · 완료 응답 대기';
 if(event.phase==='result_received')return '검수 종료 응답 수신·형식/정리 확인 중';
 return event.status==='started'?'발행 예정 전체 원고의 LLM 의미 검수 시작':event.status==='completed'?'LLM 의미 검수 응답 확인':'LLM 의미 검수 실패';
}
/** 주입한 store/agy의 최종 close/dispose는 조립자 소유입니다. */
export const createWorker:C.CreateWorker=options=>{
 const store=options.store,clock=options.clock??(()=>new Date().toISOString()),leaseMs=options.leaseMs??30000;
 const health=createWorkerHealth(options.dataDir,options.ownerId,clock,Math.max(30000,leaseMs*2));let unavailable=false;
 let running=false,disposed=false,busy=false,shutdownRequested=false,loop:Promise<void>|null=null,active:{abort:AbortController;done:Promise<void>}|null=null;
 let idle=Promise.resolve(),releaseIdle:()=>void=()=>{};
 const pause=()=>new Promise<void>(r=>setTimeout(r,options.pollMs??100));
 const worker:C.Worker={
  async start(){if(disposed)throw Error('WORKER_DISPOSED');if(unavailable)throw Error('WORKER_UNAVAILABLE');if(running)return;shutdownRequested=false;running=true;loop=(async()=>{while(running){await worker.tick();if(running)await pause();}})();void loop.catch(()=>{running=false;});},
  async tick(){if(disposed||busy||shutdownRequested||unavailable)return false;if(!health.update('ready'))return false;busy=true;idle=new Promise<void>(r=>{releaseIdle=r;});
   try{await store.reconcile({now:clock()});const job=await store.claimJob({ownerId:options.ownerId,now:clock(),leaseMs,dataMode:options.dataMode});if(!job)return false;
    if(!health.update('busy'))throw Error('WORKER_UNAVAILABLE');const abort=new AbortController();if(shutdownRequested)abort.abort();const done=execute(job,abort);active={abort,done};try{await done;const completed=await store.getRun(job.run.runId);if(completed.error?.code==='CANCEL_CLEANUP_FAILED'){unavailable=true;running=false;if(!health.update('unavailable','CANCEL_CLEANUP_FAILED'))throw Error('WORKER_UNAVAILABLE');}}finally{active=null;}return true;
   }catch(error){unavailable=true;running=false;if(!health.update('unavailable',(error as {code?:string})?.code==='CANCEL_CLEANUP_FAILED'?'CANCEL_CLEANUP_FAILED':'WORKER_UNAVAILABLE'))throw Error('WORKER_UNAVAILABLE');throw error;
   }finally{busy=false;releaseIdle();if(!unavailable&&!health.update('ready')){unavailable=true;running=false;throw Error('WORKER_UNAVAILABLE');}}
  },
  async stop(){running=false;shutdownRequested=true;active?.abort.abort();try{await idle;await active?.done;await loop;}finally{loop=null;if(!unavailable)health.update('unavailable','WORKER_UNAVAILABLE');}},
  async dispose(){if(disposed)return;await worker.stop();disposed=true;}
 };return worker;
 async function execute(job:C.ClaimedJob,abort:AbortController){
  let fence=job.fence,adapter:C.ClaudeAdapter|undefined,terminal=false,providerResult=false,providerFailure:C.AppError|null=null;
  let providerStarted=false,agyStarted=false,renderStarted=false,collectorDisposed=false,reviewerDisposed=false,reviewerStarted=false,cleanupFailed=false;
  let repairer:C.FactLinkRepairer|undefined,repairStarted=false,repairDisposed=false;
  let repairMergeFailure:'unresolvable'|'invalid'|null=null;
  let reviewer:C.SemanticReviewer|undefined,staged:Extract<C.EngineContent,{kind:'factReview'}>|undefined;
  const disposeCollector=async()=>{if(!adapter||collectorDisposed)return;collectorDisposed=true;try{const reports=await bounded(adapter.dispose());if(job.run.kind==='factReview'&&providerStarted&&reports.length===0||reports.some(r=>!cleanupAccepted(r,fence.runId)))throw Error('CLEANUP_UNCONFIRMED');}catch{cleanupFailed=true;throw workerError('CANCEL_CLEANUP_FAILED',fence);}};
  const disposeReviewer=async()=>{if(!reviewer||reviewerDisposed)return;reviewerDisposed=true;try{const reports=await bounded(reviewer.dispose());if(reviewerStarted&&reports.length===0||reports.some(r=>!cleanupAccepted(r,fence.runId)))throw Error('CLEANUP_UNCONFIRMED');}catch{cleanupFailed=true;throw workerError('CANCEL_CLEANUP_FAILED',fence);}};
  const disposeRepairer=async()=>{if(!repairer||repairDisposed)return;repairDisposed=true;try{const reports=await bounded(repairer.dispose());if(repairStarted&&reports.length===0||reports.some(r=>!cleanupAccepted(r,fence.runId)))throw Error('CLEANUP_UNCONFIRMED');}catch{cleanupFailed=true;throw workerError('CANCEL_CLEANUP_FAILED',fence);}};
  const normalizeRunError=(error:unknown):C.AppError=>{
   const parsed=AppErrorSchema.safeParse(error);
   if(parsed.success&&parsed.data.code==='MODEL_UNAVAILABLE')return {...workerError('MODEL_UNAVAILABLE',fence),message:'선택한 모델을 사용할 수 없어 실행을 중단했습니다. 모델 목록과 계정 접근 권한을 확인해 주세요. 기본 모델로 전환하지 않았습니다.',retryable:false,nextActions:['contact_user']};
   const normalized=normalizeError(error,fence);
   if(repairMergeFailure&&['FACT_SCOPE_INVALID','FACT_REVIEW_FAILED'].includes(normalized.code))return {...normalized,message:repairMergeFailure==='unresolvable'?'기존 자료에서 연결을 확정하지 못했습니다. 보완 응답은 진단용으로 보존했으며 의미 검수는 시작하지 않았습니다.':'연결 보완의 참조·출처 검증에 실패했습니다. 보완 응답은 진단용으로 보존했으며 의미 검수는 시작하지 않았습니다.'};
   return normalized;
  };
  let unsettled=false;
  const wait=async<T>(promise:Promise<T>):Promise<T>=>{try{return await waitForSettlement(promise,abort.signal);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='WORKER_BOUNDARY_UNSETTLED')unsettled=true;throw error;}};
  let cancellation:Promise<C.CleanupReport[]>|null=null;
  const cancelOwned=()=>cancellation??=(async()=>{const reports:C.CleanupReport[]=[];
   if(providerStarted&&adapter&&!collectorDisposed)reports.push(await bounded(adapter.cancel(fence.runId)));
   if(repairStarted&&repairer&&!repairDisposed)reports.push(await bounded(repairer.cancel(fence.runId)));
   if(reviewerStarted&&reviewer&&!reviewerDisposed)reports.push(await bounded(reviewer.cancel(fence.runId)));
   if(agyStarted)reports.push(await bounded(options.agy.cancel(fence.runId)));return reports;})();
  const onAbort=()=>{void cancelOwned().catch(()=>{});};abort.signal.addEventListener('abort',onAbort,{once:true});
  let serial=Promise.resolve();
  const locked=<T>(fn:()=>Promise<T>):Promise<T>=>{const p=serial.then(fn);serial=p.then(()=>{},()=>{});return p;};
  const guard=async()=>{if(abort.signal.aborted||await store.isCancelRequested(fence)||!await store.heartbeat(fence,{now:clock(),leaseMs}))throw workerError('EXTERNAL_OUTCOME_UNKNOWN',fence);};
  const commit=async(value:C.WorkerCommit)=>locked(async()=>{if(value.type!=='failure'&&value.type!=='canceled')await guard();const out=await store.commit(fence,value);fence=out.fence;const run=await store.getRun(fence.runId);terminal=!['running','waiting_for_user','cancel_requested'].includes(run.status);return out.event;});
  const mark=async(phase:string,state:C.InvocationMark['state'],cardId:string|null=null,expectedPath:string|null=null,sha256:string|null=null)=>locked(async()=>{await guard();await store.journal(fence,{phase,state,cardId,expectedPath,sha256,at:clock()});});
  const checkContext=(context:C.EngineContext)=>{if(context.projectId!==fence.projectId||context.runId!==fence.runId||context.attempt!==fence.attempt||context.cwd!==job.context?.cwd)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);};
  const bridge:C.ProviderBridge={
   progress:async(c,event)=>locked(async()=>{checkContext(c);await guard();return store.appendEvent(fence,event);}),
   openQuestion:async(c,input)=>locked(async()=>{checkContext(c);await guard();const out=await store.saveQuestion(fence,input.question,input.mapping);fence=out.fence;return out.event;}),
   waitForAnswer:async(c,qid,version,signal)=>{checkContext(c);return waitForStoredAnswer({store,fence:()=>fence,adopt:next=>{fence=next;},guard,locked,pause,signal,workerSignal:abort.signal,questionId:qid,version});},
   publishResult:async(c,content)=>{checkContext(c);await mark(c.phase,'output_observed');await mark(c.phase,'validated');if(c.phase==='factReview'){if(content.kind!=='factReview'||staged)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);const {semanticReview:_ignored,...draft}=content;staged=structuredClone(draft);providerResult=true;return locked(async()=>{await guard();return store.appendEvent(fence,{type:'progress',phase:'factReview',message:'수집 근거와 수정 후보를 확인했습니다. 별도 의미 검수를 준비합니다.',completed:null,total:null,activity:{provider:'app',operation:'planning',status:'completed'}});});}const event=await commit({type:'content',content});if(!event)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);providerResult=true;return event;},
   publishError:async(c,error)=>{checkContext(c);providerFailure=normalizeRunError(error);return locked(async()=>{await guard();return store.appendEvent(fence,{type:'error',error:providerFailure!});});},
   saveFactCheckpoint:async(c,write)=>locked(async()=>{checkContext(c);await guard();await store.saveFactCheckpoint(fence,write);}),
   saveSession:async(c,id)=>locked(async()=>{checkContext(c);await guard();await store.saveSession(fence,id,c.cwd);}),
   status:id=>store.getRun(id)
  };
  let monitoring=false;
  const monitor=setInterval(()=>{if(monitoring||terminal)return;monitoring=true;void locked(async()=>{if(!health.update('busy')||await store.isCancelRequested(fence)||!await store.heartbeat(fence,{now:clock(),leaseMs}))abort.abort();}).catch(()=>abort.abort()).finally(()=>{monitoring=false;});},options.heartbeatMs??5000);
  try{
   await guard();
   if(job.run.kind==='research'||job.run.kind==='editorial'||job.run.kind==='revision'||job.run.kind==='factReview'){
    if(!job.context)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);
    const scope=job.revision?.scope;
    const persistedRevision=canReusePersistedRevision(job);
    const renderOnly=job.run.kind==='revision'&&scope==='layout'&&job.revision?.renderOnly===true;
    if(!job.factCheckpoint&&!persistedRevision&&!renderOnly&&(job.run.kind!=='revision'||scope==='storyboard'||scope==='text'||scope==='layout')){
     assertRecoverySupported(job.context,fence);
     await mark(job.context.phase,'prepared');await guard();adapter=options.createClaudeAdapter({...options.claudeOptions,bridge,signal:abort.signal});
     await mark(job.context.phase,'started');providerStarted=true;
     await wait((async()=>{for await(const event of adapter!.start(job.context!,job.revision?{snapshot:job.snapshot,request:job.revision}:{snapshot:job.snapshot})){validateEvent(event,fence);}})());
     if(providerFailure)throw providerFailure;if(!providerResult)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);
    }
     if(job.run.kind==='factReview'){
      if(job.factCheckpoint){
       const cp=job.factCheckpoint;
       if(!checkpointMatches(cp,job.snapshot)||cp.requestedModel!==(job.run.requestedModel??null))throw workerError('FACT_PROPOSAL_STALE',fence);
       const checked=prepareFactCheckpoint(cp.draft,job.snapshot,cp.receipts);
       if(checked.step!==cp.step)throw workerError('FACT_SCOPE_INVALID',fence);
       // Own the saved boundary on the child before any native call, including an unresolvable repair.
       await store.saveFactCheckpoint(fence,{...checked,...(cp.repairObservation?{repairObservation:cp.repairObservation}:{})});
       if(cp.step==='links'){
        if(!options.createFactLinkRepairer)throw workerError('FACT_REVIEW_FAILED',fence);
        const cwd=resolve(job.attemptDir,'fact-link-repair');await mkdir(cwd,{recursive:true});await mark('fact-link-repair','prepared');await guard();
        repairer=options.createFactLinkRepairer({...options.factLinkRepairerOptions,requestedModel:cp.requestedModel,livePermission:options.factLinkRepairerOptions?.livePermission??{inference:false},signal:abort.signal,clock,onProgress:async event=>{const actualModel=event.actualModel&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(event.actualModel)?event.actualModel:undefined;await locked(async()=>{await guard();await store.appendEvent(fence,{type:'progress',phase:'fact-link-repair',...(actualModel?{actualModel}:{}),message:event.status==='started'?'저장된 자료의 누락 연결만 보완합니다. 새 검색·수집은 하지 않습니다.':event.status==='completed'?'연결 보완 응답 수신 · 참조 검증 대기':'연결 보완 응답을 확인하지 못했습니다',completed:null,total:null,activity:{provider:'claude',operation:'planning',status:event.status}});});}});
        await mark('fact-link-repair','started');repairStarted=true;
        const output=await wait(repairer.repair({projectId:fence.projectId,runId:fence.runId,attempt:fence.attempt,cwd},{snapshot:job.snapshot,draft:cp.draft,issues:checked.issues}));
        const repairObservation:C.FactRepairObservation={decision:output.decision,actualModel:output.actualModel,observedAt:clock(),originRunId:fence.runId};
        await locked(async()=>{await guard();await store.saveFactCheckpoint(fence,{...checked,repairObservation});});
        await mark('fact-link-repair','output_observed');await disposeRepairer();await guard();
        try{staged=applyFactLinkRepair(job.snapshot,cp.draft,cp.receipts,output.decision);}catch(error){repairMergeFailure=output.decision.status==='unresolvable'?'unresolvable':'invalid';throw error;}await mark('fact-link-repair','validated');
        const {observations:_observations,semanticReview:_report,...draft}=staged;
        await locked(async()=>{await guard();await store.saveFactCheckpoint(fence,{...prepareFactCheckpoint(draft,job.snapshot,cp.receipts),repairObservation});});
       }else{
        const content=validateFactReview(cp.draft,job.snapshot,cp.receipts);if(content.kind!=='factReview')throw workerError('FACT_REVIEW_FAILED',fence);staged=content;
       }
      }
      await disposeCollector();await guard();
      if(!staged||!options.createSemanticReviewer)throw workerError('FACT_REVIEW_FAILED',fence);
      const selection=job.snapshot.factReview?.reviewer??DEFAULT_FACT_REVIEWER;
      const input=buildSemanticReviewInput(job.snapshot,staged),cwd=resolve(job.attemptDir,'semantic-review');await mkdir(cwd,{recursive:true});
      await mark('semantic-review','prepared');await guard();
      try{
       reviewer=options.createSemanticReviewer({...options.reviewerOptions,livePermission:options.reviewerOptions?.livePermission??{inference:false},selection,signal:abort.signal,clock,onProgress:async event=>{if(event.provider!==selection.provider)throw workerError('FACT_REVIEW_FAILED',fence);const actualModel=event.actualModel&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(event.actualModel)?event.actualModel:undefined;await locked(async()=>{await guard();await store.appendEvent(fence,{type:'progress',phase:'semantic-review',...(actualModel?{actualModel}:{}),message:semanticProgressMessage(event),completed:null,total:null,activity:{provider:event.provider,operation:'planning',status:event.status}});});}});
       await mark('semantic-review','started');reviewerStarted=true;
       const raw=await wait(reviewer.review({projectId:fence.projectId,runId:fence.runId,attempt:fence.attempt,cwd},input));
       await mark('semantic-review','output_observed');const report=validateSemanticReport(raw,input,selection);await mark('semantic-review','validated');
       await disposeReviewer();await guard();await commit({type:'content',content:{...staged,semanticReview:report}});
      }catch(error){const known=AppErrorSchema.safeParse(error);if(known.success&&['CANCEL_CLEANUP_FAILED','EXTERNAL_OUTCOME_UNKNOWN'].includes(known.data.code))throw error;if(error instanceof ProviderFailure)throw normalizeRunError(error);throw workerError('FACT_REVIEW_FAILED',fence);}
     }
   }
   const tools={fence:()=>fence,guard,commit,mark,wait,agyStarted:()=>{agyStarted=true;},renderStarted:()=>{renderStarted=true;},signal:abort.signal};
   if(job.run.kind==='production'||job.run.kind==='factApply'||(job.run.kind==='revision'&&job.revision?.scope!=='storyboard'))await produce(options,job,tools);
   if(job.run.kind==='export')await exportResult(options,job,tools);
   if(!terminal)throw workerError('STAGE_CONFLICT',fence);
  }catch(error){
   if(!terminal){try{await disposeCollector();}catch{cleanupFailed=true;}try{await disposeReviewer();}catch{cleanupFailed=true;}try{await disposeRepairer();}catch{cleanupFailed=true;}if(cleanupFailed)error=workerError('CANCEL_CLEANUP_FAILED',fence);}
   const run=await store.getRun(fence.runId);
   if(run.status==='cancel_requested'){
    abort.abort();
    try{const reports=await cancelOwned();
     const confirmed=!cleanupFailed&&!renderStarted&&!unsettled&&reports.every(r=>cleanupAccepted(r,fence.runId));
     await commit(confirmed?{type:'canceled',cleanupConfirmed:true}:{type:'failure',error:workerError('CANCEL_CLEANUP_FAILED',fence),externalOutcome:'unknown',retryAllowed:false});
    }catch{try{await commit({type:'failure',error:workerError('CANCEL_CLEANUP_FAILED',fence),externalOutcome:'unknown',retryAllowed:false});}catch{/* stale fence: never adopt latest */}}
   }else if(!terminal&&!shutdownRequested){try{
    let externalOutcome:C.Run['externalOutcome']=providerStarted||agyStarted||reviewerStarted||repairStarted?'unknown':'not_started';
    if(externalOutcome==='unknown'&&!unsettled){const reports=await cancelOwned();if(reports.length&&reports.every(r=>r.runId===fence.runId&&r.status==='not_started'&&r.children.length===0))externalOutcome='not_started';}
    if(job.run.kind==='factReview'&&!cleanupFailed&&!unsettled&&(collectorDisposed||job.factCheckpoint)&&(!reviewerStarted||reviewerDisposed)&&(!repairStarted||repairDisposed))externalOutcome='known';
    const normalized=normalizeRunError(error);await commit({type:'failure',error:normalized,externalOutcome,retryAllowed:normalized.code!=='SESSION_RECOVERY_UNVERIFIED'&&normalized.code!=='CANCEL_CLEANUP_FAILED'});}catch{/* stale owner cannot overwrite */}}
  }finally{clearInterval(monitor);abort.signal.removeEventListener('abort',onAbort);abort.abort();try{await disposeCollector();await disposeReviewer();await disposeRepairer();}catch{throw workerError('CANCEL_CLEANUP_FAILED',fence);}}
 }
};
