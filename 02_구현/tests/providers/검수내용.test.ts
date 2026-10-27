import {it,expect} from 'vitest';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {DEFAULT_FACT_REVIEWER,type SemanticReviewReport} from '../../src/shared/포트.js';
import {buildSemanticReviewInput,semanticInputHash,validateSemanticReport} from '../../src/providers/검수내용.js';
it('검수 입력은 최종 발행 제목·본문·주장·참조 근거를 고정하고 원본을 바꾸지 않는다',()=>{
 const p=createMockSnapshot('review'),before=JSON.stringify(p),input=buildSemanticReviewInput(p);
 const report:SemanticReviewReport={reviewer:{...DEFAULT_FACT_REVIEWER},actualModel:DEFAULT_FACT_REVIEWER.model,reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(input.cards[0]).toMatchObject({cardId:I.card,title:p.result!.cards[0]!.title,body:p.result!.cards[0]!.body});
 expect(validateSemanticReport(report,input,DEFAULT_FACT_REVIEWER)).toEqual(report);
 expect(JSON.stringify(p)).toBe(before);
});
it.each(['body','title','claim','evidence','selection','actual-model','coverage','issue-source'])('과거 검수 기록으로 다른 내용/범위 %s를 통과시키지 않는다',mode=>{
 const p=createMockSnapshot('review');p.claims=[{text:'공식 수치는 10이다.',sourceIds:[I.source],kind:'verified',availability:'released',conditions:[]}];
 const input=buildSemanticReviewInput(p);
 const report:SemanticReviewReport={reviewer:{...DEFAULT_FACT_REVIEWER},actualModel:DEFAULT_FACT_REVIEWER.model,reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 if(mode==='body')input.cards[0]!.body='공식 수치는 999이다.';
 if(mode==='title')input.cards[0]!.title='근거와 다른 제목';
 if(mode==='claim')input.claims[0]!.claim.text='다른 대상에 관한 주장';
 if(mode==='evidence')input.sources[0]!.evidence='다른 수집 근거';
 if(mode==='selection')report.reviewer={provider:'claude',model:null};
 if(mode==='actual-model')report.actualModel='gemini-3.8-flash-low';
 if(mode==='coverage')report.reviewedCardIds=[];
 if(mode==='issue-source'){report.verdict='unsupported';report.issues=[{cardId:I.card,claimIndex:0,sourceIds:['99999999-9999-4999-8999-999999999999'],message:'알 수 없는 출처',suggestion:null}];}
 expect(()=>validateSemanticReport(report,input,DEFAULT_FACT_REVIEWER)).toThrow(expect.objectContaining({code:'FACT_REVIEW_FAILED'}));
});
it('제안의 전체 발행 예정 내용은 적용 후 입력과 동일하고 비대상 원고는 보존된다',()=>{
 const p=createMockSnapshot('review');p.claims=[{text:'기존 주장',sourceIds:[I.source],kind:'uncertain',availability:'unknown',conditions:[]}];
 const newSource={...p.sources[0]!,sourceId:'33333333-3333-4333-8333-333333333333',evidence:'확인한 수치는 10이다.'};
 const afterClaim={...p.claims[0]!,text:newSource.evidence,sourceIds:[newSource.sourceId],kind:'verified' as const};
 const patch={cardId:I.card,title:'정정 제목',body:afterClaim.text,sourceIds:[newSource.sourceId]};
 const proposal={sources:[newSource],findings:[{claimIndex:0,cardIds:[I.card],classification:'supported' as const,reason:'근거 지지',afterClaim,comparisons:[]}],cards:[patch]};
 const before=JSON.stringify(p),projected=buildSemanticReviewInput(p,proposal);
 expect(projected.cards[0]).toEqual(patch);expect(projected.claims[0]!.claim).toEqual(afterClaim);expect(projected.sources.map(s=>s.sourceId)).toContain(newSource.sourceId);
 expect(JSON.stringify(p)).toBe(before);
 p.claims[0]=afterClaim;p.sources.push(newSource);Object.assign(p.result!.cards[0]!,patch);
 expect(semanticInputHash(buildSemanticReviewInput(p))).toBe(semanticInputHash(projected));
});
it('명시 요청 모델은 보존하되 CLI가 미반환한 관측 모델은 null로 남긴다',()=>{
 const input=buildSemanticReviewInput(createMockSnapshot('review'));
 const report:SemanticReviewReport={reviewer:{...DEFAULT_FACT_REVIEWER},actualModel:null,reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(validateSemanticReport(report,input,DEFAULT_FACT_REVIEWER).actualModel).toBeNull();
});
