import {createHash} from 'node:crypto';
import {FactLinkRepairDecisionSchema,FactProposalDraftSchema,FactReviewContentSchema,type ProjectSnapshot,type EngineContent} from '../shared/포트.js';
import type {FactCheckpointWrite} from '../shared/포트.js';
import {fail} from './오류.js';
import {linkFailure} from './연결진단.js';
export type FetchReceipt={toolUseId:string;requestedUrl:string;url:string;statusCode:number|null;bytes:number|null;outcome:'opened'|'blocked'|'empty'|'failed'|'unconfirmed';observedAt:string;evidenceSha256:string|null;result:string|null};
/** result는 원문 HTML이 아닌 SDK 처리 결과. snippet으로 승격하지 않는다. */
export function captureFetchReceipt(toolUseId:string,requestedUrl:string,output:unknown,failed:boolean,observedAt:string):FetchReceipt {
 const r:FetchReceipt={toolUseId,requestedUrl,url:requestedUrl,statusCode:null,bytes:null,outcome:failed?'failed':'unconfirmed',observedAt,evidenceSha256:null,result:null};
 if(!output||typeof output!=='object'||Array.isArray(output))return r;
 const o=output as Record<string,unknown>;
 if(typeof o.url!=='string'||o.url!==requestedUrl||!Number.isInteger(o.code)||Number(o.code)<100||Number(o.code)>599||!Number.isSafeInteger(o.bytes)||Number(o.bytes)<0||typeof o.result!=='string'||typeof o.codeText!=='string'||typeof o.durationMs!=='number'||!Number.isFinite(o.durationMs)||o.durationMs<0)return r;
 r.url=o.url;r.statusCode=Number(o.code);r.bytes=Number(o.bytes);
 if(failed){r.outcome='failed';return r;}
 if(r.statusCode===403||r.statusCode===401){r.outcome='blocked';return r;}
 if(r.statusCode<200||r.statusCode>=300){r.outcome='failed';return r;}
 if(!r.bytes||!o.result.trim()){r.outcome='empty';return r;}
 r.result=o.result;r.evidenceSha256=createHash('sha256').update(o.result,'utf8').digest('hex');r.outcome='opened';return r;
}

