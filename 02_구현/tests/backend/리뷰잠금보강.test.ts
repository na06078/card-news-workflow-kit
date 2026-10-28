import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,readdirSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createWorkerHealth,readWorkerState} from '../../src/backend/실행상태.js';
const root=resolve('실행데이터/리뷰보강/잠금');
function isolated(){const dir=resolve(root,randomUUID());mkdirSync(dir,{recursive:true});return dir;}
test('빈 legacy sentinel은 새 health 갱신을 막지 않고 원형 보존한다',()=>{
 const dir=isolated(),legacy=resolve(dir,'작업자상태.json.lock');writeFileSync(legacy,'');
 expect(createWorkerHealth(dir,'fresh',()=> '2026-10-27T00:00:00.000Z').update('ready')).toBe(true);
 expect(readWorkerState(dir,'2026-10-27T00:00:00.000Z').state).toBe('ready');
 expect(readFileSync(legacy,'utf8')).toBe('');
});
function child(mode:string,dir:string){
 const processChild=spawn(process.execPath,[resolve('tests/backend/fixtures/잠금자식.mjs'),mode,dir],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CARDNEWS_LIVE_CALLS:'forbidden'}});
 let stderr='';processChild.stderr!.on('data',chunk=>{stderr+=chunk;});
 const exit=once(processChild,'exit');
 const message=new Promise<any>((ok,fail)=>{
  const timer=setTimeout(()=>fail(Error('CHILD_TIMEOUT '+stderr)),8000);
  processChild.once('message',value=>{clearTimeout(timer);ok(value);});
  processChild.once('exit',code=>{clearTimeout(timer);fail(Error('CHILD_EXIT '+code+' '+stderr));});
  processChild.once('error',fail);
 });
 return {processChild,exit,message};
}
async function stopOwned(child:ChildProcess,exit:Promise<any>){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;}
test('별도 실제 프로세스 경합은 false이고 소유 자식 비정상 종료 후 OS가 잠금을 푼다',async()=>{
 const dir=isolated(),holder=child('hold',dir);let claimant:ReturnType<typeof child>|undefined;
 try{
  const held=await holder.message;expect(held).toMatchObject({kind:'held',pid:holder.processChild.pid,parentPid:process.pid});
  claimant=child('claim',dir);const blocked=await claimant.message;await claimant.exit;
  expect(blocked.value).toBe(false);expect(readWorkerState(dir,'2026-10-27T00:00:00.000Z').state).toBe('unknown');
  await stopOwned(holder.processChild,holder.exit);
  const released=child('claim',dir);let outcome;
  try{outcome=await released.message;await released.exit;expect(outcome.value).toBe(true);}finally{await stopOwned(released.processChild,released.exit);}
  writeFileSync(resolve(dir,'프로세스증거.json'),JSON.stringify({held,blocked,exit:await holder.exit,released:outcome},null,2));
 }finally{await stopOwned(holder.processChild,holder.exit);if(claimant)await stopOwned(claimant.processChild,claimant.exit);}
},15000);
test('만료 lease 인수·늦은 token 거절·throttle·unavailable·영구 정리 실패 차단을 유지한다',()=>{
 const dir=isolated();let now=Date.parse('2026-10-27T00:00:00.000Z');const clock=()=>new Date(now).toISOString();
 const old=createWorkerHealth(dir,'old',clock,2000,100),next=createWorkerHealth(dir,'next',clock,2000,100);
 expect(old.update('ready')).toBe(true);const first=readFileSync(resolve(dir,'작업자상태.json'),'utf8');now+=10;
 expect(old.update('ready')).toBe(true);expect(readFileSync(resolve(dir,'작업자상태.json'),'utf8')).toBe(first);
 expect(next.update('busy')).toBe(false);now+=2000;expect(readWorkerState(dir,clock()).state).toBe('unavailable');
 expect(next.update('busy')).toBe(true);const taken=readFileSync(resolve(dir,'작업자상태.json'),'utf8');
 expect(old.update('unavailable','WORKER_UNAVAILABLE')).toBe(false);expect(readFileSync(resolve(dir,'작업자상태.json'),'utf8')).toBe(taken);
 expect(next.update('unavailable','WORKER_UNAVAILABLE')).toBe(true);
 const final=createWorkerHealth(dir,'final',clock);expect(final.update('ready')).toBe(true);
 expect(final.update('unavailable','CANCEL_CLEANUP_FAILED')).toBe(true);now+=60000;
 expect(createWorkerHealth(dir,'denied',clock).update('ready')).toBe(false);expect(readWorkerState(dir,clock()).reason).toBe('CANCEL_CLEANUP_FAILED');
});
test('health 디렉터리 junction과 비일반 JSON/SQLite/sidecar 경로를 거절한다',()=>{
 const outside=isolated(),base=isolated(),link=resolve(base,'junction');symlinkSync(outside,link,'junction');
 expect(()=>createWorkerHealth(link,'test',()=>new Date().toISOString()).update('ready')).toThrow('UNSAFE_WORKER_HEALTH_PATH');
 expect(readdirSync(outside)).toEqual([]);
 for(const name of ['작업자상태.json','작업자상태.잠금.sqlite','작업자상태.잠금.sqlite-journal','작업자상태.잠금.sqlite-wal','작업자상태.잠금.sqlite-shm']){
  const dir=isolated();mkdirSync(resolve(dir,name));
  expect(()=>createWorkerHealth(dir,'test',()=>new Date().toISOString()).update('ready')).toThrow('UNSAFE_WORKER_HEALTH_PATH');
 }
});
test('고아 tmp는 열거/삭제하지 않고 자기 tmp만 정리하며 성공/실패 후 DB 핸들을 닫는다',()=>{
 const dir=isolated(),orphan=resolve(dir,'작업자상태.json.orphan.tmp');writeFileSync(orphan,'보존');
 const health=createWorkerHealth(dir,'test',()=>new Date().toISOString(),30000,0);
 for(let i=0;i<5;i++)expect(health.update('ready')).toBe(true);
 expect(readdirSync(dir).filter(name=>name.endsWith('.tmp'))).toEqual(['작업자상태.json.orphan.tmp']);
 expect(readFileSync(orphan,'utf8')).toBe('보존');
 const db=resolve(dir,'작업자상태.잠금.sqlite'),moved=db+'.검사';renameSync(db,moved);renameSync(moved,db);
 writeFileSync(resolve(dir,'작업자상태.json'),'{invalid');
 expect(()=>health.update('busy')).toThrow();renameSync(db,moved);renameSync(moved,db);
 expect(readWorkerState(dir,new Date().toISOString())).toMatchObject({state:'unavailable',reason:'WORKER_UNAVAILABLE'});
});
