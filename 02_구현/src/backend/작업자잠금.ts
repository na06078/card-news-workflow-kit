import Database from 'better-sqlite3';
import {lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
/** health 경로의 기존 구성요소는 symlink/junction 없이 실제 디렉터리/일반 파일이어야 합니다. */
export function assertHealthPath(path:string,directory=false):void{
 const target=resolve(path),parent=dirname(target);
 if(parent!==target)assertHealthPath(parent,true);
 try{const stat=lstatSync(target);if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile()))throw Error('UNSAFE_WORKER_HEALTH_PATH');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
/** 별도 DB의 쓰기 예약만 사용합니다. 파일 삭제/시간/PID 추정 없이 OS가 잠금을 회수합니다. */
export function withWorkerHealthMutex<T>(dir:string,update:()=>T):T|false{
 const path=resolve(dir,'작업자상태.잠금.sqlite');
 for(const suffix of ['', '-journal','-wal','-shm'])assertHealthPath(path+suffix);
 const db=new Database(path,{timeout:0});
 try{
  try{db.exec('BEGIN IMMEDIATE');}
  catch(error){if((error as {code?:string}).code==='SQLITE_BUSY')return false;throw error;}
  try{return update();}finally{db.exec('ROLLBACK');}
 }finally{db.close();}
}
