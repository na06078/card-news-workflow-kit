import {describe,it,expect,vi} from 'vitest';
import {subscriptionPreflight, inspectAccountMetadata} from '../../src/providers/구독검증.js';
import {childEnvironment, assertChildEnvironment} from '../../src/providers/자식환경.js';

describe('OFFLINE 구독 경계 — 계정/자격증명 접근 없음',()=>{
 it('승인·크레딧 근거가 있어도 같은 자식 양성 증거 없으면 prompt 0',async()=>{
  const prompt=vi.fn();
  await expect((async()=>{await subscriptionPreflight({livePermission:{inference:true,search:true,image:true,approvalReference:'offline-test'}});inspectAccountMetadata({});prompt();})()).rejects.toMatchObject({code:'AUTH_MODE_UNKNOWN'});
  expect(prompt).not.toHaveBeenCalled();
 });
 it.each([{}, {apiKeySource:'none'}, {tokenSource:'oauth',subscriptionType:'max',apiKeySource:'none'}])('positive firstParty 구독 근거 없는 metadata는 거절 %j',(account)=>{
  expect(()=>inspectAccountMetadata(account)).toThrowError(expect.objectContaining({code:'AUTH_MODE_UNKNOWN'}));
 });
 it.each([{apiKeySource:'ANTHROPIC_API_KEY'}, {apiKeySource:'/login managed key'}, {apiProvider:'bedrock' as const}, {apiProvider:'gateway' as const}])('금지 metadata %j',(account)=>{
  expect(()=>inspectAccountMetadata(account)).toThrowError(expect.objectContaining({code:'AUTH_PATH_FORBIDDEN'}));
 });
 it('자식 환경은 allowlist 복사만 하며 host 값/정책을 변경하지 않음',()=>{
  const host=Object.freeze({PATH:'test-path',SystemRoot:'test-root',ANTHROPIC_API_KEY:'synthetic-not-a-key',CLAUDE_CODE_OAUTH_TOKEN:'synthetic-not-a-token',CLAUDE_CODE_USE_BEDROCK:'1',AWS_PROFILE:'test',HTTPS_PROXY:'test',NODE_OPTIONS:'test',CLAUDE_CONFIG_DIR:'test'});
  const child=childEnvironment(host);
  expect(child).toEqual({PATH:'test-path',SystemRoot:'test-root'});
  expect(host.ANTHROPIC_API_KEY).toBe('synthetic-not-a-key');
  expect(()=>assertChildEnvironment({...child,ANTHROPIC_API_KEY:'synthetic'})).toThrowError(expect.objectContaining({code:'AUTH_PATH_FORBIDDEN'}));
  expect(()=>assertChildEnvironment({...child,CLAUDE_CODE_ENTRYPOINT:'sdk-ts'})).not.toThrow();
 });
 it('설치 SDK가 실제로 추가하는 비인증 marker만 정확한 값으로 허용',()=>{
  expect(()=>assertChildEnvironment({CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_AGENT_SDK_VERSION:'0.3.309',CLAUDE_CODE_SDK_READS_SESSION_STATE:'1',CLAUDE_CODE_SDK_READS_STARTUP_MARKS:'1'})).not.toThrow();
  expect(()=>assertChildEnvironment({CLAUDE_AGENT_SDK_VERSION:'unknown'})).toThrow();
  expect(()=>assertChildEnvironment({CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH:'1'})).toThrow();
 });
});
