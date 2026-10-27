import type {ProjectSnapshot,SemanticReviewReport} from '../../src/shared/포트.js';
/** 화면 단위 검사 전용 합성 보고서. 실제 모델 호출/검수 증거가 아닙니다. */
export function 의미검수대역(p:ProjectSnapshot):SemanticReviewReport {
 return {verdict:'supported',reviewedCardIds:(p.result?.cards??p.storyboard?.cards??[]).map(c=>c.cardId),reviewedClaimIndices:p.claims.map((_,i)=>i),issues:[],reviewer:{provider:'agy',model:'gemini-3.8-flash-high'},actualModel:null,reviewedAt:'2026-10-26T00:00:00Z',inputHash:'a'.repeat(64)};
}
