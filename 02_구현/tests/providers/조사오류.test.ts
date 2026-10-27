import {test,expect} from 'vitest';
import {appError,ProviderFailure} from '../../src/providers/오류.js';
test('조사 내용 검증 실패를 그림 파일 오류로 안내하지 않는다',()=>{
 const error=appError(new ProviderFailure('RESEARCH_FAILED'));
 expect(error.code).toBe('RESEARCH_FAILED');expect(error.message).toContain('출처');expect(error.message).not.toContain('파일');
});
