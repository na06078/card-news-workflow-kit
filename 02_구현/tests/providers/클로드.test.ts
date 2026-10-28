import {describe,it,expect,vi} from 'vitest';
import type {Options,SDKMessage,Query} from '@anthropic-ai/claude-agent-sdk';
import type {AnswerItem,EngineContext,ProviderBridge,EngineEvent,EventDraft,EngineContent} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {createClaudeAdapter,createOfflineClaudeAdapter, type QueryFactory} from '../../src/providers/클로드.js';
const at='2026-10-23T00:00:00Z',session='11111111-1111-4111-8111-111111111111';
const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'research',baseProjectVersion:2};
const permission={inference:false,search:false,image:false} as const;
function bridge(){let seq=0;const event=(draft:EventDraft):EngineEvent=>({...draft,seq:++seq,projectId:I.project,runId:I.run,attempt:1,at});
 return {progress:vi.fn(async(_c,d)=>event(d)),openQuestion:vi.fn(async(_c,q)=>event({type:'need_input',question:q.question})),waitForAnswer:vi.fn(async():Promise<AnswerItem[]>=>[]),publishResult:vi.fn(async(_c,content:EngineContent)=>event(content.kind==='revision'?{type:'progress',phase:'revision',message:'수정 결정 준비',completed:null,total:null}:{type:'result',kind:content.kind,version:1})),publishError:vi.fn(async(_c,e)=>event({type:'error',error:e})),saveSession:vi.fn(async()=>{}),status:vi.fn()} satisfies ProviderBridge;
}
const collect=async(it:AsyncIterable<EngineEvent>)=>{const out=[];for await(const e of it)out.push(e);return out;};
function fakeQuery(events:unknown[],effect?:(options:Options)=>Promise<void>){let options:Options|undefined;const close=vi.fn();
 const query:QueryFactory=vi.fn(({prompt,options:o})=>{options=o;return Object.assign((async function*(){if(typeof prompt!=='string')for await(const _ of prompt){};if(effect)await effect(o!);for(const event of events)yield event as SDKMessage;})(),{close});});return {query,close,get options(){return options!;}};
}
const init=()=>({type:'system',subtype:'init',session_id:session,cwd:process.cwd(),tools:['WebSearch','WebFetch'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'});
const result=()=>{const s=createMockSnapshot('selection');return {type:'result',subtype:'success',session_id:session,is_error:false,permission_denials:[],structured_output:{kind:'candidates',researchVersion:2,candidates:s.candidates.map(c=>({...c,researchVersion:2})),sources:s.sources,shortageReason:'합성 fixture'}};};
describe('OFFLINE SDK 프로토콜 fake — 모델 호출 없음',()=>{
 it('실제 tool_use/tool_result 프레임만 안전한 시작/완료/실패로 중계한다',async()=>{
  const f=fakeQuery([init(),{type:'assistant',session_id:session,message:{content:[{type:'tool_use',id:'a',name:'WebSearch',input:{query:'SECRET_QUERY'}}]}},{type:'user',session_id:session,message:{content:[{type:'tool_result',tool_use_id:'a',content:'SECRET_RESULT'}]}},{type:'assistant',session_id:session,message:{content:[{type:'tool_use',id:'b',name:'WebFetch',input:{url:'SECRET_URL'}}]}},{type:'user',session_id:session,message:{content:[{type:'tool_result',tool_use_id:'b',is_error:true,content:'SECRET_ERROR'}]}},result()]),b=bridge();
  const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));
  expect(events.filter(e=>e.type==='progress'&&e.activity).map(e=>e.type==='progress'&&e.activity)).toEqual([
   {provider:'claude',operation:'search',status:'started',tool:'WebSearch'}, {provider:'claude',operation:'search',status:'completed',tool:'WebSearch'},
   {provider:'claude',operation:'fetch',status:'started',tool:'WebFetch'}, {provider:'claude',operation:'fetch',status:'failed',tool:'WebFetch'}]);
  expect(JSON.stringify(events)).not.toContain('SECRET_');await a.dispose();
 });
 it('production 승인 false 또는 mock snapshot은 query/import 전 거절',async()=>{
  for(const livePermission of [permission,{inference:true,search:true,image:true,approvalReference:'test'}] as const){const b=bridge();const a=createClaudeAdapter({bridge:b,livePermission});const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));expect(events.at(-1)).toMatchObject({type:'error',error:{code:livePermission.inference?'AUTH_PATH_FORBIDDEN':'AUTH_MODE_UNKNOWN'}});expect(b.saveSession).not.toHaveBeenCalled();await a.dispose();}
 });
 it('fake init/result 검증 후만 DB commit event yield, tool/options/no fallback/명시 resume',async()=>{
  const f=fakeQuery([init(),result()]),b=bridge();const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));
  expect(events.at(-1)?.type).toBe('result');expect(b.publishResult).toHaveBeenCalledOnce();expect(b.saveSession).toHaveBeenCalledWith(context,session);
  expect(f.options).toMatchObject({tools:['WebSearch','WebFetch'],settingSources:[],strictMcpConfig:true,mcpServers:{},permissionMode:'default',settings:{autoMemoryEnabled:false}});
  expect(f.options).not.toHaveProperty('fallbackModel');expect(f.options).not.toHaveProperty('continue');expect(f.options).not.toHaveProperty('model');
  await collect(a.start({...context,engineSessionId:session},{snapshot:createMockSnapshot('selection')}));expect(f.options.resume).toBe(session);expect(f.close).toHaveBeenCalledTimes(2);await a.dispose();
 });
 it.each([[{...init(),session_id:'other'},result()],[init(),{...result(),structured_output:{bad:1}}],[init(),{...result(),is_error:true}],[init()]].map(events=>({events})))('malformed/session mismatch/완료 없음 성공 금지',async ({events:ev})=>{
  const f=fakeQuery(ev),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start({...context,engineSessionId:null},{snapshot:createMockSnapshot('selection')}));expect(events.at(-1)?.type).toBe('error');expect(b.publishResult).not.toHaveBeenCalled();await a.dispose();
 });
 it('새 adapter의 pending session 복구 불명: explicit id 있어도 자동 재개 금지',async()=>{
  const f=fakeQuery([]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const events=await collect(a.start({...context,engineSessionId:session},{snapshot:createMockSnapshot('selection')}));expect(events.at(-1)).toMatchObject({type:'error',error:{code:'SESSION_RECOVERY_UNVERIFIED'}});expect(f.query).not.toHaveBeenCalled();
 });
 it.each([{type:'rate_limit_event',session_id:session,rate_limit_info:{status:'rejected'}}, {type:'rate_limit_event',session_id:session,rate_limit_info:{status:'allowed',overageEnabled:true}}, {type:'rate_limit_event',session_id:session,rate_limit_info:{status:'allowed',isUsingOverage:true}}, {...result(),permission_denials:[{tool_name:'WebSearch'}]}])('구독한도/overage/permission denial는 fallback 없이 중단',async e=>{
  const f=fakeQuery([init(),e]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));const code=e.type==='rate_limit_event'?('overageEnabled'in (e.rate_limit_info??{})||'isUsingOverage'in (e.rate_limit_info??{})?'AUTH_PATH_FORBIDDEN':'SUBSCRIPTION_QUOTA'):'TOOL_PERMISSION_DENIED';expect(events.at(-1)).toMatchObject({type:'error',error:{code}});expect(f.query).toHaveBeenCalledOnce();expect(b.publishResult).not.toHaveBeenCalled();
 });
 it('editorial 질문 원본→DB 대기→updatedInput, 임의 tool deny',async()=>{
  const b=bridge(),snapshot=createMockSnapshot('storyboard');snapshot.storyboard=null;
  b.waitForAnswer.mockImplementation(async()=>[{itemId:'q0',optionIds:['o1'],text:null}]);
  const original={questions:[{question:'독자는?',header:'독자',options:[{label:'일반인',description:'쉽게'},{label:'개발자',description:'깊게'}],multiSelect:false}]};
  const f=fakeQuery([{...init(),tools:['WebSearch','WebFetch','AskUserQuestion']},{...result(),structured_output:{kind:'storyboard',storyboard:createMockSnapshot('storyboard').storyboard,sources:snapshot.sources,claims:[]}}],async o=>{
   expect(await o.canUseTool!('Bash',{command:'test'},{signal:new AbortController().signal,toolUseID:'deny',requestId:'test'})).toMatchObject({behavior:'deny'});
   expect(await o.canUseTool!('AskUserQuestion',original,{signal:new AbortController().signal,toolUseID:'ask',requestId:'test'})).toEqual({behavior:'allow',updatedInput:{questions:original.questions,answers:{'독자는?':'개발자'}}});
  });
  const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const events=await collect(a.start({...context,phase:'editorial',baseProjectVersion:snapshot.projectVersion},{snapshot}));
  expect(events.some(e=>e.type==='need_input')).toBe(true);expect(events.at(-1)?.type).toBe('result');expect(b.openQuestion).toHaveBeenCalledOnce();
 });
 it('질문 callback 취소는 query.close/AbortSignal과 대기 해제까지 완료',async()=>{
  let resolveOpened:()=>void=()=>{};const opened={promise:new Promise<void>(r=>{resolveOpened=r;})};const b=bridge();b.openQuestion.mockImplementation(async(_c,q)=>{resolveOpened();return {type:'need_input',question:q.question,seq:1,at,projectId:I.project,runId:I.run,attempt:1};});b.waitForAnswer.mockImplementation(()=>new Promise(()=>{}));
  const f=fakeQuery([],async o=>{await o.canUseTool!('AskUserQuestion',{questions:[{question:'독자는?',header:'독자',options:[{label:'A',description:'a'},{label:'B',description:'b'}],multiSelect:false}]},{signal:o.abortController!.signal,toolUseID:'ask',requestId:'test'});});
  const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const snapshot=createMockSnapshot('storyboard');snapshot.storyboard=null;
  const pending=collect(a.start({...context,phase:'editorial',baseProjectVersion:snapshot.projectVersion},{snapshot}));await opened.promise;const cleanup=await a.cancel(I.run);expect(cleanup).toMatchObject({runId:I.run,status:'confirmed',reason:'OFFLINE_TEST_NO_CHILDREN'});await pending;expect(f.options.abortController!.signal.aborted).toBe(true);expect(f.close).toHaveBeenCalled();await a.dispose();
 });
 it.each([
  {frame:{type:'assistant',session_id:session,error:'authentication_failed'},code:'LOGIN_REQUIRED'},
  {frame:{type:'assistant',session_id:session,error:'rate_limit'},code:'SUBSCRIPTION_QUOTA'},
  {frame:{type:'assistant',session_id:session,error:'cloud_credential_error'},code:'AUTH_PATH_FORBIDDEN'},
  {frame:{type:'auth_status',session_id:session,isAuthenticating:true,output:[]},code:'AUTH_MODE_UNKNOWN'},
  {frame:{...result(),session_id:undefined},code:'PROVIDER_PROTOCOL_ERROR'}
 ])('공식 오류 enum/갱신/필수 session_id 누락 $code',async({frame,code})=>{
  const f=fakeQuery([init(),frame]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));expect(events.at(-1)).toMatchObject({type:'error',error:{code}});expect(b.publishResult).not.toHaveBeenCalled();
 });
 it('도구 hook은 Bash/교차 원문 거부, 모델 switch도 거부',async()=>{
  const f=fakeQuery([init(),result()]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));
  const hook=f.options.hooks!.PreToolUse![0].hooks[0];
  expect(await hook({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{},tool_use_id:'test',session_id:session,cwd:process.cwd(),transcript_path:'unused'},undefined,{signal:new AbortController().signal})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(f.options.hooks?.PreModelSwitch).toBeDefined();
 });
 it('JSON 출력용 SDK 내부 StructuredOutput은 금지 도구로 오인하지 않는다',async()=>{
  const f=fakeQuery([{...init(),tools:[...init().tools,'StructuredOutput']},result()]),b=bridge();
  const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));
  expect(events.at(-1)?.type).toBe('result');expect(b.publishResult).toHaveBeenCalledOnce();
  expect(f.options.tools).toEqual(['WebSearch','WebFetch']);await a.dispose();
 });
 it('StructuredOutput은 현재 결과 schema를 검증하고 Bash/Write 권한은 열지 않는다',async()=>{
  let valid:unknown,invalid:unknown,bash:unknown,write:unknown;
  const f=fakeQuery([{...init(),tools:[...init().tools,'StructuredOutput']},result()],async o=>{
   const tool={signal:o.abortController!.signal,toolUseID:'output-check',requestId:'test'};
   valid=await o.canUseTool!('StructuredOutput',result().structured_output,tool);
   invalid=await o.canUseTool!('StructuredOutput',{kind:'candidates'},tool);
   bash=await o.canUseTool!('Bash',{command:'not-executed'},tool);
   write=await o.canUseTool!('Write',{file_path:'not-written',content:'test'},tool);
  }),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  expect((await collect(a.start(context,{snapshot:createMockSnapshot('selection')}))).at(-1)?.type).toBe('result');
  expect(valid).toMatchObject({behavior:'allow'});expect(invalid).toMatchObject({behavior:'deny'});
  expect(bash).toMatchObject({behavior:'deny'});expect(write).toMatchObject({behavior:'deny'});
  await a.dispose();
 });
 it('선택한 소식의 새 공식 원문은 기획 단계에서도 읽고 로컬/자격증명 URL은 거절한다',async()=>{
  const snapshot=createMockSnapshot('storyboard');snapshot.storyboard=null;
  const urls=['https://claude.com/resources/articles/claude-security-now-scans-continuously-and-tracks-fixes','https://support.claude.com/en/articles/14661296-use-claude-security','https://127.0.0.1/private','https://localhost/private','https://192.168.0.1/private','file:///C:/private','https://user:placeholder@example.com/private'];
  const decisions:Record<string,unknown>={};
  const f=fakeQuery([{...init(),tools:['WebSearch','WebFetch','AskUserQuestion']},{...result(),structured_output:{kind:'storyboard',storyboard:createMockSnapshot('storyboard').storyboard,sources:snapshot.sources,claims:[]}}],async o=>{
   for(const url of urls)decisions[url]=await o.canUseTool!('WebFetch',{url,prompt:'선택한 사건의 공식 사용 조건 확인'},{signal:o.abortController!.signal,toolUseID:'fetch',requestId:'test'});
  }),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  expect((await collect(a.start({...context,phase:'editorial',baseProjectVersion:snapshot.projectVersion},{snapshot}))).at(-1)?.type).toBe('result');
  for(const url of urls.slice(0,2))expect(decisions[url]).toMatchObject({behavior:'allow'});
  for(const url of urls.slice(2))expect(decisions[url]).toMatchObject({behavior:'deny'});
  const hook=f.options.hooks!.PreToolUse![0].hooks[0];
  expect(await hook({hook_event_name:'PreToolUse',tool_name:'WebFetch',tool_input:{url:urls[0]},tool_use_id:'public',session_id:session,cwd:process.cwd(),transcript_path:'unused'},undefined,{signal:new AbortController().signal})).not.toHaveProperty('hookSpecificOutput.permissionDecision','deny');
  await a.dispose();
 });
 it('detached 도구 결과와 중복 프레임은 완료를 꾸미지 않는다',async()=>{
 const use={type:'assistant',session_id:session,message:{content:[{type:'tool_use',id:'a',name:'WebSearch',input:{}}]}},done={type:'user',session_id:session,message:{content:[{type:'tool_result',tool_use_id:'a',content:'SECRET'}]}};
 const f=fakeQuery([init(),use,use,{...done,tool_use_result:{detachedToolCall:true}},done,done,result()]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));expect(events.filter(e=>e.type==='progress'&&e.activity).map(e=>e.type==='progress'&&e.activity?.status)).toEqual(['started','completed']);await a.dispose();
 });
 it('거절된 tool 이름도 원문 그대로 공개하지 않는다',async()=>{
 const f=fakeQuery([{...init(),tools:['WebSearch','WebFetch','SECRET_TOOL_NAME']}]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));expect(JSON.stringify(events)).not.toContain('SECRET_TOOL_NAME');await a.dispose();
 });
 it('SDK init의 검색 도구 누락은 SEARCH_TOOL_UNAVAILABLE',async()=>{
  const f=fakeQuery([{...init(),tools:[]},result()]),b=bridge(),a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},f.query);
  const events=await collect(a.start(context,{snapshot:createMockSnapshot('selection')}));expect(events.at(-1)).toMatchObject({type:'error',error:{code:'SEARCH_TOOL_UNAVAILABLE'}});expect(b.publishResult).not.toHaveBeenCalled();
 });
});
