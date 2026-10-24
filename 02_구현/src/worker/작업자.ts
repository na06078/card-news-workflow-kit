import type * as C from '../shared/포트.js';
import {AppErrorSchema} from '../shared/포트.js';
import {workerError,normalizeError,validateEvent} from './실행단계.js';
import {produce,exportResult} from './제작.js';
import {bounded,waitForSettlement,cleanupAccepted} from './프로세스관리.js';
import {waitForStoredAnswer} from './질문대기.js';
import {assertRecoverySupported,canReusePersistedRevision} from './복구.js';
/** 주입한 store/agy의 최종 close/dispose는 조립자 소유입니다. */
export const createWorker:C.CreateWorker=options=>{
 const store=options.store,clock=options.clock??(()=>new Date().toISOString()),leaseMs=options.leaseMs??30000;
 let running=false,disposed=false,busy=false,shutdownRequested=false,loop:Promise<void>|null=null,active:{abort:AbortController;done:Promise<void>}|null=null;
 let idle=Promise.resolve(),releaseIdle:()=>void=()=>{};
 const pause=()=>new Promise<void>(r=>setTimeout(r,options.pollMs??100));
 const worker:C.Worker={
  async start(){if(disposed)throw Error('WORKER_DISPOSED');if(running)return;shutdownRequested=false;running=true;loop=(async()=>{while(running){await worker.tick();if(running)await pause();}})();void loop.catch(()=>{running=false;});},
  async tick(){if(disposed||busy||shutdownRequested)return false;busy=true;idle=new Promise<void>(r=>{releaseIdle=r;});
   try{await store.reconcile({now:clock()});const job=await store.claimJob({ownerId:options.ownerId,now:clock(),leaseMs,dataMode:options.dataMode});if(!job)return false;
    const abort=new AbortController();if(shutdownRequested)abort.abort();const done=execute(job,abort);active={abort,done};try{await done;}finally{active=null;}return true;
   }finally{busy=false;releaseIdle();}
  },
  async stop(){running=false;shutdownRequested=true;active?.abort.abort();await idle;await active?.done;await loop;loop=null;},
  async dispose(){if(disposed)return;await worker.stop();disposed=true;}
 };return worker;
 async function execute(job:C.ClaimedJob,abort:AbortController){
  let fence=job.fence,adapter:C.ClaudeAdapter|undefined,terminal=false,providerResult=false,providerFailure:C.AppError|null=null;
  let providerStarted=false,agyStarted=false,renderStarted=false;
  const normalizeRunError=(error:unknown):C.AppError=>{
   const parsed=AppErrorSchema.safeParse(error);
   if(parsed.success&&parsed.data.code==='MODEL_UNAVAILABLE')return {...workerError('MODEL_UNAVAILABLE',fence),message:'선택한 모델을 사용할 수 없어 실행을 중단했습니다. 모델 목록과 계정 접근 권한을 확인해 주세요. 기본 모델로 전환하지 않았습니다.',retryable:false,nextActions:['contact_user']};
   return normalizeError(error,fence);
  };
  let unsettled=false;
  const wait=async<T>(promise:Promise<T>):Promise<T>=>{try{return await waitForSettlement(promise,abort.signal);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='WORKER_BOUNDARY_UNSETTLED')unsettled=true;throw error;}};
  let cancellation:Promise<C.CleanupReport[]>|null=null;
  const cancelOwned=()=>cancellation??=(async()=>{const reports:C.CleanupReport[]=[];
   if(providerStarted&&adapter)reports.push(await bounded(adapter.cancel(fence.runId)));
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
   publishResult:async(c,content)=>{checkContext(c);await mark(c.phase,'output_observed');await mark(c.phase,'validated');const event=await commit({type:'content',content});if(!event)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);providerResult=true;return event;},
   publishError:async(c,error)=>{checkContext(c);providerFailure=normalizeRunError(error);return locked(async()=>{await guard();return store.appendEvent(fence,{type:'error',error:providerFailure!});});},
   saveSession:async(c,id)=>locked(async()=>{checkContext(c);await guard();await store.saveSession(fence,id,c.cwd);}),
   status:id=>store.getRun(id)
  };
  let monitoring=false;
  const monitor=setInterval(()=>{if(monitoring||terminal)return;monitoring=true;void locked(async()=>{if(await store.isCancelRequested(fence)||!await store.heartbeat(fence,{now:clock(),leaseMs}))abort.abort();}).catch(()=>abort.abort()).finally(()=>{monitoring=false;});},options.heartbeatMs??5000);
  try{
   await guard();
   if(job.run.kind==='research'||job.run.kind==='editorial'||job.run.kind==='revision'){
    if(!job.context)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);
    const scope=job.revision?.scope;
    const persistedRevision=canReusePersistedRevision(job);
    if(!persistedRevision&&(job.run.kind!=='revision'||scope==='storyboard'||scope==='text'||scope==='layout')){
     assertRecoverySupported(job.context,fence);
     await mark(job.context.phase,'prepared');await guard();adapter=options.createClaudeAdapter({...options.claudeOptions,bridge,signal:abort.signal});
     await mark(job.context.phase,'started');providerStarted=true;
     await wait((async()=>{for await(const event of adapter!.start(job.context!,job.revision?{snapshot:job.snapshot,request:job.revision}:{snapshot:job.snapshot})){validateEvent(event,fence);}})());
     if(providerFailure)throw providerFailure;if(!providerResult)throw workerError('PROVIDER_PROTOCOL_ERROR',fence);
    }
   }
   const tools={fence:()=>fence,guard,commit,mark,wait,agyStarted:()=>{agyStarted=true;},renderStarted:()=>{renderStarted=true;},signal:abort.signal};
   if(job.run.kind==='production'||(job.run.kind==='revision'&&job.revision?.scope!=='storyboard'))await produce(options,job,tools);
   if(job.run.kind==='export')await exportResult(options,job,tools);
   if(!terminal)throw workerError('STAGE_CONFLICT',fence);
  }catch(error){
   const run=await store.getRun(fence.runId);
   if(run.status==='cancel_requested'){
    abort.abort();
    try{const reports=await cancelOwned();
     const confirmed=!renderStarted&&!unsettled&&reports.every(r=>cleanupAccepted(r,fence.runId));
     await commit(confirmed?{type:'canceled',cleanupConfirmed:true}:{type:'failure',error:workerError('CANCEL_CLEANUP_FAILED',fence),externalOutcome:'unknown',retryAllowed:false});
    }catch{try{await commit({type:'failure',error:workerError('CANCEL_CLEANUP_FAILED',fence),externalOutcome:'unknown',retryAllowed:false});}catch{/* stale fence: never adopt latest */}}
   }else if(!terminal&&!shutdownRequested){try{
    let externalOutcome:C.Run['externalOutcome']=providerStarted||agyStarted?'unknown':'not_started';
    if(externalOutcome==='unknown'&&!unsettled){const reports=await cancelOwned();if(reports.length&&reports.every(r=>r.runId===fence.runId&&r.status==='not_started'&&r.children.length===0))externalOutcome='not_started';}
    await commit({type:'failure',error:normalizeRunError(error),externalOutcome,retryAllowed:true});}catch{/* stale owner cannot overwrite */}}
  }finally{clearInterval(monitor);abort.signal.removeEventListener('abort',onAbort);abort.abort();if(adapter){const reports=await bounded(adapter.dispose());if(reports.some(r=>!cleanupAccepted(r,fence.runId)))throw workerError('CANCEL_CLEANUP_FAILED',fence);}}
 }
};
