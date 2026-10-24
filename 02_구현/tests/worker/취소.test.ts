import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,confirmed,fixture} from './도움.js';
for(const status of ['confirmed','failed','unknown'] as const)test(`실행 중 취소는 ${status} 보고를 해석하고 late result를 채택하지 않는다`,async()=>{
 const s=await setup(),o=options(s);let release!:()=>void;const latch=new Promise<void>(r=>{release=r;});let started=false,cancelCount=0;
 o.createClaudeAdapter=({bridge})=>({async *start(c){started=true;await latch;yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>{cancelCount++;release();return {...confirmed(id),status};},dispose:async()=>[]});
 const w=createWorker(o);
 try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});const task=w.tick();await vi.waitFor(()=>expect(started).toBe(true));const run=(await s.store.getProject(s.pid)).activeRun!;await s.store.mutate('cancel',{projectId:s.pid,runId:run.runId},{requestId:randomUUID()});
 await vi.waitFor(()=>expect(cancelCount).toBe(1),{timeout:1500});await task;const p=await s.store.getProject(s.pid);expect(p.candidates).toEqual([]);expect(p.lastRun?.status).toBe(status==='confirmed'?'canceled':'cancel_requested');if(status!=='confirmed')expect(p.lastRun?.error?.code).toBe('CANCEL_CLEANUP_FAILED');
 }finally{release();await w.dispose();await s.store.close();}
});
test('queued 취소는 공급자 생성 없이 정리 완료하고 두 번 dispose해도 Store/공유 agy를 닫지 않는다',async()=>{
 const s=await setup(),o=options(s),factory=vi.fn(o.createClaudeAdapter);o.createClaudeAdapter=factory;o.agy.dispose=vi.fn(async()=>[]);const w=createWorker(o);
 try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});const r=(await s.store.getProject(s.pid)).activeRun!;await s.store.mutate('cancel',{projectId:s.pid,runId:r.runId},{requestId:randomUUID()});await w.tick();expect((await s.store.getRun(r.runId)).status).toBe('canceled');expect(factory).not.toHaveBeenCalled();await w.dispose();await w.dispose();expect(o.agy.dispose).not.toHaveBeenCalled();expect((await s.store.getProject(s.pid)).status).toBe('canceled');}finally{await w.dispose();await s.store.close();}
});
