import {test,expect,vi} from 'vitest';
import {setup,options} from './도움.js';
import {createWorker} from '../../src/worker/작업자.js';
import {createWorkerHealth,readWorkerState} from '../../src/backend/실행상태.js';
test('이전 기동의 유효한 health lease는 미접수로 대기하고 만료 후 start 루프가 다시 획득한다',async()=>{
 const s=await setup();let now=Date.now();const clock=()=>new Date(now).toISOString();const old=createWorkerHealth(s.dataDir,'previous-startup',clock,200,0);expect(old.update('ready')).toBe(true);
 const o=options(s);o.clock=clock;o.pollMs=5;const claim=vi.spyOn(s.store,'claimJob'),reconcile=vi.spyOn(s.store,'reconcile');const w=createWorker(o);
 try{
  await expect(w.tick()).resolves.toBe(false);expect(claim).not.toHaveBeenCalled();expect(reconcile).not.toHaveBeenCalled();
  await w.start();await new Promise(r=>setTimeout(r,20));expect(claim).not.toHaveBeenCalled();now+=201;
  await vi.waitFor(()=>expect(claim).toHaveBeenCalled(),{timeout:1000,interval:10});expect(readWorkerState(s.dataDir,clock())).toMatchObject({state:'ready',reason:null});expect(o.agy.generate).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.store.close();}
});
test('기동 대기 개선으로 정리 실패의 sticky 소유권 차단을 우회하지 않는다',async()=>{
 const s=await setup();let now=Date.now();const clock=()=>new Date(now).toISOString(),old=createWorkerHealth(s.dataDir,'dirty-owner',clock,100,0);expect(old.update('unavailable','CANCEL_CLEANUP_FAILED')).toBe(true);now+=1000;
 const o=options(s);o.clock=clock;const claim=vi.spyOn(s.store,'claimJob');const w=createWorker(o);try{await expect(w.tick()).resolves.toBe(false);expect(claim).not.toHaveBeenCalled();expect(readWorkerState(s.dataDir,clock()).reason).toBe('CANCEL_CLEANUP_FAILED');}finally{await w.dispose();await s.store.close();}
});
