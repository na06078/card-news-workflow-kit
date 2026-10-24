import type {ProjectSnapshot,ResultVersion} from '../shared/포트.js';
/** 공급자가 저장한 출처·주장 provenance의 기계 검사. 외부 원문 독립 재검증이나 사람의 사실 판단이 아닙니다. */
export function checkStoredFacts(p:ProjectSnapshot,result:ResultVersion):ResultVersion['factsCheck']{
 if(p.claims.some(c=>c.kind==='conflicting'))return 'failed';
 const ids=new Set(result.cards.flatMap(c=>c.sourceIds));
 if(!ids.size||!p.claims.length||p.claims.some(c=>c.kind==='uncertain'))return 'pending';
 for(const id of ids){const source=p.sources.find(s=>s.sourceId===id);if(!source||source.access!=='opened'||!source.evidence||!source.accessedAt||!p.selectedCandidateIds.includes(source.candidateId)||!p.claims.some(c=>c.sourceIds.includes(id)))return 'pending';}
 return 'passed';
}
