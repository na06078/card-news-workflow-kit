import {test,expect} from 'vitest';
import {FactRecoverySummarySchema} from '../../src/shared/포트.js';
const saved={checkpointId:'11111111-1111-4111-8111-111111111111',sourceRunId:'22222222-2222-4222-8222-222222222222',step:'semantic',available:true,reason:null,issues:[],savedAt:'2026-10-28T02:00:00.000Z'};
test('저장 보완 응답 재사용 표시는 원본 응답을 노출하지 않는 선택 필드다',()=>{
 expect(FactRecoverySummarySchema.parse({...saved,reuseRepairObservation:true})).toEqual({...saved,reuseRepairObservation:true});
 expect(FactRecoverySummarySchema.parse(saved)).toEqual(saved);
 expect(()=>FactRecoverySummarySchema.parse({...saved,reuseRepairObservation:'true'})).toThrow();
});
