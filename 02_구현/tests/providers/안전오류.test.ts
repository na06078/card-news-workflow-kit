import {it,expect} from 'vitest';
import {appError,ProviderFailure} from '../../src/providers/오류.js';
it('B16 검색 도구 부재는 검색 전용 원인과 안전한 사용자 확인을 안내한다',()=>{
 const e=appError(new ProviderFailure('SEARCH_TOOL_UNAVAILABLE'));
 expect(e.message).toContain('검색 도구');expect(e.message).toContain('확인');
 expect(e.nextActions).toEqual(['contact_user']);expect(e.retryable).toBe(false);
});
it('B16 이미지 요청 제한과 구독 소진을 구분하고 유효한 대기 시간만 공개한다',()=>{
 const rate=appError(new ProviderFailure('AGY_RATE_LIMIT',{retryAfterSeconds:12}));
 const quota=appError(new ProviderFailure('SUBSCRIPTION_QUOTA'));
 expect(rate.message).toContain('계정 전체 구독 소진 여부는 확인되지');expect(quota.message).toContain('구독 한도');
 expect(rate.details?.retryAfterSeconds).toBe(12);expect(rate.nextActions).toEqual(['wait_quota']);
 for(const retryAfterSeconds of [-1,NaN,Infinity])expect(appError(new ProviderFailure('AGY_RATE_LIMIT',{retryAfterSeconds})).details).not.toHaveProperty('retryAfterSeconds');
 expect(JSON.stringify(appError(Error('SENSITIVE_TOKEN C:/private stdout subscription quota')))).not.toContain('SENSITIVE_TOKEN');
});