export function validateFactReview(raw:unknown,snapshot:ProjectSnapshot,receipts:FetchReceipt[]):EngineContent {return validate(raw,snapshot,receipts,false);}
/** Only the final orphan guard is deferred; all schema/scope/evidence checks still run. */
export function prepareFactCheckpoint(raw:unknown,snapshot:ProjectSnapshot,receipts:FetchReceipt[]):FactCheckpointWrite {
 const checked=validate(raw,snapshot,receipts,true);if(checked.kind!=='factReview')fail('FACT_REVIEW_FAILED');
 const missing=checked.cards.filter(c=>!checked.findings.some(f=>f.cardIds.includes(c.cardId)));
 return {step:missing.length?'links':'semantic',draft:FactProposalDraftSchema.parse(raw),receipts:structuredClone(receipts),issues:missing.map(c=>({code:'FACT_CARD_LINK_MISSING',message:'수정 카드와 주장 판정의 연결이 누락되었습니다. 기존 자료로 연결만 보완해 주세요.',claimIndex:null,cardIds:[c.cardId],sourceIds:[...c.sourceIds]}))};
}
export function applyFactLinkRepair(snapshot:ProjectSnapshot,raw:unknown,receipts:FetchReceipt[],decision:unknown):Extract<EngineContent,{kind:'factReview'}>{
 const cp=prepareFactCheckpoint(raw,snapshot,receipts),parsed=FactLinkRepairDecisionSchema.safeParse(decision);
 if(cp.step!=='links')linkFailure('FACT_LINK_VALIDATION_FAILED');
 if(!parsed.success){
  // Diagnose only bounded structural data; invalid output is never accepted or normalized.
  const links=decision&&typeof decision==='object'&&'links'in decision?decision.links:null;
  if(Array.isArray(links)&&links.length<=100){
   const seen=new Set<string>();
   for(const link of links)if(link&&Number.isInteger(link.claimIndex)&&Array.isArray(link.cardIds)&&link.cardIds.length<=20)for(const id of link.cardIds)if(typeof id==='string'){
    const pair=`${link.claimIndex}:${id}`;if(seen.has(pair))linkFailure('FACT_LINK_PAIR_DUPLICATE');seen.add(pair);
   }
   if(links.length===0&&'status'in (decision as object)&&(decision as {status:unknown}).status==='repaired')linkFailure('FACT_LINK_COVERAGE_MISSING');
  }
  linkFailure('FACT_LINK_VALIDATION_FAILED');
 }
 if(parsed.data.status!=='repaired')linkFailure('FACT_LINK_UNRESOLVABLE');
 const missing=new Set(cp.issues.flatMap(i=>i.cardIds)),covered=new Set<string>(),pairs=new Set<string>(),draft=structuredClone(cp.draft);
 for(const link of parsed.data.links){
  const finding=draft.findings.find(f=>f.claimIndex===link.claimIndex);if(!finding)linkFailure('FACT_LINK_TARGET_INVALID');
  for(const cardId of link.cardIds){
   const pair=`${link.claimIndex}:${cardId}`;
   if(pairs.has(pair))linkFailure('FACT_LINK_PAIR_DUPLICATE');
   if(!missing.has(cardId)||finding.cardIds.includes(cardId))linkFailure('FACT_LINK_TARGET_INVALID');
   // 새 연결의 근거 참조만 제안 복사본에 보충합니다. 원고·Source 원본은 그대로 두고 아래 strict 검사를 다시 거칩니다.
   const card=draft.cards.find(c=>c.cardId===cardId);if(!card)linkFailure('FACT_LINK_TARGET_INVALID');
   card.sourceIds=[...new Set([...card.sourceIds,...finding.afterClaim.sourceIds])];
   finding.cardIds.push(cardId);covered.add(cardId);pairs.add(pair);
  }
 }
 if(covered.size!==missing.size)linkFailure('FACT_LINK_COVERAGE_MISSING');
 const result=validateFactReview(draft,snapshot,receipts);if(result.kind!=='factReview')fail('FACT_REVIEW_FAILED');return result;
}
function validate(raw:unknown,snapshot:ProjectSnapshot,receipts:FetchReceipt[],allowOrphans:boolean):EngineContent {
 const parsed=FactProposalDraftSchema.safeParse(raw);if(!parsed.success)fail('FACT_REVIEW_FAILED');
 const out=parsed.data,review=snapshot.factReview;
 const unique=(xs:unknown[])=>new Set(xs).size===xs.length;
 if(!review||review.state!=='pending'||!snapshot.storyboard||!review.claimIndices.length||!review.cardIds.length||!unique(review.claimIndices)||!unique(review.cardIds)||review.claimIndices.some(i=>!snapshot.claims[i]))fail('FACT_SCOPE_INVALID');
 const currentCards=snapshot.result?.cards??snapshot.storyboard.cards;
 if(review.cardIds.some(id=>!currentCards.some(c=>c.cardId===id)))fail('FACT_SCOPE_INVALID');
 if(out.findings.length!==review.claimIndices.length||out.findings.some(f=>!review.claimIndices.includes(f.claimIndex))||!unique(out.sources.map(s=>s.sourceId)))fail('FACT_SCOPE_INVALID');
 const oldIds=new Set(snapshot.sources.map(s=>s.sourceId));
 if(out.sources.some(s=>oldIds.has(s.sourceId)||!snapshot.selectedCandidateIds.includes(s.candidateId)))fail('FACT_SCOPE_INVALID');
 const observations:Extract<EngineContent,{kind:'factReview'}>['observations']=[];
 const opened=new Set<string>();
 for(const source of out.sources){
  const matched=receipts.filter(r=>r.requestedUrl===source.url&&r.url===source.url);
  const grounded=matched.findLast(r=>r.outcome==='opened'&&source.evidence?.trim()&&r.result?.includes(source.evidence));
  for(const {result:_result,...r} of matched)observations.push({...r,sourceId:source.sourceId,...(r.outcome==='opened'&&(!source.evidence?.trim()||!_result?.includes(source.evidence))?{outcome:'unconfirmed' as const}: {})});
  const last=grounded??matched.at(-1);
  if(grounded){source.access='opened';source.accessedAt=grounded.observedAt;opened.add(source.sourceId);}
  else {source.access=last?.outcome==='blocked'?'blocked':last?.outcome==='failed'||last?.outcome==='empty'?'failed':'not_opened';source.accessedAt=last?.observedAt??null;source.evidence=null;}
 }
 const sources=new Map(out.sources.map(s=>[s.sourceId,s]));
 const known=(ids:string[])=>ids.every(id=>sources.has(id));
 const patches=new Map(out.cards.map(c=>[c.cardId,c]));
 if(out.cards.some(c=>!review.cardIds.includes(c.cardId)||!c.sourceIds.length||!known(c.sourceIds)))fail('FACT_SCOPE_INVALID');
 for(const finding of out.findings){
  const claim=finding.afterClaim;
  if(finding.cardIds.some(id=>!review.cardIds.includes(id))||!known(claim.sourceIds)||finding.comparisons.some(c=>!claim.sourceIds.includes(c.sourceId)))fail('FACT_SCOPE_INVALID');
  const comparisons=finding.comparisons;
  if(!unique(comparisons.map(c=>c.sourceId)))fail('FACT_REVIEW_FAILED');
  const scopeKeys=['country','event','period','population','metric','unit','aggregation','provisional'] as const;
  for(const c of comparisons){
   if(!opened.has(c.sourceId))fail('FACT_REVIEW_FAILED');
   // 정규화된 비교 값은 모델의 정리입니다. 번역/집계 의미를 substring으로 보증하지 않습니다.
  }
  if(finding.classification==='scope_difference'){
   if(new Set(comparisons.map(c=>sources.get(c.sourceId)!.url)).size<2)fail('FACT_REVIEW_FAILED');
   const differing=scopeKeys.filter(key=>new Set(comparisons.map(c=>c[key]).filter(v=>v!==null&&v!=='unknown')).size>=2);
   if(!differing.length)fail('FACT_REVIEW_FAILED');
   // 차이의 발행 문장 설명은 독립 LLM이 검수하며, 두 원문/메타데이터 차이 구조는 유지합니다.
  }
  if(finding.classification==='explained_discrepancy'&&(claim.kind!=='publisher_claim'||new Set(comparisons.map(c=>sources.get(c.sourceId)!.url)).size<2||new Set(comparisons.map(c=>c.value).filter(v=>v!==null)).size<2))fail('FACT_REVIEW_FAILED');
  // 귀속·매체 별칭·수치 표현의 의미는 전체 원고를 받는 독립 LLM이 검수합니다.
  // source.publisher 원형과 아래의 관측/직접 연결 검사는 그대로 유지합니다.
  const resolved=claim.kind==='verified'||claim.kind==='publisher_claim';
  if(finding.classification==='unverifiable'&&resolved)fail('FACT_REVIEW_FAILED');
  if(resolved){
   if(!claim.sourceIds.length||claim.sourceIds.some(id=>!opened.has(id))||!finding.cardIds.length)fail('FACT_REVIEW_FAILED');
   for(const id of finding.cardIds){const patch=patches.get(id);if(!patch||claim.sourceIds.some(s=>!patch.sourceIds.includes(s)))fail('FACT_REVIEW_FAILED');}
  }
 }
 if(!allowOrphans&&out.cards.some(card=>!out.findings.some(f=>f.cardIds.includes(card.cardId))))fail('FACT_SCOPE_INVALID');
 const content=FactReviewContentSchema.safeParse({...out,observations});if(!content.success)fail('FACT_REVIEW_FAILED');
 return content.data;
}

