import {describe,it,expect,vi} from 'vitest';
import {inspectAccountMetadata,subscriptionPreflight} from '../../src/providers/구독검증.js';
import {childEnvironment} from '../../src/providers/자식환경.js';
const livePermission={inference:true,search:true,image:true,approvalReference:'t_dc7d2a44'} as const;
describe('연결 준비 OFFLINE metadata 판정 — 자격증명/모델 접근 없음',()=>{
 it.each(['Claude Team','Claude Pro','Claude Max','team','pro','max'])('양성 firstParty 구독 수용: %s',subscriptionType=>{
  expect(()=>inspectAccountMetadata({apiProvider:'firstParty',subscriptionType})).not.toThrow();
 });
 it.each([{}, {subscriptionType:'Claude Team'}, {apiProvider:'firstParty'}, {apiProvider:'firstParty',subscriptionType:'unknown'}])('불명 경로 거절 %j',a=>{
  expect(()=>inspectAccountMetadata(a as never)).toThrowError(expect.objectContaining({code:'AUTH_MODE_UNKNOWN'}));
 });
 it.each([{apiProvider:'gateway',subscriptionType:'Claude Team'},{apiProvider:'firstParty',subscriptionType:'Claude Team',apiKeySource:'apiKeyHelper'},{apiProvider:'firstParty',subscriptionType:'Claude Team',tokenSource:'apiKeyHelper'}])('금지 active route 거절 %j',a=>{
  expect(()=>inspectAccountMetadata(a as never)).toThrowError(expect.objectContaining({code:'AUTH_PATH_FORBIDDEN'}));
 });
 it('실사용 승인은 초기화 허가일 뿐 인증 attestation/크레딧 확인을 꾸미지 않음',async()=>{
  await expect(subscriptionPreflight({livePermission})).resolves.toBeUndefined();
  await expect(subscriptionPreflight({livePermission:{inference:false,search:false,image:false}})).rejects.toHaveProperty('code','AUTH_MODE_UNKNOWN');
 });
 it('정상 기존 사용자 login lookup 디렉터리 보존, API/cloud/token overrides 제거',()=>{
  const env=childEnvironment({USERPROFILE:'user',HOME:'home',APPDATA:'app',LOCALAPPDATA:'local',CLAUDE_CONFIG_DIR:process.cwd(),ANTHROPIC_API_KEY:'synthetic',CLAUDE_CODE_OAUTH_TOKEN:'synthetic'});
  expect(env).toEqual({USERPROFILE:'user',HOME:'home',APPDATA:'app',LOCALAPPDATA:'local',CLAUDE_CONFIG_DIR:process.cwd()});
 });
});
