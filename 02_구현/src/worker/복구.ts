import type {ClaimedJob,EngineContext,LeaseFence} from '../shared/포트.js';
import {workerError} from './실행단계.js';
import {persistedRevisionReady} from '../backend/재시도정책.js';
/** 저장된 session은 최신 세션 탐색/죽은 callback 복원이 아닙니다. 실제 pinned SDK resume 승인 검증 전 차단. */
export function assertRecoverySupported(context:EngineContext,fence:LeaseFence):void{if(context.engineSessionId)throw workerError('SESSION_RECOVERY_UNVERIFIED',fence);}
/** 이미 영속된 수정 내용 뒤 렌더가 실패한 명시 retry는 모델을 다시 부르지 않습니다. */
export function canReusePersistedRevision(job:ClaimedJob):boolean{
 if(job.run.revisionProtocol===2){
  const applied=job.run.revisionApplied,request=job.revision,result=job.snapshot.result;
  return job.run.attempt>1&&job.run.kind==='revision'&&!!request&&request.scope!=='storyboard'&&!!result&&!!applied&&applied.resultVersion===result.version&&new Set(request.cardIds).size===request.cardIds.length&&applied.cardRevisions.length===request.cardIds.length&&new Set(applied.cardRevisions.map(c=>c.cardId)).size===applied.cardRevisions.length&&request.cardIds.every(id=>applied.cardRevisions.some(a=>a.cardId===id&&result.cards.some(c=>c.cardId===id&&c.revision===a.revision)));
 }
 return job.run.attempt>1&&persistedRevisionReady(job.run,job.snapshot,job.revision);
}
