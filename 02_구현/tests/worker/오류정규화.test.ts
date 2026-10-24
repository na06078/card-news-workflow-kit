import {test,expect} from 'vitest';
import {normalizeError,workerError} from '../../src/worker/실행단계.js';
import {appError,ProviderFailure} from '../../src/providers/오류.js';
import type {LeaseFence} from '../../src/shared/포트.js';
for(const code of ['CANCEL_CLEANUP_FAILED','SESSION_RECOVERY_UNVERIFIED'])test(`${code} 작업자 자체 오류는 사용자 확인 없이 재실행하도록 안내하지 않는다`,()=>{expect(workerError(code,fence)).toMatchObject({retryable:false,nextActions:['contact_user']});});
const fence:LeaseFence={projectId:'a1111111-1111-4111-8111-111111111111',runId:'d1111111-1111-4111-8111-111111111111',attempt:1,ownerId:'test',fencingToken:1,baseProjectVersion:3};
for(const code of ['AUTH_MODE_UNKNOWN','LOGIN_REQUIRED','SUBSCRIPTION_QUOTA','SESSION_RECOVERY_UNVERIFIED'] as const)test(`${code} 정규화는 실제 G1의 재시도/다음 행동 계약을 보존한다`,()=>{
 const original=appError(new ProviderFailure(code));const normalized=normalizeError(original,fence);expect(normalized.code).toBe(code);expect(normalized.retryable).toBe(original.retryable);expect(normalized.nextActions).toEqual(original.nextActions);expect(normalized.projectId).toBe(fence.projectId);
});
test('이미지 rate 제한은 계정 구독 소진으로 단정하지 않고 안전한 재시도 시간만 보존한다',()=>{
 const out=normalizeError(new ProviderFailure('AGY_RATE_LIMIT',{retryAfterSeconds:30}),fence);
 expect(out.message).toContain('이미지 도구');expect(out.message).not.toContain('구독 한도에 도달');expect(out.nextActions).toEqual(['wait_quota']);expect(out.details.retryAfterSeconds).toBe(30);
 expect(normalizeError(new ProviderFailure('RENDER_FAILED'),fence).message).toContain('렌더');
});
test('미지 외부 code/message/details는 공개 로그로 전파하지 않는다',()=>{const out=normalizeError({code:'SECRET_TOKEN',message:'SECRET_TOKEN',details:{reason:'SECRET_TOKEN'}},fence);expect(out.code).toBe('PROVIDER_PROTOCOL_ERROR');expect(JSON.stringify(out)).not.toContain('SECRET_TOKEN');});
