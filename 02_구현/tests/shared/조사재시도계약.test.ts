import {test,expect} from 'vitest';
import {RunSchema} from '../../src/shared/포트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
test('공개 Run은 원래 결과 불명의 확인 요구를 선택적 boolean으로 전달한다',()=>{
 const run=createMockSnapshot('question').activeRun!;
 expect(RunSchema.safeParse(run).success).toBe(true);
 expect(RunSchema.safeParse({...run,retryRequiresUnknownConfirmation:true}).success).toBe(true);
 expect(RunSchema.safeParse({...run,retryRequiresUnknownConfirmation:'yes'}).success).toBe(false);
});
