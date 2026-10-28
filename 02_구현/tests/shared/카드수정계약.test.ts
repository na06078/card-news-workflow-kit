import {test,expect} from 'vitest';
import {RunSchema,RequestSchemas,EngineContextSchema} from '../../src/shared/포트.js';
const id='11111111-1111-4111-8111-111111111111';
const run={runId:id,projectId:id,kind:'revision',status:'succeeded',attempt:1,phase:'revision',createdAt:'2026-10-28T04:00:00.000Z',updatedAt:'2026-10-28T04:00:00.000Z',lastEventSeq:1,questionId:null,error:null,externalOutcome:'known',retryAllowed:false};
test('새로고침 뒤 범위 확인에 필요한 원래 수정 지시만 공개한다',()=>{
 const request={scope:'layout',cardIds:[id],instruction:'문구를 바꾸고 싶습니다.'};
 expect(RunSchema.parse({...run,revisionRequest:request})).toHaveProperty('revisionRequest',request);
});
test('새 수정 계약의 정상 범위 확인 결과와 실제 적용 기록을 Run에 보존한다',()=>{
 const outcome={kind:'revision',status:'needs_scope',requestedScope:'text',reason:'문구 변경은 원고 수정에서 확인하세요.'};
 expect(RunSchema.parse({...run,revisionProtocol:2,revisionOutcome:outcome})).toEqual({...run,revisionProtocol:2,revisionOutcome:outcome});
 expect(RunSchema.parse({...run,revisionProtocol:2,revisionApplied:{resultVersion:2,cardRevisions:[{cardId:id,revision:2}]}})).toHaveProperty('revisionApplied.resultVersion',2);
 expect(RunSchema.parse(run)).toEqual(run);
});
test('프로토콜은 서버 context에서만 추가되며 클라이언트가 결과나 적용 기록을 주입하지 못한다',()=>{
 expect(EngineContextSchema.parse({projectId:id,runId:id,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:'C:/example',phase:'revision',baseProjectVersion:1,revisionProtocol:2})).toHaveProperty('revisionProtocol',2);
 expect(()=>RequestSchemas.revisions.parse({requestId:id,version:1,scope:'layout',cardIds:[id],instruction:'가운데 정렬',revisionProtocol:2})).toThrow();
});
