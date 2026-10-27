import {createHash} from 'node:crypto';
import * as C from '../shared/포트.js';
import {buildSemanticReviewInput,validateSemanticReport} from '../providers/검수내용.js';
import {requireThat as must} from './도메인.js';
/** 버전/상태 변화와 무관하게 실제 콘텐츠 및 선택 범위를 고정합니다. */
export function factFingerprint(p:C.ProjectSnapshot,scope:Pick<C.FactReviewState,'claimIndices'|'cardIds'>):string{
 return createHash('sha256').update(C.canonicalJson({projectId:p.projectId,topic:p.topic,period:p.period,selectedCandidateIds:p.selectedCandidateIds,storyboard:p.storyboard,result:p.result,claims:p.claims,sources:p.sources,claimIndices:scope.claimIndices,cardIds:scope.cardIds})).digest('hex');
}
export function beginFactReview(p:C.ProjectSnapshot,input:C.FactReviewRequest,runId:string):C.FactReviewState{
 must(p.storyboard&&['storyboard','review','export','production'].includes(p.stage)&&p.question?.status!=='open','STAGE_CONFLICT',p.projectId);
 const cards=p.result?.cards??p.storyboard.cards;
 must(input.claimIndices.every(i=>Number.isInteger(i)&&i>=0&&i<p.claims.length)&&input.cardIds.every(id=>cards.some(c=>c.cardId===id)),'FACT_SCOPE_INVALID',p.projectId);
 return {reviewer:input.reviewer==='claude'?{provider:'claude',model:p.claudeModel??null}:{provider:'agy',model:`gemini-3.8-flash-${input.reviewEffort??'high'}`},runId,baseVersion:input.version,storyboardVersion:p.storyboard.version,resultVersion:p.result?.version??null,contentHash:factFingerprint(p,input),claimIndices:[...input.claimIndices],cardIds:[...input.cardIds],state:'pending',readyVersion:null,proposal:null};
}
export function saveFactProposal(p:C.ProjectSnapshot,runId:string,raw:unknown):void{
 const review=p.factReview;
 must(review&&review.runId===runId&&review.state==='pending'&&review.contentHash===factFingerprint(p,review),'FACT_PROPOSAL_STALE',p.projectId);
 const parsed=C.FactReviewContentSchema.safeParse(raw);must(parsed.success,'FACT_SCOPE_INVALID',p.projectId);
 const {kind:_kind,...content}=parsed.data;
 validateFactScope(p,review,content);
 requireSemanticProposal(p,review,content);
 const cards=p.result?.cards??p.storyboard!.cards;
 review.proposal=C.FactProposalSchema.parse({...content,beforeClaims:review.claimIndices.map(claimIndex=>({claimIndex,claim:structuredClone(p.claims[claimIndex])})),beforeCards:content.cards.map(c=>{const old=cards.find(x=>x.cardId===c.cardId);must(old,'FACT_SCOPE_INVALID',p.projectId);return {cardId:old.cardId,title:old.title,body:old.body,sourceIds:[...old.sourceIds]};})});
 review.state='ready';review.readyVersion=p.projectVersion+1;
}
export function factIssues(p:C.ProjectSnapshot):C.FactIssue[]{
 const cards=p.result?.cards??p.storyboard?.cards??[];
 const issues:C.FactIssue[]=p.claims.flatMap((c,claimIndex)=>c.kind==='uncertain'||c.kind==='conflicting'||c.sourceIds.length===0||c.sourceIds.some(id=>!p.sources.some(s=>s.sourceId===id&&s.access==='opened'&&s.evidence&&s.accessedAt&&p.selectedCandidateIds.includes(s.candidateId)))?[{code:c.kind==='conflicting'?'CLAIM_CONFLICTING':'FACT_EVIDENCE_REQUIRED',message:'주장과 원문 근거를 확인하고 수정 제안을 검토해 주세요.',claimIndex,sourceIds:[...c.sourceIds],cardIds:cards.filter(card=>card.sourceIds.some(id=>c.sourceIds.includes(id))).map(card=>card.cardId)}]:[]);
 if(cards.length&&!p.claims.length)issues.push({code:'FACT_CLAIMS_REQUIRED',message:'발행 문장에 연결된 주장과 원문 근거를 확인해 주세요.',claimIndex:null,cardIds:cards.map(c=>c.cardId),sourceIds:[]});
 const ids=new Set(cards.flatMap(c=>c.sourceIds));
 if(cards.length&&!ids.size)issues.push({code:'FACT_EVIDENCE_REQUIRED',message:'카드에 확인한 원문 근거를 연결해 주세요.',claimIndex:null,cardIds:cards.map(c=>c.cardId),sourceIds:[]});
 for(const id of ids){const source=p.sources.find(s=>s.sourceId===id);if(!source||source.access!=='opened'||!source.evidence||!source.accessedAt||!p.selectedCandidateIds.includes(source.candidateId)||!p.claims.some(c=>c.sourceIds.includes(id)))issues.push({code:'FACT_SOURCE_UNCONFIRMED',message:'카드 출처의 원문 접근과 연결된 주장 근거를 확인해 주세요.',claimIndex:null,cardIds:cards.filter(c=>c.sourceIds.includes(id)).map(c=>c.cardId),sourceIds:[id]});}
 return [...issues,...semanticIssues(p)];
}
/** 현재 전체 발행 내용에 묶인 기록만 신뢰하며, 조회 중 외부 호출은 하지 않습니다. */
export function semanticIssues(p:C.ProjectSnapshot):C.FactIssue[]{
 const cards=p.result?.cards??p.storyboard?.cards??[];if(!cards.length)return [];
 const report=p.result?.semanticReview??(!p.result&&p.factReview?.state==='applied'?p.factReview.proposal?.semanticReview:undefined);
 const issue=(code:string,message:string):C.FactIssue[]=>[{code,message,claimIndex:null,cardIds:cards.map(c=>c.cardId),sourceIds:[]}];
 if(!report)return issue('SEMANTIC_REVIEW_REQUIRED','발행 예정 전체 제목·본문의 LLM 의미 검수가 필요합니다. 주장을 선택하여 사실 재검수를 요청하고 제안을 검토·적용해 주세요. 자동 호출은 하지 않습니다.');
 try{validateSemanticReport(report,buildSemanticReviewInput(p),report.reviewer);}catch{return issue('SEMANTIC_REVIEW_STALE','제목·본문·주장 또는 근거가 검수 당시와 달라졌습니다. 사실 재검수를 다시 요청하고 현재 원고에 맞는 제안을 적용해 주세요.');}
 if(report.verdict==='supported')return [];
 return report.issues.map(i=>({code:'SEMANTIC_REVIEW_UNSUPPORTED',message:[...`${report.verdict==='unsupported'?'근거와 발행 문장이 맞지 않습니다':'제공된 근거로 확인할 수 없습니다'}: ${i.message} ${i.suggestion??'근거와 원고를 확인한 뒤 사실 재검수를 요청해 주세요.'}`].slice(0,2000).join(''),claimIndex:i.claimIndex,cardIds:i.cardId?[i.cardId]:cards.map(c=>c.cardId),sourceIds:i.sourceIds}));
}
function requireSemanticProposal(p:C.ProjectSnapshot,review:C.FactReviewState,content:Pick<C.FactProposal,'sources'|'findings'|'cards'|'semanticReview'>):void{
 try{validateSemanticReport(content.semanticReview,buildSemanticReviewInput(p,content),review.reviewer??C.DEFAULT_FACT_REVIEWER);}catch{must(false,'FACT_REVIEW_FAILED',p.projectId);}
}
/** provider 정규화와 별개로 commit과 apply 모두 동일 범위/영수증을 다시 검사합니다. */
export function validateFactScope(p:C.ProjectSnapshot,review:C.FactReviewState,content:Pick<C.FactProposal,'sources'|'findings'|'cards'|'observations'>):void{
 const scope=(ok:unknown)=>must(ok,'FACT_SCOPE_INVALID',p.projectId);
 const evidence=(ok:unknown)=>must(ok,'FACT_REVIEW_FAILED',p.projectId);
 const unique=(xs:unknown[])=>new Set(xs).size===xs.length;
 scope(review.claimIndices.every(i=>Number.isInteger(i)&&i>=0&&!!p.claims[i])&&unique(review.claimIndices)&&unique(review.cardIds));
 scope(content.findings.length===review.claimIndices.length&&unique(content.findings.map(f=>f.claimIndex))&&content.findings.every(f=>review.claimIndices.includes(f.claimIndex)));
 scope(unique(content.sources.map(s=>s.sourceId))&&content.sources.every(s=>!p.sources.some(old=>old.sourceId===s.sourceId)&&p.selectedCandidateIds.includes(s.candidateId)));
 const sources=new Map(content.sources.map(s=>[s.sourceId,s]));
 const known=(ids:string[])=>ids.every(id=>sources.has(id));
 for(const receipt of content.observations){const source=sources.get(receipt.sourceId);scope(source&&receipt.requestedUrl===source.url&&receipt.url===source.url);if(receipt.outcome==='opened')evidence(receipt.statusCode!==null&&receipt.statusCode>=200&&receipt.statusCode<300&&receipt.bytes!==null&&receipt.bytes>0&&receipt.evidenceSha256);}
 const opened=(id:string)=>{const s=sources.get(id);return !!s&&s.access==='opened'&&!!s.evidence?.trim()&&!!s.accessedAt&&content.observations.some(o=>o.sourceId===id&&o.outcome==='opened'&&o.observedAt===s.accessedAt);};
 for(const s of content.sources)if(s.access==='opened')evidence(opened(s.sourceId));
 scope(unique(content.cards.map(c=>c.cardId))&&content.cards.every(c=>review.cardIds.includes(c.cardId)&&c.sourceIds.length>0&&known(c.sourceIds)&&content.findings.some(f=>f.cardIds.includes(c.cardId))));
 for(const f of content.findings){
  const claim=f.afterClaim,resolved=claim.kind==='verified'||claim.kind==='publisher_claim';
  scope(unique(f.cardIds)&&f.cardIds.every(id=>review.cardIds.includes(id))&&known(claim.sourceIds)&&unique(f.comparisons.map(c=>c.sourceId))&&f.comparisons.every(c=>claim.sourceIds.includes(c.sourceId)));
  if(f.classification==='unverifiable')evidence(!resolved);
  if(f.classification==='explained_discrepancy')evidence(claim.kind==='publisher_claim');
  if(resolved){evidence(claim.sourceIds.length>0&&claim.sourceIds.every(opened)&&f.cardIds.length>0);for(const id of f.cardIds){const card=content.cards.find(c=>c.cardId===id);evidence(card&&claim.sourceIds.every(s=>card.sourceIds.includes(s)));}}
  const keys=['country','event','period','population','metric','unit','aggregation','provisional'] as const;
  // 비교 값의 번역/정규화 의미 대신 관측된 참조와 데이터 구조만 검사합니다.
  for(const c of f.comparisons)evidence(opened(c.sourceId));
  if(f.classification==='scope_difference'){
   evidence(new Set(f.comparisons.map(c=>sources.get(c.sourceId)?.url)).size>=2);
   const differing=keys.filter(key=>new Set(f.comparisons.map(c=>c[key]).filter(v=>v!==null&&v!=='unknown')).size>=2);evidence(differing.length>0);
   // 범위 차이를 어떻게 설명했는지는 전체 원고의 독립 의미 검수에 맡깁니다.
  }
  // 귀속·매체 별칭·수치의 의미는 입력 해시에 결합된 독립 검수 기록으로 판단합니다.
 }
}
export function applyFactProposal(p:C.ProjectSnapshot,input:C.FactApplyRequest):void{
 const review=p.factReview;
 must(review&&review.runId===input.reviewRunId&&review.state==='ready'&&review.readyVersion===p.projectVersion&&input.version===p.projectVersion&&review.storyboardVersion===p.storyboard?.version&&review.resultVersion===(p.result?.version??null)&&review.contentHash===factFingerprint(p,review),'FACT_PROPOSAL_STALE',p.projectId,p.projectVersion);
 const parsed=C.FactProposalSchema.safeParse(review.proposal);must(parsed.success,'FACT_SCOPE_INVALID',p.projectId);const proposal=parsed.data;
 validateFactScope(p,review,proposal);
 requireSemanticProposal(p,review,proposal);
 must(proposal.cards.length>0,'FACT_SCOPE_INVALID',p.projectId,p.projectVersion,'FACT_NO_CARD_CHANGES');
 must(C.canonicalJson(proposal.beforeClaims)===C.canonicalJson(review.claimIndices.map(claimIndex=>({claimIndex,claim:p.claims[claimIndex]}))),'FACT_PROPOSAL_STALE',p.projectId);
 const cards=p.result?.cards??p.storyboard!.cards;
 must(C.canonicalJson(proposal.beforeCards)===C.canonicalJson(proposal.cards.map(c=>{const old=cards.find(x=>x.cardId===c.cardId);must(old,'FACT_SCOPE_INVALID',p.projectId);return {cardId:old.cardId,title:old.title,body:old.body,sourceIds:old.sourceIds};})),'FACT_PROPOSAL_STALE',p.projectId);
 for(const f of proposal.findings)p.claims[f.claimIndex]=structuredClone(f.afterClaim);
 p.sources.push(...structuredClone(proposal.sources));
 for(const patch of proposal.cards)Object.assign(cards.find(c=>c.cardId===patch.cardId)!,structuredClone(patch));
 if(p.result){
  p.result.semanticReview=structuredClone(proposal.semanticReview!);p.result.version++;p.result.finalApprovedVersion=null;delete p.result.manualApproval;p.result.factsCheck='pending';p.result.visualCheck='pending';p.exports=[];
  for(const patch of proposal.cards){const card=p.result.cards.find(c=>c.cardId===patch.cardId)!;card.revision++;card.approvedRevision=null;card.state='pending';card.previewAssetId=null;card.error=null;}
  p.stage='production';p.status='working';
 }else{p.storyboard!.version++;p.storyboard!.approvedVersion=null;p.stage='storyboard';p.status='ready';}
 review.state='applied';p.projectVersion++;
}
