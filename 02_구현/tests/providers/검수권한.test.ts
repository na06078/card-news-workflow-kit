import {it,expect} from 'vitest';
import * as auth from '../../src/providers/구독검증.js';
it('검수 전용 구독 사전 검사는 별도 추론 승인 경계를 제공한다',()=>{
 expect(auth).toHaveProperty('reviewSubscriptionPreflight');
});
it('추론 전용 승인은 검색·이미지 권한 없이 가능하다',async()=>{
 await expect(auth.reviewSubscriptionPreflight({livePermission:{inference:true,approvalReference:'명시 검수 동작'}})).resolves.toBeUndefined();
});
it.each([{inference:false,approvalReference:'거절'},{inference:true},{inference:true,approvalReference:' '}])('승인 없는 검수는 시작하지 않는다 %j',async livePermission=>{
 await expect(auth.reviewSubscriptionPreflight({livePermission})).rejects.toMatchObject({code:'AUTH_MODE_UNKNOWN'});
});
it('기존 수집·작성용 세 권한 guard는 그대로다',async()=>{
 await expect(auth.subscriptionPreflight({livePermission:{inference:false,search:false,image:false}})).rejects.toMatchObject({code:'AUTH_MODE_UNKNOWN'});
 await expect(auth.subscriptionPreflight({livePermission:{inference:true,search:true,image:true,approvalReference:'기존 승인'}})).resolves.toBeUndefined();
});
