import {describe,expect,it} from 'vitest';
import {AppErrorSchema,QuestionSchema,validateAnswer,RequestSchemas,ProjectSnapshotSchema} from '../../src/shared/검증.js';
import {ModelCatalogSchema,QuotaProviderSchema} from '../../src/shared/작업공간계약.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';

const rejected = {
  code: 'MODEL_CATALOG_UNAVAILABLE', message: '모델 목록을 확인하지 못했습니다.',
  retryable: true, nextActions: ['retry'], projectId: null, runId: null,
  currentVersion: null, details: {requestOutcome: 'rejected'},
};

describe('차단 복구의 공개 요청 결과 계약', () => {
  it('서버가 증명한 미적용 거절을 응답 불명과 구분해 전달한다', () => {
    expect(AppErrorSchema.safeParse(rejected).success).toBe(true);
    expect(AppErrorSchema.safeParse({...rejected, details: {requestOutcome: 'unknown'}}).success).toBe(true);
    expect(AppErrorSchema.safeParse({...rejected, details: {requestOutcome: 'succeeded'}}).success).toBe(false);
    expect(AppErrorSchema.safeParse({...rejected, details: {}}).success).toBe(true);
  });
  it('metadata의 허용된 안전 오류만 모델/사용량 응답으로 전달한다', () => {
    const model = {status:'error',checkedAt:null,models:[],error:'조회 실패',errorCode:'AUTH_PATH_FORBIDDEN'};
    const quota = {provider:'claude',label:'Claude',status:'error',checkedAt:null,metrics:[],message:'정리 미확인',errorCode:'METADATA_CLEANUP_UNCONFIRMED'};
    expect(ModelCatalogSchema.safeParse(model).success).toBe(true);
    expect(QuotaProviderSchema.safeParse(quota).success).toBe(true);
    expect(ModelCatalogSchema.safeParse({...model,errorCode:'raw private failure'}).success).toBe(false);
    expect(QuotaProviderSchema.safeParse({...quota,errorCode:'raw private failure'}).success).toBe(false);
  });
  it('고정 선택 질문은 자유 답변을 받지 않고 명시 선택만 저장한다', () => {
    const original = createMockSnapshot('question').question!;
    const question = {...original,items:original.items.map(item=>({...item,allowFreeText:false}))};
    expect(QuestionSchema.safeParse(question).success).toBe(true);
    const request = {requestId:MOCK_IDS.run,questionId:question.questionId,version:question.version,
      answer:[{itemId:question.items[0]!.itemId,optionIds:['public'],text:null}]};
    expect(()=>validateAnswer(question,request)).not.toThrow();
    expect(()=>validateAnswer(question,{...request,answer:[{itemId:question.items[0]!.itemId,optionIds:[],text:'직접 입력'}]})).toThrow();
    expect(()=>validateAnswer(original,{...request,answer:[{itemId:question.items[0]!.itemId,optionIds:[],text:'편집 자유 답변'}]})).not.toThrow();
  });
  it('기존 콘텐츠를 바꾸지 않는 사실 제안·적용과 실행 상태를 전달한다', () => {
    expect(Object.hasOwn(RequestSchemas,'factReview')).toBe(true);
    expect(Object.hasOwn(RequestSchemas,'factApply')).toBe(true);
    expect(Object.hasOwn(RequestSchemas,'rebuildExports')).toBe(true);
    const p=createMockSnapshot('review');
    const factReview={runId:MOCK_IDS.run,baseVersion:p.projectVersion,storyboardVersion:1,resultVersion:1,
      contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[MOCK_IDS.card],state:'pending',readyVersion:null,proposal:null};
    const execution={worker:{state:'unknown',reason:null,checkedAt:null},queue:null};
    expect(ProjectSnapshotSchema.safeParse({...p,factReview,factIssues:[],execution}).success).toBe(true);
    expect(ProjectSnapshotSchema.safeParse({...p,factReview:{...factReview,claimIndices:[0,0]}}).success).toBe(false);
  });
});
