import {it,expect} from 'vitest';
import {ERROR_HTTP,type ErrorCode} from '../../src/shared/포트.js';
import {appError,ProviderFailure} from '../../src/providers/오류.js';
it.each([
 {code:'REVIEW_TIMEOUT',status:504,reason:/시간/},
 {code:'FACT_FETCH_NOT_ATTEMPTED',status:502,reason:/원문/},
])('실제 검수 실패 $code를 일반 내용 검사로 감추지 않는다',({code,status,reason})=>{
 expect((ERROR_HTTP as Record<string,number>)[code]).toBe(status);
 const e=appError(new ProviderFailure(code as ErrorCode));expect(e.message).toMatch(reason);expect(e.nextActions).toContain('reverify_facts');
});
