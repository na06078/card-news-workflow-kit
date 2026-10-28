import {z} from 'zod';
import {createHash} from 'node:crypto';
import * as C from '../shared/포트.js';
import {factFingerprint} from './사실복구.js';
import {requireThat as must} from './도메인.js';
import {applyFactLinkRepair,prepareFactCheckpoint} from '../providers/사실재검증.js';
import {linkDiagnostic} from '../providers/연결진단.js';
const receipt=C.FactSourceObservationSchema.omit({sourceId:true}).extend({result:z.string().max(2*1024*1024).nullable()});
export const checkpointWriteSchema=z.strictObject({step:z.enum(['links','semantic']),draft:C.FactProposalDraftSchema,receipts:z.array(receipt).min(1).max(100),issues:z.array(C.FactIssueSchema).max(300),repairObservation:C.FactRepairObservationSchema.optional()});
export function checkedWrite(raw:C.FactCheckpointWrite,p:C.ProjectSnapshot):C.FactCheckpointWrite{
 const parsed=checkpointWriteSchema.safeParse(raw);must(parsed.success,'FACT_SCOPE_INVALID',p.projectId);
 const write=parsed.data;
 must(Buffer.byteLength(JSON.stringify(write))<=4*1024*1024,'FACT_SCOPE_INVALID',p.projectId);
 for(const r of write.receipts)if(r.outcome==='opened')must(r.result&&r.evidenceSha256===createHash('sha256').update(r.result).digest('hex')&&r.statusCode!==null&&r.statusCode>=200&&r.statusCode<300&&r.bytes!==null&&r.bytes>0,'FACT_SCOPE_INVALID',p.projectId);
 // Hash/HTTP metadata cannot be invented by public JSON. This is a trusted producer/operator boundary only.
 const recomputed:C.FactCheckpointWrite={...prepareFactCheckpoint(write.draft,p,write.receipts),...(write.repairObservation?{repairObservation:write.repairObservation}:{})};
 must(C.canonicalJson(write)===C.canonicalJson(recomputed),'FACT_SCOPE_INVALID',p.projectId);
 return recomputed;
}
export function checkpointMatches(cp:C.FactCheckpoint,p:C.ProjectSnapshot):boolean{
 const review=p.factReview;
 return !!review&&cp.projectId===p.projectId&&review.contentHash===cp.contentHash&&factFingerprint(p,review)===cp.contentHash&&review.storyboardVersion===p.storyboard?.version&&review.resultVersion===(p.result?.version??null);
}
export function checkpointSummary(cp:C.FactCheckpoint,p:C.ProjectSnapshot,r:C.Run,now:string,requestedModel:string|null):C.FactRecoverySummary{
 let reason:string|null=null;
 let step=cp.step,issues=structuredClone(cp.issues),reuseRepairObservation=false;
 // Dry validation never promotes or rewrites the stored checkpoint. The pending view
 // permits validation after proposal success without weakening the admission guards below.
 if(cp.step==='links'&&cp.repairObservation!==undefined){
  try{
   const pending={...p,factReview:p.factReview?{...p.factReview,state:'pending' as const}:undefined};
   const {step:storedStep,draft,receipts,issues:storedIssues,repairObservation}=cp;
   applyFactLinkRepair(pending,draft,receipts,repairObservation!.decision);
   checkedWrite({step:storedStep,draft,receipts,issues:storedIssues,repairObservation},pending);
   step='semantic';issues=[];reuseRepairObservation=true;
  }catch(error){
   const diagnostic=linkDiagnostic(error);reason=diagnostic.message;
   const selected=new Set(p.factReview?.cardIds??[]);
   const affected=cp.issues.flatMap(i=>i.cardIds).filter(id=>selected.has(id));
   const cardIds=[...new Set(affected.length?affected:[...selected])];
   issues=[{code:diagnostic.code,message:diagnostic.message,claimIndex:null,cardIds,sourceIds:[]}];
  }
 }
 if(!checkpointMatches(cp,p)||p.factReview?.runId!==r.runId||r.runId!==cp.sourceRunId||p.lastRun?.runId!==r.runId)reason='콘텐츠 또는 현재 실행이 저장 지점과 다릅니다.';
 else if(r.kind==='factReview'&&r.status==='succeeded'&&p.factReview?.state==='ready')reason='이미 검토 제안이 저장되어 재개할 필요가 없습니다.';
 else if(r.kind!=='factReview'||r.status!=='failed'||r.externalOutcome!=='known'||['CANCEL_CLEANUP_FAILED','EXTERNAL_OUTCOME_UNKNOWN'].includes(r.error?.code??''))reason='이전 실행의 종료·정리 상태를 확인할 수 없습니다.';
 else if(p.activeRun||p.question?.status==='open')reason='실행 중인 작업 또는 열린 질문이 있습니다.';
 else if(requestedModel!==cp.requestedModel||C.canonicalJson(p.factReview?.reviewer??C.DEFAULT_FACT_REVIEWER)!==C.canonicalJson(cp.reviewer))reason='저장된 모델·검수자 선택과 다릅니다.';
 else if(p.execution?.worker.state!=='ready')reason='작업자가 준비되어 있지 않습니다.';
 else if(p.execution?.queue)reason='다른 프로젝트의 작업이 진행 중입니다.';
 return {checkpointId:cp.checkpointId,sourceRunId:cp.sourceRunId,step,available:reason===null,reason,issues,...(reuseRepairObservation?{reuseRepairObservation:true}:{}),savedAt:cp.savedAt};
}
