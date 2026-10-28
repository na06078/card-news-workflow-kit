import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertHealthPath,withWorkerHealthMutex} from './작업자잠금.js';
import type {ExecutionState} from '../shared/포트.js';
import {ExecutionStateSchema} from '../shared/포트.js';
type WorkerState=ExecutionState['worker'];
type HealthUpdate='updated'|'contended'|'waiting'|'lost';
type RecordState=WorkerState&{ownerId:string;token:string;expiresAt:string};
const filename=(dir:string)=>resolve(dir,'작업자상태.json');
function read(dir:string):RecordState|null{try{const path=filename(dir);assertHealthPath(path);const data=JSON.parse(readFileSync(path,'utf8')) as RecordState;ExecutionStateSchema.parse({worker:{state:data.state,reason:data.reason,checkedAt:data.checkedAt},queue:null});if(!data.token||!data.ownerId||!Number.isFinite(Date.parse(data.expiresAt)))throw Error('invalid');return data;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export function readWorkerState(dir:string,now:string):WorkerState{
 try{const data=read(dir);if(!data)return {state:'unknown',reason:null,checkedAt:null};return {state:data.state==='unavailable'||data.expiresAt<=now?'unavailable':data.state,reason:data.state==='unavailable'?data.reason==='CANCEL_CLEANUP_FAILED'?'CANCEL_CLEANUP_FAILED':'WORKER_UNAVAILABLE':data.expiresAt<=now?'WORKER_UNAVAILABLE':null,checkedAt:data.checkedAt};}catch{return {state:'unavailable',reason:'WORKER_UNAVAILABLE',checkedAt:null};}
}
/** OS 회수 SQLite 잠금 안에서 소유권 비교→원자 rename. 늦은 token은 쓰기를 거절합니다. */
export function createWorkerHealth(dir:string,ownerId:string,clock:()=>string,ttlMs=30000,throttleMs=1000){
 const token=randomUUID();let acquired=false,lastAt=0,lastState:WorkerState['state']|null=null,lastReason:string|null=null,sticky=false;
 const updateResult=(state:WorkerState['state'],reason:string|null=null):HealthUpdate=>{
  sticky ||= reason==='CANCEL_CLEANUP_FAILED';if(sticky){state='unavailable';reason='CANCEL_CLEANUP_FAILED';}
  const now=clock(),ms=Date.parse(now);
  // 경합/쓰기 생략도 실제 token·lease·JSON 오류를 숨겨서는 안 됩니다.
  const owned=()=>{const old=read(dir);return old?.token===token&&old.expiresAt>now&&ms<lastAt+ttlMs;};
  if(acquired&&!owned())return 'lost';
  if(acquired&&state===lastState&&reason===lastReason&&ms-lastAt<throttleMs)return 'updated';
  assertHealthPath(dir,true);mkdirSync(dir,{recursive:true});
  const result=withWorkerHealthMutex<HealthUpdate>(dir,()=>{
   const old=read(dir);
   if(acquired&&(old?.token!==token||old.expiresAt<=now||ms>=lastAt+ttlMs))return 'lost';
   if(!acquired&&old&&old.token!==token&&((old.state!=='unavailable'&&old.expiresAt>now)||old.reason==='CANCEL_CLEANUP_FAILED'))return 'waiting';
   const record:RecordState={ownerId,token,state,reason,checkedAt:now,expiresAt:new Date(ms+ttlMs).toISOString()};
   const temp=filename(dir)+'.'+token+'.tmp';assertHealthPath(temp);let created=false;try{writeFileSync(temp,JSON.stringify(record),{flag:'wx'});created=true;renameSync(temp,filename(dir));}finally{if(created)try{unlinkSync(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
   acquired=true;lastAt=ms;lastState=state;lastReason=reason;return 'updated';
  });
  if(result!==false)return result;
  if(acquired&&!owned())return 'lost';
  // 기동 중 경합에서도 손상 JSON/I/O 오류는 호출자에게 전달합니다.
  if(!acquired){read(dir);return 'waiting';}
  return 'contended';
 };
 return {update:(state:WorkerState['state'],reason:string|null=null)=>updateResult(state,reason)==='updated',updateResult};
}
