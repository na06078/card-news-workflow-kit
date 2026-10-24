import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {fork} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const observed=vi.hoisted(()=>({starts:0}));
// 실패 경로도 정리 결과를 조회하므로, 실프로세스가 없는 시험 대역은 그 사실을 반환합니다.
vi.mock('../../src/providers/클로드.js',()=>({createClaudeAdapter:(o:any)=>({async *start(c:any){observed.starts++;yield await o.bridge.publishError(c,{code:'AUTH_MODE_UNKNOWN',message:'OFFLINE provider boundary spy; no SDK',retryable:true,nextActions:['retry'],projectId:c.projectId,runId:c.runId,currentVersion:null,details:{}});},async dispose(){return [];},async cancel(runId:string){return {runId,status:'not_started',verifiedAt:new Date().toISOString(),reason:'OFFLINE_TEST_NO_CHILD',children:[]};},async answer(){},async status(){}})}));
import {createStore} from '../../src/backend/저장소.js';
import {createProductionWorker} from '../../src/worker-main.js';
const make=async()=>{await mkdir('실행데이터/연결준비/통합',{recursive:true});const dir=await mkdtemp(resolve('실행데이터/연결준비/통합/boot-'));return {dir,store:await createStore({dataDir:dir,dbPath:resolve(dir,'카드뉴스.sqlite'),dataMode:'real'})};};
async function enqueue(store:Awaited<ReturnType<typeof createStore>>){const p=await store.createProject({topic:'OFFLINE 시작 경계 확인',createRequestId:randomUUID(),period:7});if(!('data'in p.body))throw Error('CREATE_FAILED');const projectId=p.body.data.projectId;const r=await store.mutate('research',{projectId},{requestId:randomUUID(),version:1});if(!('data'in r.body)||!r.body.data.runId)throw Error('ENQUEUE_FAILED');return {projectId,runId:r.body.data.runId};}
it('기동 전 queued는 외부0·not_started 실패 원장; 명시 retry로 새 run만 호출',async()=>{
 observed.starts=0;const {dir,store}=await make();const old=await enqueue(store);await new Promise(r=>setTimeout(r,15));const runtime=createProductionWorker(store,dir);
 try{expect(observed.starts).toBe(0);await runtime.worker.tick();expect(observed.starts).toBe(0);const oldRun=await store.getRun(old.runId);expect(oldRun).toMatchObject({status:'failed',externalOutcome:'not_started',retryAllowed:true,error:{code:'AUTH_MODE_UNKNOWN',details:{reason:'FRESH_USER_ACTION_REQUIRED'}}});
 const p=await store.getProject(old.projectId);const retry=await store.mutate('retry',{projectId:old.projectId,runId:old.runId},{requestId:randomUUID(),version:p.projectVersion});expect(retry.status).toBe(202);await runtime.worker.tick();expect(observed.starts).toBe(1);
 }finally{await runtime.close();await store.close();}
});
it('기동/import/factory/start는 provider0; 시작 이후 새 연구 요청만 외부 경계로 전달',async()=>{
 observed.starts=0;const {dir,store}=await make();const runtime=createProductionWorker(store,dir);
 try{await runtime.worker.start();await new Promise(r=>setTimeout(r,30));expect(observed.starts).toBe(0);await runtime.worker.stop();const fresh=await enqueue(store);await runtime.worker.start();await vi.waitFor(()=>expect(observed.starts).toBe(1));
 // 호출 진입과 실패 원장 저장은 다른 시점입니다. 저장 전에 stop으로 실행을 중단하지 않습니다.
 await vi.waitFor(async()=>expect((await store.getRun(fresh.runId)).status).toBe('failed'),{timeout:3000});
 await runtime.worker.stop();expect((await store.getRun(fresh.runId)).status).toBe('failed');}finally{await runtime.close();await store.close();}
});
it('컴파일된 실제 worker/Windows Job 기동: 기존 queued를 실호출 없이 정리하고 IPC 종료',async()=>{
 const {dir,store}=await make();const old=await enqueue(store);
 const child=fork(resolve('dist/server/worker-main.js'),[`--data-dir=${dir}`],{execPath:process.execPath,env:{...process.env,TEMP:dir,TMP:dir,TMPDIR:dir},stdio:['ignore','pipe','pipe','ipc']});
 let log='';child.stdout!.on('data',d=>{log+=String(d);});child.stderr!.on('data',d=>{log+=String(d);});const exit=new Promise<number|null>(r=>child.once('exit',r));
 try{
  const ready=await new Promise<any>((r,j)=>{const timer=setTimeout(()=>j(Error('WORKER_READY_TIMEOUT')),15000);child.once('error',j);child.once('message',m=>{clearTimeout(timer);r(m);});});
  expect(ready.gate).toContain('FRESH_USER_ACTION_ONLY');
  await vi.waitFor(async()=>expect(await store.getRun(old.runId)).toMatchObject({status:'failed',externalOutcome:'not_started',error:{details:{reason:'FRESH_USER_ACTION_REQUIRED'}}}));
 }finally{if(child.connected)child.send({type:'shutdown'});const code=await exit;await writeFile(resolve(dir,'native-worker.log'),log);await store.close();expect(code,log).toBe(0);}
},25000);
