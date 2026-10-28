import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
// 소스의 .js 지정자를 Node 내장 TS 실행에 연결합니다. provider/app은 import하지 않습니다.
registerHooks({resolve(specifier,context,next){
 if(specifier.endsWith('.js')&&context.parentURL?.startsWith('file:')){
  const url=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
  if(existsSync(fileURLToPath(url)))return next(url.href,context);
 }
 return next(specifier,context);
}});
const [mode,dir]=process.argv.slice(2);
if(mode==='hold'){
 const db=new Database(resolve(dir,'작업자상태.잠금.sqlite'),{timeout:0});db.exec('BEGIN IMMEDIATE');
 process.send({kind:'held',pid:process.pid,parentPid:process.ppid});
 // 부모가 소유한 이 ChildProcess에만 kill을 요청합니다. 종료 전 rollback/close 하지 않습니다.
 setInterval(()=>{},1000);
}else if(mode==='claim'){
 const {createWorkerHealth}=await import('../../../src/backend/실행상태.ts');
 const value=createWorkerHealth(dir,'independent-child',()=> '2026-10-27T00:00:00.000Z').update('ready');
 process.send({kind:'claim',pid:process.pid,parentPid:process.ppid,value},()=>process.exit(0));
}else throw Error('UNKNOWN_TEST_MODE');
