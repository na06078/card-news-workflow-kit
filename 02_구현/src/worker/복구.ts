import type {ClaimedJob,EngineContext,LeaseFence} from '../shared/포트.js';
import {workerError} from './실행단계.js';
import {persistedRevisionReady} from '../backend/재시도정책.js';
/** 저장된 session은 최신 세션 탐색/죽은 callback 복원이 아닙니다. 실제 pinned SDK resume 승인 검증 전 차단. */
export function assertRecoverySupported(context:EngineContext,fence:LeaseFence):void{if(context.engineSessionId)throw workerError('SESSION_RECOVERY_UNVERIFIED',fence);}
/** 이미 영속된 수정 내용 뒤 렌더가 실패한 명시 retry는 모델을 다시 부르지 않습니다. */
export function canReusePersistedRevision(job:ClaimedJob):boolean{
 if(job.run.revisionProtocol===2){
  const request=job.revision;
  return job.run.attempt>1&&!!request&&new Set(request.cardIds).size===request.cardIds.length&&persistedRevisionReady(job.run,job.snapshot,request);
 }
 return job.run.attempt>1&&persistedRevisionReady(job.run,job.snapshot,job.revision);
}
