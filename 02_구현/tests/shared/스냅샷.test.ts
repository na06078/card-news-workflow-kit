import {describe,it,expect} from 'vitest';
import * as boundary from '../../src/shared/검증.js';
const api=boundary as Record<string,any>;
const id='a1111111-1111-4111-8111-111111111111';
export const snapshot={projectId:id,topic:'모의 주제',projectVersion:1,stage:'topic',status:'idle',period:{days:7,anchorAt:'2026-10-23T00:00:00Z',from:'2026-10-16T00:00:00Z',to:'2026-10-23T00:00:00Z'},researchVersion:0,candidates:[],sources:[],claims:[],selectedCandidateIds:[],question:null,storyboard:null,result:null,activeRun:null,lastRun:null,allowedActions:[],exports:[],dataMode:'mock'};
describe('스냅샷과 질문/렌더 경계',()=>{
 it('명시 mock 스냅샷을 JSON 왕복하고 미지 필드·프로젝트 교차 참조를 거절한다',()=>{
   expect(api.ProjectSnapshotSchema).toBeDefined();
   expect(api.ProjectSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
   expect(api.ProjectSnapshotSchema.safeParse({...snapshot,engineSessionId:'비공개'}).success).toBe(false);
   expect(api.ProjectSnapshotSchema.safeParse({...snapshot,selectedCandidateIds:[id]}).success).toBe(false);
 });
 it('질문별 유효 선택·버전·전 항목 답변을 검사한다',()=>{
   expect(api.validateAnswer).toBeTypeOf('function');
   const q={questionId:id,version:2,runId:null,kind:'editorial',status:'open',createdAt:'2026-10-23T00:00:00Z',items:[{itemId:'audience',text:'누구에게?',header:'독자',options:[{optionId:'dev',label:'개발자',description:'기술 중심'},{optionId:'public',label:'일반인',description:'쉬운 설명'}],multiSelect:false,allowFreeText:true,recommendedOptionId:'public',recommendationReason:'입문자'}]};
   const req={requestId:id,questionId:id,version:2,answer:[{itemId:'audience',optionIds:['dev'],text:null}]};
   expect(()=>api.validateAnswer(q,req)).not.toThrow();
   for(const bad of [{...req,version:1},{...req,answer:[]},{...req,answer:[{itemId:'audience',optionIds:['dev','public'],text:null}]},{...req,answer:[{itemId:'audience',optionIds:['unknown'],text:null}]}]) expect(()=>api.validateAnswer(q,bad)).toThrow();
   expect(()=>api.validateAnswer({...q,status:'answered'},req)).toThrow();
 });
 it('UTC/실제 달력 날짜·공개 HTTPS 형식·렌더 크기를 검사한다',()=>{
   expect(api.SourceSchema).toBeDefined();
   const source={sourceId:id,candidateId:id,url:'https://example.org/report',title:'모의 출처',publisher:null,publishedDate:null,eventDate:null,accessedAt:null,primary:true,access:'not_opened',evidence:null,limitations:[]};
   expect(api.SourceSchema.safeParse(source).success).toBe(true);
   for(const publishedDate of ['2026-02-30','today','2026-10-23T09:00:00+09:00']) expect(api.SourceSchema.safeParse({...source,publishedDate}).success).toBe(false);
   for(const url of ['http://example.org','file:///x','https://user:pass@example.org','https://127.0.0.1/x']) expect(api.SourceSchema.safeParse({...source,url}).success).toBe(false);
   expect(api.RenderOutputSchema).toBeDefined();
   expect(api.AppErrorSchema).toBeDefined();
 });
});
