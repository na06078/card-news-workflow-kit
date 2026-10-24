import {describe,it,expect} from 'vitest';
import {CreateProjectRequestSchema,ProjectSnapshotSchema,RunSchema,EngineContextSchema,EngineEventSchema} from '../../src/shared/검증.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
const id='83f4beb1-0290-4637-b764-cc847567a818';
describe('프로젝트별 모델 호환 계약',()=>{
 it('새 프로젝트의 명시 모델을 보존하고 기존 입력도 허용한다',()=>{
  const input={topic:'주제',createRequestId:id,claudeModel:'sonnet'};
  expect(CreateProjectRequestSchema.safeParse(input).success).toBe(true);
  expect(CreateProjectRequestSchema.parse(input).claudeModel).toBe('sonnet');
  expect(CreateProjectRequestSchema.safeParse({topic:'주제',createRequestId:id}).success).toBe(true);
  expect(CreateProjectRequestSchema.safeParse({...input,claudeModel:'bad\nvalue'}).success).toBe(false);
 });
 it('기존 스냅샷과 콘텐츠 버전과 분리한 모델 설정을 허용한다',()=>{
  const p=createMockSnapshot();expect(ProjectSnapshotSchema.safeParse(p).success).toBe(true);
  expect(ProjectSnapshotSchema.safeParse({...p,claudeModel:'sonnet',modelSettingsVersion:0}).success).toBe(true);
 });
 it('요청 모델과 실제 관측 모델을 실행 및 이벤트에 기록한다',()=>{
  const run={runId:id,projectId:id,kind:'research',status:'queued',attempt:1,phase:'research',createdAt:'2026-10-24T13:00:00Z',updatedAt:'2026-10-24T13:00:00Z',lastEventSeq:0,questionId:null,error:null,externalOutcome:'not_started',retryAllowed:false,requestedModel:'sonnet',actualModel:'claude-test-sonnet'};
  expect(RunSchema.safeParse(run).success).toBe(true);
  expect(EngineContextSchema.safeParse({projectId:id,runId:id,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:'C:/test',phase:'research',baseProjectVersion:1,requestedModel:'sonnet'}).success).toBe(true);
  expect(EngineEventSchema.safeParse({type:'progress',seq:1,at:run.createdAt,projectId:id,runId:id,attempt:1,phase:'research',message:'모델 확인',completed:null,total:null,actualModel:'claude-test-sonnet'}).success).toBe(true);
 });
});
