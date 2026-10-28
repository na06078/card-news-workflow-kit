import type {CardLayout,CardRevision,RevisionDecision,RevisionPatch,RevisionRequest,ProjectSnapshot} from './계약.js';
import {RevisionDecisionSchema} from './검증.js';

export const DEFAULT_CARD_LAYOUT:Readonly<CardLayout>={fontScale:'normal',textAlign:'left',placement:'bottom'};
export class RevisionDecisionError extends Error {
 readonly code='PROVIDER_PROTOCOL_ERROR';
 constructor(){super('카드 수정 응답이 요청한 범위와 맞지 않습니다.');this.name='RevisionDecisionError';}
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** metadata가 아니라 허용된 표현 필드만 비교합니다. 기본 layout은 의미상 같습니다. */
export function revisionPatchChanged(card:CardRevision,patch:RevisionPatch):boolean{
 if(patch.scope==='layout'){
  const old=card.layout??DEFAULT_CARD_LAYOUT,next=patch.changes;
  return old.fontScale!==next.fontScale||old.textAlign!==next.textAlign||old.placement!==next.placement;
 }
 if(patch.scope==='image')return card.imagePlan!==patch.changes.imagePlan;
 return card.title!==patch.changes.title||card.body!==patch.changes.body||!same([...card.sourceIds].sort(),[...patch.changes.sourceIds].sort());
}
/** Store와 provider가 같은 선택·범위·출처 판정을 사용합니다. 입력은 수정하지 않습니다. */
export function normalizeRevisionDecision(raw:unknown,p:ProjectSnapshot,request:RevisionRequest):RevisionDecision{
 const parsed=RevisionDecisionSchema.safeParse(raw);
 if(!parsed.success||request.scope==='storyboard'||!p.result)throw new RevisionDecisionError();
 const decision=parsed.data;
 if(decision.status!=='patch')return decision;
 const ids=new Set(request.cardIds);
 if(!ids.size||ids.size!==request.cardIds.length||decision.patches.length!==ids.size||decision.patches.some(patch=>!ids.has(patch.cardId)||patch.scope!==request.scope))throw new RevisionDecisionError();
 for(const patch of decision.patches){
  const card=p.result.cards.find(c=>c.cardId===patch.cardId);if(!card)throw new RevisionDecisionError();
  if(patch.scope==='text'&&patch.changes.sourceIds.some(id=>!p.sources.some(s=>s.sourceId===id&&p.selectedCandidateIds.includes(s.candidateId))))throw new RevisionDecisionError();
 }
 // Keep the complete selection when at least one patch differs; repeated validation is idempotent.
 if(request.scope!=='image'&&!request.renderOnly&&!decision.patches.some(patch=>revisionPatchChanged(p.result!.cards.find(c=>c.cardId===patch.cardId)!,patch)))return {kind:'revision',status:'no_change',reason:'요청한 변경이 현재 저장 내용과 같습니다. 기존 카드·PNG·승인은 유지했습니다.'};
 return decision;
}
