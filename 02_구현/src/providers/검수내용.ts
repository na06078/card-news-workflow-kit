import {createHash} from 'node:crypto';
import {canonicalJson,SemanticReviewReportSchema,type FactProposalDraft,type ProjectSnapshot,type ReviewSelection,type SemanticReviewInput,type SemanticReviewReport} from '../shared/포트.js';
import {fail} from './오류.js';

/** 모델에 파일/인증/실행 메타데이터 대신 발행 텍스트와 수집 근거만 전달합니다. */
export function buildSemanticReviewInput(snapshot:ProjectSnapshot,proposal?:Pick<FactProposalDraft,'sources'|'findings'|'cards'>):SemanticReviewInput {
 const patches=new Map(proposal?.cards.map(card=>[card.cardId,card])??[]);
 const findings=new Map(proposal?.findings.map(finding=>[finding.claimIndex,finding.afterClaim])??[]);
 const cards=[...(snapshot.result?.cards??snapshot.storyboard?.cards??[])].sort((a,b)=>a.order-b.order).map(card=>{
  const {cardId,title,body,sourceIds}=patches.get(card.cardId)??card;
  return {cardId,title,body,sourceIds:[...sourceIds]};
 });
 const claims=snapshot.claims.map((claim,claimIndex)=>({claimIndex,claim:structuredClone(findings.get(claimIndex)??claim)}));
 const referenced=new Set([...cards.flatMap(c=>c.sourceIds),...claims.flatMap(c=>c.claim.sourceIds)]);
 const mergedSources=new Map([...snapshot.sources,...(proposal?.sources??[])].map(source=>[source.sourceId,source]));
 const sources=[...mergedSources.values()].filter(s=>referenced.has(s.sourceId)).map(s=>structuredClone(s)).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 return {projectId:snapshot.projectId,cards,claims,sources};
}
export function semanticInputHash(input:SemanticReviewInput):string {
 return createHash('sha256').update(canonicalJson(input),'utf8').digest('hex');
}
/**
 * Claude Code 공식 family 별칭만 해석합니다. 버전 고정/문자열 정규화/모델 전환은 하지 않습니다.
 * https://code.claude.com/docs/en/model-config#model-aliases
 * 설치 SDK ModelInfo.resolvedModel도 value 별칭과 wire ID를 별도 필드로 정의합니다.
 * default/best/opusplan은 단일 family를 보장하지 않아 별칭 해석 대상이 아닙니다.
 * null은 미선택/미관측일 뿐 모델 확인의 증거가 아닙니다.
 */
export function matchesReviewModel(selection:Readonly<ReviewSelection>,actualModel:string|null):boolean {
 if(selection.model===null||actualModel===null)return true;
 if(selection.provider!=='claude')return selection.model===actualModel;
 // 동일한 별칭 문자열은 구체 모델 관측이 아닙니다. 명시 Claude ID는 문자 그대로 결합합니다.
 if(selection.model===actualModel)return actualModel.startsWith('claude-');
 const families:Readonly<Record<string,string>>={sonnet:'sonnet',opus:'opus',haiku:'haiku',fable:'fable','sonnet[1m]':'sonnet','opus[1m]':'opus'};
 const family=Object.hasOwn(families,selection.model)?families[selection.model]:undefined;
 // Anthropic wire ID: family + numeric version + optional dated snapshot. No prefixes, tags or substring matching.
 const observed=/^claude-(sonnet|opus|haiku|fable)-[0-9]+(?:-[0-9]+)?(?:-[0-9]{8})?$/.exec(actualModel);
 return family!==undefined&&observed?.[1]===family;
}
/** 이 검사는 기록과 입력의 결합만 증명합니다. 모델의 의미 판단이 참임을 증명하지 않습니다. */
export function validateSemanticReport(raw:unknown,input:SemanticReviewInput,selection:Readonly<ReviewSelection>):SemanticReviewReport {
 const parsed=SemanticReviewReportSchema.safeParse(raw);
 if(!parsed.success)fail('FACT_REVIEW_FAILED');
 const report=parsed.data;
 if(report.inputHash!==semanticInputHash(input)||canonicalJson(report.reviewer)!==canonicalJson(selection))fail('FACT_REVIEW_FAILED');
 if(!matchesReviewModel(selection,report.actualModel))fail('FACT_REVIEW_FAILED');
 const cards=new Set(input.cards.map(c=>c.cardId)),claims=new Set(input.claims.map(c=>c.claimIndex)),sources=new Set(input.sources.map(s=>s.sourceId));
 if(!cards.size||report.reviewedCardIds.length!==cards.size||report.reviewedCardIds.some(id=>!cards.has(id))||report.reviewedClaimIndices.length!==claims.size||report.reviewedClaimIndices.some(index=>!claims.has(index)))fail('FACT_REVIEW_FAILED');
 if(report.issues.some(issue=>issue.cardId!==null&&!cards.has(issue.cardId)||issue.claimIndex!==null&&!claims.has(issue.claimIndex)||issue.sourceIds.some(id=>!sources.has(id))))fail('FACT_REVIEW_FAILED');
 return report;
}
