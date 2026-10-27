import {expect,it} from 'vitest';
import {appError,ProviderFailure} from '../../src/providers/오류.js';

it.each([
 ['FACT_REVIEW_FAILED','재검증'],
 ['FACT_PROPOSAL_STALE','최신'],
 ['FACT_SCOPE_INVALID','선택'],
 ['WORKER_UNAVAILABLE','처리기'],
] as const)('새 복구 경계 %s를 파일 오류로 잘못 설명하지 않는다',(code,word)=>{
 const error=appError(new ProviderFailure(code));
 expect(error.message).toContain(word);
 expect(error.message).not.toBe('공급자 응답 또는 파일 검증에 실패했습니다.');
 expect(error.nextActions).toEqual(['contact_user']);
});
