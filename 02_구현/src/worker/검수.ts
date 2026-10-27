import type {ProjectSnapshot,ResultVersion} from '../shared/포트.js';
import {factIssues} from '../backend/사실복구.js';
/** 공개 스냅샷과 같은 저장 근거 판정. 외부 원문 독립 검증을 대신하지 않습니다. */
export function checkStoredFacts(p:ProjectSnapshot,result:ResultVersion):ResultVersion['factsCheck']{
 const issues=factIssues({...p,result});
 return issues.some(i=>i.code==='CLAIM_CONFLICTING')||(!issues.some(i=>i.code==='SEMANTIC_REVIEW_STALE')&&result.semanticReview?.verdict==='unsupported')?'failed':issues.length?'pending':'passed';
}
