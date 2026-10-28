import type {Run,RevisionRequest,ProjectSnapshot} from '../shared/포트.js';
/** API와 worker가 같은 영속 상태를 검사합니다. attempt는 접수 직전 부모/claim 이후 자식에서 다릅니다. */
export function persistedRevisionReady(run:Run,p:ProjectSnapshot,revision:RevisionRequest|null):boolean{
 if(run.revisionProtocol===2){
  const marker=run.revisionApplied;
  return run.kind==='revision'&&revision!==null&&revision.scope!=='storyboard'&&!!p.result&&!!marker&&marker.resultVersion===p.result.version&&marker.cardRevisions.length>0&&new Set(marker.cardRevisions.map(c=>c.cardId)).size===marker.cardRevisions.length&&marker.cardRevisions.every(c=>revision.cardIds.includes(c.cardId)&&p.result!.cards.some(current=>current.cardId===c.cardId&&current.revision===c.revision));
 }
 const scope=revision?.scope;
 return run.kind==='revision'&&(scope==='text'||scope==='layout')&&!!revision?.cardIds.length&&revision.cardIds.every(id=>p.result?.cards.some(c=>c.cardId===id&&(c.state==='ready'||c.state==='failed'&&c.error?.code==='RENDER_FAILED')));
}
export function freshEditorialAllowed(run:Run,revision:RevisionRequest|null,hasQuestion:boolean):boolean{
 if(run.kind==='revision'&&run.revisionProtocol===2&&revision&&revision.scope!=='storyboard')return !run.revisionApplied&&!run.revisionOutcome&&!hasQuestion&&run.retryAllowed&&run.questionId===null&&(run.status==='canceled'||run.status==='interrupted'||run.status==='failed'&&['TOOL_PERMISSION_DENIED','PROVIDER_PROTOCOL_ERROR','RESEARCH_FAILED','EXTERNAL_OUTCOME_UNKNOWN','RENDER_FAILED'].includes(run.error?.code??''))&&run.error?.code!=='CANCEL_CLEANUP_FAILED';
 return (run.kind==='editorial'||run.kind==='revision'&&revision?.scope==='storyboard')&&run.status==='failed'&&['TOOL_PERMISSION_DENIED','PROVIDER_PROTOCOL_ERROR','RESEARCH_FAILED'].includes(run.error?.code??'')&&run.retryAllowed&&run.questionId===null&&!hasQuestion;
}
