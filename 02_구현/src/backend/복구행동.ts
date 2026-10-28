import type {ProjectSnapshot,NextAction} from '../shared/포트.js';
import {canManuallyApprove} from '../shared/포트.js';
import {applyFactProposal} from './사실복구.js';
/** 서버가 실제로 접수할 수 있는 복구 경로만 공개합니다. */
export function recoveryActions(p:ProjectSnapshot):NextAction[]{
 let actions=[...p.allowedActions];if(p.factRecovery?.available)actions.push('resume_fact_review');
 if(canManuallyApprove(p))actions.push('approve_final');
 if(!p.activeRun&&p.question?.status!=='open'){
  if(p.lastRun?.revisionProtocol===2&&['failed','interrupted','canceled'].includes(p.lastRun.status)&&p.lastRun.retryAllowed)actions.push('retry');
  if(p.storyboard&&p.claims.length&&['storyboard','production','review','export'].includes(p.stage))actions.push('reverify_facts');
  if(p.stage==='production'&&p.status==='error'&&p.result?.cards.some(c=>c.state==='failed'))actions.push('revise');
  if(p.result&&p.stage==='export'&&p.result.finalApprovedVersion===p.result.version&&p.result.cards.every(c=>c.state==='ready'))actions.push('rebuild_exports');
  if(p.factReview?.state==='ready'&&p.lastRun?.runId===p.factReview.runId&&p.lastRun.status==='succeeded')try{applyFactProposal(structuredClone(p),{requestId:p.factReview.runId,version:p.projectVersion,reviewRunId:p.factReview.runId});actions.push('apply_fact_proposal');}catch{/* 오래되거나 무효인 제안은 적용 가능하다고 표시하지 않습니다. */}
 }
 if(p.execution?.worker.state==='unavailable')actions=actions.filter(a=>a==='cancel'||a==='answer');
 return [...new Set(actions)];
}
