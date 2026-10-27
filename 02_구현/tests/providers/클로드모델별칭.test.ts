import {it,expect} from 'vitest';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {SemanticReviewReport} from '../../src/shared/포트.js';
import {buildSemanticReviewInput,semanticInputHash,validateSemanticReport,matchesReviewModel} from '../../src/providers/검수내용.js';

it.each([
 ['sonnet','claude-sonnet-5-5',true],['opus','claude-opus-5-5',true],['haiku','claude-haiku-4-5-20251001',true],['fable','claude-fable-5-1',true],
 ['sonnet[1m]','claude-sonnet-4-6',true],['opus[1m]','claude-opus-4-8',true],
 ['claude-sonnet-5-5','claude-sonnet-5-5',true],['claude-haiku-4-5-20251001','claude-haiku-4-5-20251001',true],
 ['sonnet','claude-opus-5-5',false],['haiku','claude-sonnet-5-5',false],['fable','claude-opus-5-5',false],
 ['claude-sonnet-5-5','claude-sonnet-5',false],['claude-sonnet-4-5-20250929','claude-sonnet-4-5-20251001',false],
 ['unknown','claude-sonnet-5-5',false],['unknown','unknown',false],['sonnet','sonnet',false],['default','default',false],['Sonnet','claude-sonnet-5-5',false],['sonnet-latest','claude-sonnet-5-5',false],
 ['default','claude-sonnet-5-5',false],['best','claude-fable-5-1',false],['opusplan','claude-opus-5-5',false],
 ['__proto__','claude-sonnet-5-5',false],['constructor','claude-sonnet-5-5',false],
 ['sonnet','prefix-claude-sonnet-5-5',false],['sonnet','claude-sonnet-5-5-extra',false],['sonnet','claude-sonnet-5-5[1m]',false],
 ['sonnet','claude-sonnet-evil',false],['sonnet','claude-sonnet-5-5/claude-opus-5-5',false],
] as const)('선택 %s / 관측 %s의 family·구체 ID 결합은 %s',(model,actualModel,allowed)=>{
 const input=buildSemanticReviewInput(createMockSnapshot('review')),selection={provider:'claude' as const,model};
 const report:SemanticReviewReport={reviewer:selection,actualModel,reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(matchesReviewModel(selection,actualModel)).toBe(allowed);
 if(allowed)expect(validateSemanticReport(report,input,selection)).toEqual(report);
 else expect(()=>validateSemanticReport(report,input,selection)).toThrow(expect.objectContaining({code:'FACT_REVIEW_FAILED'}));
});
it.each(['high','medium','low'])('agy %s는 별칭 family로 완화되지 않고 정확히 결합된다',effort=>{
 const model=`gemini-3.8-flash-${effort}`,selection={provider:'agy' as const,model};
 expect(matchesReviewModel(selection,model)).toBe(true);
 for(const other of ['high','medium','low'].filter(x=>x!==effort))expect(matchesReviewModel(selection,`gemini-3.8-flash-${other}`)).toBe(false);
 expect(matchesReviewModel(selection,'claude-sonnet-5-5')).toBe(false);
});
it('미관측 모델을 요청 별칭으로 꾸미지 않고 null로 보존한다',()=>{
 const input=buildSemanticReviewInput(createMockSnapshot('review')),selection={provider:'claude' as const,model:'sonnet'};
 const report:SemanticReviewReport={reviewer:selection,actualModel:null,reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(validateSemanticReport(report,input,selection).actualModel).toBeNull();
 expect(matchesReviewModel({provider:'claude',model:null},'claude-opus-5-5')).toBe(true);
});

it('공식 sonnet 별칭 해석은 선택 문자열과 실제 관측 ID를 각각 보존한다',()=>{
 const input=buildSemanticReviewInput(createMockSnapshot('review'));
 const selection={provider:'claude' as const,model:'sonnet'};
 const report:SemanticReviewReport={reviewer:selection,actualModel:'claude-sonnet-5-5',reviewedAt:'2026-10-26T00:00:00Z',inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(validateSemanticReport(report,input,selection)).toEqual(report);
 expect(report.reviewer.model).toBe('sonnet');expect(report.actualModel).toBe('claude-sonnet-5-5');
});
