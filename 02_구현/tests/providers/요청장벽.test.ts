import {it,expect,vi,beforeEach} from 'vitest';
import type {Options,SDKMessage,AccountInfo} from '@anthropic-ai/claude-agent-sdk';
import type {ProviderBridge,EventDraft,EngineEvent,EngineContext} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
const native=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:native.query}));
vi.mock('../../src/providers/프로세스격리.js',()=>({ownedDescendantsExited:async()=>true,captureDescendantCheck:()=>async()=>null}));
import {createClaudeAdapter} from '../../src/providers/클로드.js';
const livePermission={inference:true,search:true,image:true,approvalReference:'t_dc7d2a44'} as const;
const session='11111111-1111-4111-8111-111111111111';
const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'research',baseProjectVersion:2};
const snapshot=()=>({...createMockSnapshot('selection'),dataMode:'real' as const});
function bridge(){let seq=0;const event=(d:EventDraft):EngineEvent=>({...d,seq:++seq,projectId:I.project,runId:I.run,attempt:1,at:'2026-10-23T00:00:00Z'});return {progress:vi.fn(async(_c,d)=>event(d)),openQuestion:vi.fn(),waitForAnswer:vi.fn(),publishResult:vi.fn(async()=>event({type:'result',kind:'candidates',version:2})),publishError:vi.fn(async(_c,e)=>event({type:'error',error:e})),saveSession:vi.fn(),status:vi.fn()} satisfies ProviderBridge;}
const collect=async(it:AsyncIterable<EngineEvent>)=>{const out=[];for await(const e of it)out.push(e);return out;};
function setup(){let verify!:(a:AccountInfo)=>void,deny!:(e:Error)=>void,yielded=0;const metadata=new Promise<AccountInfo>((r,j)=>{verify=r;deny=j;});let options:Options|undefined;
 const close=vi.fn();const initializationResult=vi.fn(async()=>({account:await metadata}));const accountInfo=vi.fn(()=>metadata);
 native.query.mockImplementation(({prompt,options:o})=>{options=o;const input=prompt[Symbol.asyncIterator]();const consumed=input.next().then((m:IteratorResult<unknown>)=>{if(!m.done)yielded++;});
  return Object.assign((async function*(){await consumed;const s=snapshot();yield {type:'system',subtype:'init',session_id:session,cwd:process.cwd(),tools:['WebSearch','WebFetch'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'} as unknown as SDKMessage;yield {type:'result',subtype:'success',session_id:session,is_error:false,permission_denials:[],structured_output:{kind:'candidates',researchVersion:2,candidates:s.candidates.map(c=>({...c,researchVersion:2})),sources:s.sources,shortageReason:'OFFLINE synthetic'}} as unknown as SDKMessage;})(),{close,initializationResult,accountInfo});
 });return {verify,deny,close,initializationResult,accountInfo,get yielded(){return yielded;},get options(){return options!;}};
}
beforeEach(()=>{native.query.mockReset();});
it('같은 Query 초기화·accountInfo 확인 전 prompt0, 확인 후 사용자 요청1회만',async()=>{
 const f=setup(),b=bridge(),a=createClaudeAdapter({bridge:b,livePermission});const done=collect(a.start(context,{snapshot:snapshot()}));
 await vi.waitFor(()=>expect(native.query).toHaveBeenCalledOnce());expect(f.yielded).toBe(0);expect(f.initializationResult).toHaveBeenCalledOnce();
 f.verify({apiProvider:'firstParty',subscriptionType:'Claude Team'});const events=await done;
 expect(f.accountInfo).toHaveBeenCalledOnce();expect(f.yielded).toBe(1);expect(events.at(-1)?.type).toBe('result');expect(f.close).toHaveBeenCalled();expect(f.options).not.toHaveProperty('model');expect(f.options).not.toHaveProperty('fallbackModel');await a.dispose();
});
it.each([{apiProvider:'gateway',subscriptionType:'Claude Team'},{apiProvider:'firstParty',subscriptionType:'Claude Team',apiKeySource:'apiKeyHelper'},{}])('거절 metadata는 보류 prompt 해제 없이 종료 %j',async account=>{
 const f=setup(),b=bridge(),a=createClaudeAdapter({bridge:b,livePermission});const done=collect(a.start(context,{snapshot:snapshot()}));await vi.waitFor(()=>expect(native.query).toHaveBeenCalledOnce());f.verify(account as AccountInfo);const events=await done;expect(events.at(-1)?.type).toBe('error');expect(f.yielded).toBe(0);expect(b.publishResult).not.toHaveBeenCalled();expect(f.close).toHaveBeenCalled();await a.dispose();
});
it('native 인증 만료는 LOGIN_REQUIRED, query 추가 실행/프롬프트 없음',async()=>{
 const f=setup(),b=bridge(),a=createClaudeAdapter({bridge:b,livePermission});const done=collect(a.start(context,{snapshot:snapshot()}));await vi.waitFor(()=>expect(native.query).toHaveBeenCalledOnce());f.deny(new Error('authentication required'));
 expect((await done).at(-1)).toMatchObject({type:'error',error:{code:'LOGIN_REQUIRED'}});expect(f.yielded).toBe(0);expect(native.query).toHaveBeenCalledOnce();await a.dispose();
});
it('초기화 취소는 보류 stream 종료, prompt0',async()=>{
 const f=setup(),b=bridge(),ac=new AbortController(),a=createClaudeAdapter({bridge:b,livePermission,signal:ac.signal});const done=collect(a.start(context,{snapshot:snapshot()}));await vi.waitFor(()=>expect(native.query).toHaveBeenCalledOnce());ac.abort();await done;expect(f.yielded).toBe(0);expect(f.close).toHaveBeenCalled();await a.dispose();
});
it('SDK 구성·출력 형식 초기화 실패는 로그인 오류로 오분류하지 않는다',async()=>{
 const f=setup(),b=bridge(),a=createClaudeAdapter({bridge:b,livePermission});
 const done=collect(a.start(context,{snapshot:snapshot()}));
 await vi.waitFor(()=>expect(native.query).toHaveBeenCalledOnce());
 f.deny(new Error('Claude Code process exited with code 1'));
 expect((await done).at(-1)).toMatchObject({type:'error',error:{code:'PROVIDER_PROTOCOL_ERROR',nextActions:['contact_user']}});
 expect(f.yielded).toBe(0);expect(native.query).toHaveBeenCalledOnce();
 await a.dispose();
});
