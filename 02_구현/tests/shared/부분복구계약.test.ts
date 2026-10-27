import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as C from '../../src/shared/포트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';

test('부분 재개는 기존 사실 요청에 실패 run과 체크포인트를 쌍으로 명시한다',()=>{
 const base={requestId:randomUUID(),version:4,claimIndices:[0],cardIds:[randomUUID()]};
 expect(C.FactReviewRequestSchema.safeParse(base).success).toBe(true);
 const resume={...base,resumeFromRunId:randomUUID(),checkpointId:randomUUID()};
 expect(C.FactReviewRequestSchema.safeParse(resume).success).toBe(true);
 expect(C.FactReviewRequestSchema.safeParse({...base,resumeFromRunId:resume.resumeFromRunId}).success).toBe(false);
 expect(C.FactReviewRequestSchema.safeParse({...base,checkpointId:resume.checkpointId}).success).toBe(false);
 expect(C.FactReviewRequestSchema.safeParse({...resume,draft:{kind:'factReview'}}).success).toBe(false);
});

test('공개 복구 요약은 원본 응답 없이 재개 단계·누락 카드만 전달한다',()=>{
 const p=createMockSnapshot('review');
 const summary={checkpointId:randomUUID(),sourceRunId:randomUUID(),step:'links',available:true,reason:null,issues:[{code:'FACT_CARD_LINK_MISSING',message:'카드 연결 누락',claimIndex:null,cardIds:[p.result!.cards[0]!.cardId],sourceIds:[]}],savedAt:'2026-10-27T03:00:00.000Z'};
 const withRecovery={...p,factRecovery:summary,allowedActions:[...p.allowedActions,'resume_fact_review']};
 expect(C.ProjectSnapshotSchema.safeParse(withRecovery).success).toBe(true);
 expect(C.ProjectSnapshotSchema.safeParse({...withRecovery,factRecovery:{...summary,receipts:[]}}).success).toBe(false);
 expect(C.ProjectSnapshotSchema.safeParse({...withRecovery,factRecovery:{...summary,step:'research'}}).success).toBe(false);
});

test('LLM 연결 보완 응답은 연결 목록만 허용하고 해결 불가는 빈 목록으로 남긴다',()=>{
 const schema=(C as unknown as {FactLinkRepairDecisionSchema?:{safeParse:(v:unknown)=>{success:boolean}}}).FactLinkRepairDecisionSchema;
 const fixed={status:'repaired',links:[{claimIndex:0,cardIds:[randomUUID()]}],reason:'마지막 요약 카드의 주장 연결을 보완합니다.'};
 expect(schema?.safeParse(fixed).success??false).toBe(true);
 expect(schema?.safeParse({...fixed,title:'원고를 바꿉니다'}).success).toBe(false);
 expect(schema?.safeParse({...fixed,links:[]}).success).toBe(false);
 expect(schema?.safeParse({...fixed,status:'unresolvable'}).success).toBe(false);
 expect(schema?.safeParse({status:'unresolvable',links:[],reason:'맞는 주장을 확인하지 못했습니다.'}).success).toBe(true);
});
