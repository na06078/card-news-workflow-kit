import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import type {ExecutionState} from '../shared/포트.js';
import {ExecutionStateSchema} from '../shared/포트.js';
type WorkerState=ExecutionState['worker'];
type RecordState=WorkerState&{ownerId:string;token:string;expiresAt:string};
const filename=(dir:string)=>resolve(dir,'작업자상태.json');
function read(dir:string):RecordState|null{try{const path=filename(dir);if(lstatSync(path).isSymbolicLink())throw Error('link');const data=JSON.parse(readFileSync(path,'utf8')) as RecordState;ExecutionStateSchema.parse({worker:{state:data.state,reason:data.reason,checkedAt:data.checkedAt},queue:null});if(!data.token||!data.ownerId||!Number.isFinite(Date.parse(data.expiresAt)))throw Error('invalid');return data;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export function readWorkerState(dir:string,now:string):WorkerState{
 try{const data=read(dir);if(!data)return {state:'unknown',reason:null,checkedAt:null};return {state:data.state==='unavailable'||data.expiresAt<=now?'unavailable':data.state,reason:data.state==='unavailable'?data.reason==='CANCEL_CLEANUP_FAILED'?'CANCEL_CLEANUP_FAILED':'WORKER_UNAVAILABLE':data.expiresAt<=now?'WORKER_UNAVAILABLE':null,checkedAt:data.checkedAt};}catch{return {state:'unavailable',reason:'WORKER_UNAVAILABLE',checkedAt:null};}
}
/** 동기 파일 잠금 안에서 소유권 비교→원자 rename. 늦은 소유자의 token은 쓰기를 거절합니다. */
export function createWorkerHealth(dir:string,ownerId:string,clock:()=>string,ttlMs=30000,throttleMs=1000){
 const token=randomUUID();let acquired=false,lastAt=0,lastState:WorkerState['state']|null=null;
 const update=(state:WorkerState['state'],reason:string|null=null):boolean=>{
  const now=clock(),ms=Date.parse(now);if(acquired&&state===lastState&&ms-lastAt<throttleMs)return true;
  mkdirSync(dir,{recursive:true});const lock=filename(dir)+'.lock';let fd:number;
  try{fd=openSync(lock,'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error;}
  try{
   const old=read(dir);
   if(acquired&&old?.token!==token)return false;
   if(!acquired&&old&&old.token!==token&&((old.state!=='unavailable'&&old.expiresAt>now)||old.reason==='CANCEL_CLEANUP_FAILED'))return false;
   const record:RecordState={ownerId,token,state,reason,checkedAt:now,expiresAt:new Date(ms+ttlMs).toISOString()};
   const temp=filename(dir)+'.'+token+'.tmp';try{writeFileSync(temp,JSON.stringify(record),{flag:'wx'});renameSync(temp,filename(dir));}finally{try{unlinkSync(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
   acquired=true;lastAt=ms;lastState=state;return true;
  }finally{closeSync(fd);unlinkSync(lock);}
 };
 return {update};
}
