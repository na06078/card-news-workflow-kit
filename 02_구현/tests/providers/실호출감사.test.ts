import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {ProviderBridge,EngineContext} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
const counters=vi.hoisted(()=>({sdkImports:0,queries:0,spawns:0}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>{counters.sdkImports++;return {query:()=>{counters.queries++;throw new Error('LIVE_QUERY_FORBIDDEN');}};});
vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),spawn:()=>{counters.spawns++;throw new Error('LIVE_SPAWN_FORBIDDEN');}}));
import {createClaudeAdapter,createOfflineClaudeAdapter} from '../../src/providers/클로드.js';
import {createAgyAdapter} from '../../src/providers/agy.js';
const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'research',baseProjectVersion:1};
describe('OFFLINE no-live-calls 감사 — SDK import/child 실행 금지 스파이',()=>{
 it('production factory/start에 임의 승인 객체를 넣어도 SDK import/query/spawn0',async()=>{
  const bridge={publishError:vi.fn(async(_c,e)=>({type:'error',error:e,seq:1,projectId:I.project,runId:I.run,attempt:1,at:'2026-10-23T00:00:00Z'}))} as unknown as ProviderBridge;
  const livePermission={inference:true,search:true,image:true,approvalReference:'OFFLINE forged approval'} as const;
  const claude=createClaudeAdapter({bridge,livePermission,usageCreditsDisabled:{confirmedAt:'2026-10-23T00:00:00Z',reference:'OFFLINE fake-not-evidence'}});
  const events=[];for await(const event of claude.start(context,{snapshot:createMockSnapshot()}))events.push(event);
  expect(events).toHaveLength(1);expect(events[0]).toMatchObject({type:'error',error:{code:'AUTH_PATH_FORBIDDEN'}});await claude.dispose();
  const agy=createAgyAdapter({executablePath:'C:/fake/agy.exe',livePermission});await expect(agy.generate({} as never,new AbortController().signal)).rejects.toMatchObject({code:'ASSET_INVALID'});await agy.dispose();
  expect(counters).toEqual({sdkImports:0,queries:0,spawns:0});
 });
 it('기본/실호출 script는 offline wrapper 또는 fail-closed 차단이며 실검증 제외',async()=>{
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  expect(pkg.scripts['test:providers:offline']).toBe('node scripts/오프라인검증.mjs providers');
  for(const key of ['test:live:subscription','test:live:agy'])expect(pkg.scripts[key]).toMatch(/^node scripts\/실호출차단\.mjs /);
  const offline=await readFile('scripts/오프라인검증.mjs','utf8');expect(offline).toContain("CARDNEWS_LIVE_CALLS = 'forbidden'");expect(offline).toContain("!p.includes('실검증')");
  const live=await readFile('scripts/실호출차단.mjs','utf8');expect(live).toContain('LIVE_CALLS_FORBIDDEN');expect(live).toContain('process.exit(2)');
 });
 it('offline fake에 전달된 SDK spawn hook도 실제 자식 실행 불가',async()=>{
  const bridge={publishError:vi.fn(async(_c,e)=>({type:'error',error:e,seq:1,projectId:I.project,runId:I.run,attempt:1,at:'2026-10-23T00:00:00Z'}))} as unknown as ProviderBridge;
  const before=counters.spawns;
  const adapter=createOfflineClaudeAdapter({bridge,livePermission:{inference:false,search:false,image:false}},params=>{
   expect(()=>params.options!.spawnClaudeCodeProcess!({command:'NEVER_EXECUTE_TEST_ONLY',args:[],env:{},signal:new AbortController().signal})).toThrow();
   return Object.assign((async function*(){})(),{close(){}});
  });
  for await(const _ of adapter.start(context,{snapshot:createMockSnapshot()})){}
  expect(counters.spawns).toBe(before);await adapter.dispose();
 });
});
