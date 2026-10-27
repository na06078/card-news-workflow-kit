import {test,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createNativeConnectionRunner} from '../../src/backend/연결네이티브.js';
const usage=JSON.stringify({command:{name:'usage',data:{groups:[{buckets:[]}]}}});
function fixture(action:'login'|'check'|'logout'='check',timeout=4000){
 const children:ChildProcessWithoutNullStreams[]=[];
 const spawn=vi.fn(()=>{const c=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(function(){c.emit('close',null);return true;})}) as unknown as ChildProcessWithoutNullStreams;children.push(c);return c;});
 let observation:{accountId:string|null;ready:boolean;timestamp:number}|null={accountId:'current@example.test',ready:true,timestamp:Date.now()};
 const h={env:{},read:vi.fn(async()=>observation),logout:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const events:unknown[]=[];
 const t=createNativeConnectionRunner({appRoot:'C:/fixture',cwd:'C:/fixture',spawnProcess:spawn,openAccountConsole:async()=>h,commandTimeoutMs:timeout}).start('agy',action,e=>events.push(e),{expectedAccountId:'current@example.test'});
 return {t,h,spawn,events,set(value:typeof observation){observation=value;},close(i:number,text=usage){children[i]!.stdout.emit('data',text);children[i]!.emit('close',0);},async flush(){for(let i=0;i<20;i++)await Promise.resolve();}};
}
test.each([false,true])('조회 뒤 계정 변경(ready=%s)은 ACCOUNT_MISMATCH',async ready=>{
 const f=fixture();f.close(0,'1.4.7');await f.flush();f.set({accountId:'other@example.test',ready,timestamp:Date.now()});f.close(1);
 expect((await f.t.done).errorCode).toBe('ACCOUNT_MISMATCH');expect(f.h.close).toHaveBeenCalledOnce();
});
test('준비 전 폴링은 유한 간격이고 confirm은 인증을 우회하지 않는다',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();f.set(null);f.close(0,'1.4.7');await f.flush();
  await vi.advanceTimersByTimeAsync(499);expect(f.h.read).toHaveBeenCalledTimes(1);expect(f.spawn).toHaveBeenCalledTimes(1);
  f.t.confirm!();await f.flush();expect(f.spawn).toHaveBeenCalledTimes(1);
  f.set({accountId:'current@example.test',ready:true,timestamp:Date.now()});await vi.advanceTimersByTimeAsync(500);
  expect(f.spawn).toHaveBeenCalledTimes(2);f.close(1);expect((await f.t.done).connected).toBe(true);
 }finally{vi.useRealTimers();}
});
test('busy 대기 취소는 조회를 반복하지 않고 소유 창만 정리한다',async()=>{
 const f=fixture();f.close(0,'1.4.7');await f.flush();f.set({accountId:'current@example.test',ready:false,timestamp:Date.now()});f.close(1);await f.flush();
 f.t.cancel();expect((await f.t.done).errorCode).toBe('CANCELED');expect(f.spawn).toHaveBeenCalledTimes(2);expect(f.h.close).toHaveBeenCalledOnce();
});
test('done은 소유 창 close 완료를 기다리고 정리 거절은 엄격한 오류다',async()=>{
 const f=fixture();let finish!:()=>void;f.h.close.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 let completed=false;void f.t.done.then(()=>{completed=true;});f.close(0,'1.4.7');await f.flush();f.close(1);await f.flush();
 expect(completed).toBe(false);finish();expect((await f.t.done).connected).toBe(true);
 const failed=fixture();failed.h.close.mockRejectedValue(Error('fixture'));failed.close(0,'1.4.7');await failed.flush();failed.close(1);
 expect((await failed.t.done).errorCode).toBe('NATIVE_CLEANUP_UNCONFIRMED');
});
test('logout은 autoConfirm false이며 명시 확인 없이는 조회나 logout을 실행하지 않는다',async()=>{
 const f=fixture('logout');f.close(0,'1.4.7');await f.flush();
 expect(f.events).toContainEqual({externalConsole:true,autoConfirm:false});expect(f.h.read).not.toHaveBeenCalled();expect(f.spawn).toHaveBeenCalledTimes(1);
 f.t.cancel();expect((await f.t.done).errorCode).toBe('CANCELED');expect(f.h.logout).not.toHaveBeenCalled();
});
test('대기 후 시작한 인증 조회도 같은 전체 deadline을 넘길 수 없다',async()=>{
 vi.useFakeTimers();try{
  const f=fixture('check',1000);f.set(null);f.close(0,'1.4.7');await f.flush();
  await vi.advanceTimersByTimeAsync(500);f.set({accountId:'current@example.test',ready:true,timestamp:Date.now()});
  f.t.confirm!();await f.flush();expect(f.spawn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(501);await f.flush();expect(f.h.close).toHaveBeenCalledOnce();
  expect((await f.t.done).errorCode).toBe('NATIVE_TIMEOUT');
 }finally{vi.useRealTimers();}
});
test('인증 조회 중 busy로 바뀌면 닫지 않고 새 ready 뒤 다시 인증한다',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();f.close(0,'1.4.7');await f.flush();expect(f.spawn).toHaveBeenCalledTimes(2);
  f.set({accountId:'current@example.test',ready:false,timestamp:Date.now()});f.close(1);await f.flush();
  expect(f.h.close).not.toHaveBeenCalled();expect(f.spawn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(500);expect(f.h.close).not.toHaveBeenCalled();
  f.set({accountId:'current@example.test',ready:true,timestamp:Date.now()});await vi.advanceTimersByTimeAsync(500);
  expect(f.spawn).toHaveBeenCalledTimes(3);f.close(2);expect((await f.t.done).connected).toBe(true);
 }finally{vi.useRealTimers();}
});
