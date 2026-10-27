import {it,expect} from 'vitest';
import {FactReviewRequestSchema,ReviewSelectionSchema,ResultVersionSchema} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
const base={requestId:'11111111-1111-4111-8111-111111111111',version:1,claimIndices:[0],cardIds:['22222222-2222-4222-8222-222222222222']};
it.each(['agy','claude'])('사실 재검증은 작성 모델과 별개로 검수 담당 %s를 받는다',reviewer=>{
 expect(FactReviewRequestSchema.safeParse({...base,reviewer}).success).toBe(true);
});
it('기존 요청 형식은 보존하고 알 수 없는 제공자는 거절한다',()=>{
 expect(FactReviewRequestSchema.safeParse(base).success).toBe(true);
 expect(FactReviewRequestSchema.safeParse({...base,reviewer:'other'}).success).toBe(false);
});
it.each(['high','medium','low'])('agy 검수의 실제 모델 강도 %s를 선택할 수 있다',effort=>{
 expect(ReviewSelectionSchema.safeParse({provider:'agy',model:`gemini-3.8-flash-${effort}`}).success).toBe(true);
 expect(FactReviewRequestSchema.safeParse({...base,reviewer:'agy',reviewEffort:effort}).success).toBe(true);
});
it('LLM 검토 기록은 기존 결과와 별도로 저장된다',()=>{
 const p=createMockSnapshot('review');
 const report={reviewer:{provider:'agy',model:'gemini-3.8-flash-high'},actualModel:'gemini-3.8-flash-high',reviewedAt:'2026-10-26T00:00:00Z',inputHash:'0'.repeat(64),verdict:'supported',reviewedCardIds:[I.card],reviewedClaimIndices:[0],issues:[]};
 expect(ResultVersionSchema.safeParse({...p.result,semanticReview:report}).success).toBe(true);
});
