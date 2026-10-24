import {test,expect,vi} from 'vitest';
const audit=vi.hoisted(()=>({sdkImports:0,queries:0,providerSpawns:0}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>{audit.sdkImports++;return {query:()=>{audit.queries++;throw Error('I2_LIVE_FORBIDDEN');}};});
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:()=>{audit.providerSpawns++;throw Error('I2_PROVIDER_SPAWN_FORBIDDEN');}}));
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {startServer} from '../../src/server-main.js';
import {createProductionWorker} from '../../src/worker-main.js';

test('실제 HTTP/SQLite 진입점은 프로세스 격리 미확인 시 외부 실행 전에 차단한다',async()=>{
 const host=await startServer({dataDir:resolve('실행데이터/I2',randomUUID()),port:0,staticDir:resolve('dist/web')});
 const runtime=createProductionWorker(host.store,host.dataDir);
 try {
  const boot=await fetch(host.url+'/api/bootstrap');expect(boot.status).toBe(200);
  const p=await host.store.createProject({topic:'I2 생산 차단 확인',createRequestId:randomUUID()});expect('data'in p.body).toBe(true);if(!('data'in p.body))throw Error('create');
  const id=p.body.data.projectId;expect((await fetch(host.url+'/api/projects/'+id)).status).toBe(403);expect((await host.store.getProject(id)).activeRun).toBeNull();
  await host.store.mutate('research',{projectId:id},{requestId:randomUUID(),version:1});
  await runtime.worker.tick();const state=await host.store.getProject(id);
  expect(state.lastRun?.error?.code).toBe('PROCESS_SCOPE_UNVERIFIED');expect(state.candidates).toEqual([]);expect(state.dataMode).toBe('real');expect(audit).toEqual({sdkImports:0,queries:0,providerSpawns:0});
  const {writeFile}=await import('node:fs/promises');await writeFile(resolve(host.dataDir,'생산차단감사.json'),JSON.stringify({runtime:host.runtime,audit,run:state.lastRun,gate:'PROCESS_SCOPE_UNVERIFIED; no SDK import/query or provider spawn',syntheticFallback:false},null,2));
 } finally {await runtime.close();await host.close();}
});
