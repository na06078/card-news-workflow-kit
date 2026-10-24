import {test,expect} from 'vitest';
import {EngineEventSchema} from '../../src/shared/포트.js';
import {MOCK_IDS as I} from '../../src/shared/모의자료.js';
test('선택 activity는 기존 이벤트와 호환되고 실제 카드 ID만 허용한다',()=>{
 const e={type:'progress',seq:1,projectId:I.project,runId:I.run,attempt:1,at:'2026-10-23T00:00:00Z',phase:'image',message:'그림 생성',completed:0,total:2};
 expect(EngineEventSchema.safeParse(e).success).toBe(true);
 expect(EngineEventSchema.safeParse({...e,activity:{provider:'agy',operation:'image',status:'started',cardId:I.project,tool:'generate_image'}}).success).toBe(true);
 expect(EngineEventSchema.safeParse({...e,activity:{provider:'agy',operation:'image',status:'started',cardId:'card-1'}}).success).toBe(false);
});
