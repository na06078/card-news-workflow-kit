import {test,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {setup,options,fixture,confirmed} from './도움.js';
import {createWorker} from '../../src/worker/작업자.js';
import {createWorkerHealth,readWorkerState} from '../../src/backend/실행상태.js';
const root=resolve('실행데이터/리뷰보강/작업자연결');
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
test('실행 중 token 상실은 heartbeat 취소하고 새 소유 기록을 덮어쓰지 않는다',async()=>{
 const s=await setup(root),o=options(s);let cancels=0,after='';
 o.createClaudeAdapter=({bridge,signal})=>({async *start(c){const path=resolve(s.dataDir,'작업자상태.json'),record=JSON.parse(readFileSync(path,'utf8'));record.token=randomUUID();after=JSON.stringify(record);writeFileSync(path,after);await vi.waitFor(()=>expect(signal!.aborted).toBe(true),{interval:5,timeout:1000});yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>{cancels++;return confirmed(id);},dispose:async()=>[]});
 const w=createWorker(o);try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});await expect(w.tick()).rejects.toThrow('WORKER_UNAVAILABLE');expect(cancels).toBe(1);expect((await s.store.getProject(s.pid)).candidates).toEqual([]);expect(readFileSync(resolve(s.dataDir,'작업자상태.json'),'utf8')).toBe(after);expect(await w.tick()).toBe(false);}finally{await w.dispose();await s.store.close();}
});
test('stop과 error 정리 중 mutex 경합도 CANCEL_CLEANUP_FAILED를 영구 보존한다',async()=>{
 const s=await setup(root),o=options(s);let releaseProvider!:()=>void,started=false,unlock=()=>{};const latch=new Promise<void>(r=>{releaseProvider=r;});
 o.createClaudeAdapter=()=>({async *start(){started=true;await latch;},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>{unlock=hold(s.dataDir);setTimeout(unlock,60);throw Error('cleanup failed');}});
 const w=createWorker(o);try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});const task=w.tick(),observed=expect(task).rejects.toMatchObject({code:'CANCEL_CLEANUP_FAILED'});await vi.waitFor(()=>expect(started).toBe(true));const stopped=w.stop();releaseProvider();await observed;await stopped;expect(readWorkerState(s.dataDir,new Date().toISOString()).reason).toBe('CANCEL_CLEANUP_FAILED');expect(createWorkerHealth(s.dataDir,'next',()=>new Date().toISOString()).update('ready')).toBe(false);}finally{unlock();await w.dispose();await s.store.close();}
});
for(const fault of ['token','expiry','JSON','I/O'] as const)test(`소유 mutex 경합 중 ${fault}는 무해한 경합으로 처리하지 않는다`,()=>{
 const dir=resolve(root,randomUUID());mkdirSync(dir,{recursive:true});let now=Date.now();const clock=()=>new Date(now).toISOString(),health=createWorkerHealth(dir,'owner',clock,1000,0),path=resolve(dir,'작업자상태.json');
 expect(health.update('ready')).toBe(true);const release=hold(dir);
 try{if(fault==='token'){const record=JSON.parse(readFileSync(path,'utf8'));record.token=randomUUID();writeFileSync(path,JSON.stringify(record));}else if(fault==='expiry')now+=1001;else if(fault==='JSON')writeFileSync(path,'{bad');else{renameSync(path,path+'.보존');mkdirSync(path);}
  if(fault==='JSON'||fault==='I/O')expect(()=>health.updateResult('busy')).toThrow();else{expect(health.updateResult('busy')).toBe('lost');expect(health.update('ready')).toBe(false);}
 }finally{release();}
});
for(const kind of ['JSON','SQLite','I/O'] as const)test(`start 첫 ${kind} health 오류는 ready 호출자에게 reject하고 작업을 접수하지 않는다`,async()=>{
 const s=await setup(root),o=options(s),claim=vi.spyOn(s.store,'claimJob'),reconcile=vi.spyOn(s.store,'reconcile');
 const path=resolve(s.dataDir,kind==='SQLite'?'작업자상태.잠금.sqlite':'작업자상태.json');
 if(kind==='I/O')mkdirSync(path);else writeFileSync(path,kind==='JSON'?'{broken':'not a sqlite database');
 const w=createWorker(o);try{await expect(w.start()).rejects.toThrow();expect(claim).not.toHaveBeenCalled();expect(reconcile).not.toHaveBeenCalled();expect(o.agy.generate).not.toHaveBeenCalled();}finally{await w.dispose().catch(()=>{});await s.store.close();}
});
// 별도 실제 SQLite connection: 사용자 DB/외부 제공자/브라우저에 접근하지 않습니다.
function hold(dir:string){const db=new Database(resolve(dir,'작업자상태.잠금.sqlite'),{timeout:0});db.exec('BEGIN IMMEDIATE');let open=true;return ()=>{if(open){open=false;db.exec('ROLLBACK');db.close();}};}
for(const phase of ['busy','heartbeat','ready'] as const)test(`${phase} 실제 mutex 경합은 실행 취소나 루프 영구 중단 없이 회복한다`,async()=>{
 const s=await setup(root),o=options(s);let now=Date.now();o.clock=()=>new Date(now).toISOString();o.leaseMs=10000;let unlock=()=>{},timer:ReturnType<typeof setTimeout>|undefined,started=false,cancels=0,observed=false;
 const lock=()=>{now+=1100;unlock=hold(s.dataDir);timer=setTimeout(unlock,80);observed=true;};
 if(phase==='busy'){const claim=s.store.claimJob.bind(s.store);vi.spyOn(s.store,'claimJob').mockImplementation(async input=>{const job=await claim(input);if(job)lock();return job;});}
 o.createClaudeAdapter=({bridge,signal})=>({async *start(c){started=true;if(phase==='heartbeat'){lock();await sleep(45);expect(signal!.aborted).toBe(false);await sleep(70);}yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>{cancels++;return confirmed(id);},dispose:async()=>{if(phase==='ready')lock();return [];}});
 const w=createWorker(o);try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});await expect(w.tick()).resolves.toBe(true);expect(observed).toBe(true);expect(started).toBe(true);expect((await s.store.getProject(s.pid)).lastRun?.status).toBe('succeeded');expect(cancels).toBe(0);expect(await w.tick()).toBe(false);expect(readWorkerState(s.dataDir,o.clock())).toMatchObject({state:'ready',reason:null});const reconcile=vi.spyOn(s.store,'reconcile');await w.start();await vi.waitFor(()=>expect(reconcile.mock.calls.length).toBeGreaterThan(1),{interval:5,timeout:1000});await w.stop();}finally{clearTimeout(timer);unlock();await w.dispose();await s.store.close();}
});
