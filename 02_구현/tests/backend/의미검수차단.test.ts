import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {checkStoredFacts} from '../../src/worker/검수.js';
import {factIssues,beginFactReview,saveFactProposal,applyFactProposal} from '../../src/backend/사실복구.js';
import {buildSemanticReviewInput} from '../../src/providers/검수내용.js';
import {FactIssueSchema} from '../../src/shared/포트.js';
import {syntheticReport,draft,reviewed} from './의미검수대역.js';
function ready(){const p=createMockSnapshot('review');Object.assign(p.sources[0],{access:'opened',accessedAt:new Date().toISOString(),evidence:'합성 문장'});p.claims=[{text:'합성 문장',kind:'verified',sourceIds:[p.sources[0].sourceId],availability:'unknown',conditions:[]}];return p;}
test('긴 LLM 사유는 원본 보고서에 보존하고 공개 차단 안내 길이를 지킨다',()=>{const p=ready(),r=syntheticReport(buildSemanticReviewInput(p),undefined,'unsupported');r.issues[0]!.message='가'.repeat(4000);r.issues[0]!.suggestion='나'.repeat(4000);p.result!.semanticReview=r;expect(factIssues(p).every(i=>FactIssueSchema.safeParse(i).success)).toBe(true);expect(r.issues[0]!.message).toHaveLength(4000);});
test('기존 근거 guard를 모두 만족해도 report 없는 결과는 pending과 명시 재검수 안내다',()=>{const p=ready();expect(checkStoredFacts(p,p.result!)).toBe('pending');expect(factIssues(p)).toEqual(expect.arrayContaining([expect.objectContaining({code:'SEMANTIC_REVIEW_REQUIRED',message:expect.stringContaining('검수')})]));});
test.each(['supported','unsupported','unverifiable'] as const)('%s 의미 판정은 실제 저장 검수 상태로 전달된다',verdict=>{const p=ready();p.result!.semanticReview=syntheticReport(buildSemanticReviewInput(p),undefined,verdict);expect(checkStoredFacts(p,p.result!)).toBe(verdict==='supported'?'passed':verdict==='unsupported'?'failed':'pending');if(verdict!=='supported')expect(factIssues(p).some(i=>i.code==='SEMANTIC_REVIEW_UNSUPPORTED')).toBe(true);});
test.each(['title','body'] as const)('%s만 달라도 기존 supported 판정은 오래된 검수로 차단한다',field=>{const p=ready();p.result!.semanticReview=syntheticReport(buildSemanticReviewInput(p));expect(checkStoredFacts(p,p.result!)).toBe('passed');p.result!.cards[0][field]+=' 999';expect(checkStoredFacts(p,p.result!)).toBe('pending');expect(factIssues(p).some(i=>i.code==='SEMANTIC_REVIEW_STALE')).toBe(true);});
test('새 제안은 report 없으면 원자 거절하며 유효 supported report와 함께만 저장한다',()=>{const p=ready(),id=randomUUID();p.factReview=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.result!.cards[0].cardId]},id);const raw=draft(p);expect(()=>saveFactProposal(p,id,raw)).toThrow('FACT_REVIEW_FAILED');expect(p.factReview.state).toBe('pending');saveFactProposal(p,id,reviewed(p,raw));expect(p.factReview.state).toBe('ready');});
test.each(['missing','hash','selection'] as const)('제안 적용 직전 %s report 손상은 현재 원고를 바꾸지 않는다',mode=>{
 const p=ready(),id=randomUUID();p.factReview=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.result!.cards[0].cardId]},id);saveFactProposal(p,id,reviewed(p,draft(p)));p.projectVersion++;const before=structuredClone(p.result);
 if(mode==='missing')delete p.factReview.proposal!.semanticReview;
 if(mode==='hash')p.factReview.proposal!.semanticReview!.inputHash='b'.repeat(64);
 if(mode==='selection')p.factReview.proposal!.semanticReview!.reviewer={provider:'agy',model:'gemini-3.8-flash-low'};
 expect(()=>applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:id})).toThrow('FACT_REVIEW_FAILED');expect(p.result).toEqual(before);expect(p.factReview.state).toBe('ready');
});
test('본문이 같은 확인 제안도 기존 카드 patch 경로로 검수 기록을 적용할 수 있다',()=>{
 const p=ready(),id=randomUUID();p.result!.cards[0].body='합성 문장';p.factReview=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.result!.cards[0].cardId]},id);
 const raw=draft(p);raw.cards[0].body=p.result!.cards[0].body;raw.findings[0].afterClaim.text=p.claims[0].text;raw.sources[0].evidence=p.claims[0].text;
 saveFactProposal(p,id,reviewed(p,raw));p.projectVersion++;applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:id});expect(p.result!.cards[0].body).toBe('합성 문장');expect(checkStoredFacts(p,p.result!)).toBe('passed');
});
test('적용 시 report를 결과로 전이하고 의미 불일치 verdict를 통과로 바꾸지 않는다',()=>{const p=ready(),id=randomUUID();p.factReview=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.result!.cards[0].cardId]},id);saveFactProposal(p,id,reviewed(p,draft(p),'unsupported'));p.projectVersion++;applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:id});expect(p.result!.semanticReview?.verdict).toBe('unsupported');expect(checkStoredFacts(p,p.result!)).toBe('failed');});
