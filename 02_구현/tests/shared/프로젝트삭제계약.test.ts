import {it,expect} from 'vitest';
import * as W from '../../src/shared/작업공간계약.js';
import {ERROR_HTTP} from '../../src/shared/계약.js';
const id='d8791497-266c-4a09-8ac7-6f41bce182a8';
it('독립 목록의 현재 버전과 삭제 미완료를 전달한다',()=>{
 expect(W.ProjectSummarySchema.safeParse({projectId:id,topic:'삭제 시험',stage:'topic',status:'idle',updatedAt:'2026-10-24T14:00:00Z',cardCount:0,activeRunId:null,claudeModel:null,projectVersion:1,deletionPending:true}).success).toBe(true);
});
it('명시 확인과 양수 버전이 있는 영구삭제 요청만 허용한다',()=>{
 expect(W.DeleteProjectRequestSchema).toBeDefined();
 expect(W.DeleteProjectRequestSchema.safeParse({requestId:id,version:1,confirm:true}).success).toBe(true);
 expect(W.DeleteProjectRequestSchema.safeParse({requestId:id,version:1,confirm:false}).success).toBe(false);
 expect(W.DeleteProjectRequestSchema.safeParse({requestId:id,version:0,confirm:true}).success).toBe(false);
 expect(W.DeleteProjectResponseSchema.safeParse({projectId:id,deleted:true}).success).toBe(true);
});
it('삭제 경합과 부분 실패를 다른 오류로 전달한다',()=>{
 expect(ERROR_HTTP.PROJECT_DELETING).toBe(409);expect(ERROR_HTTP.PROJECT_DELETE_FAILED).toBe(503);
});
