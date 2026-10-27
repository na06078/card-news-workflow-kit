import type {ChildProcess} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,resolve} from 'node:path';
import type {CleanupReport,ChildCleanupEvidence} from '../shared/포트.js';
import {captureDescendantCheck} from './프로세스격리.js';
const exec=promisify(execFile);
export const report=(runId:string|null,status:CleanupReport['status'],reason:string|null=null,children:ChildCleanupEvidence[]=[]):CleanupReport=>({runId,status,verifiedAt:new Date().toISOString(),reason,children});
export async function bounded<T>(promise:Promise<T>,ms=10000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('CLEANUP_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}
}
/** 값/명령행/env 수집 없음. 소유 ChildProcess의 PID만 읽는 OS 신원 probe. */
async function identity(pid:number):Promise<{pid:number;parentPid:number;executablePath:string;createdAt:string}|null>{
 if(process.platform!=='win32'||!Number.isSafeInteger(pid)||pid<=0)return null;
 const script=`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){[pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;executablePath=$p.ExecutablePath;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:5000,windowsHide:true});
 return stdout.trim()?JSON.parse(stdout):null;
}
/** held ChildProcess만 signal. 후손의 연속 생명주기 추적 미지원이면 정직하게 unknown. */
type ProcessIdentity={pid:number;parentPid:number;executablePath:string;createdAt:string};
export function trackOwnedChild(child:ChildProcess,testOptions?:{probe:(pid:number)=>Promise<ProcessIdentity|null>;graceMs?:number}){
 if(testOptions&&process.env.CARDNEWS_LIVE_CALLS!=='forbidden')throw Error('OFFLINE_TEST_ONLY');
 const probe=testOptions?.probe??identity;
 const descendants=testOptions?async()=>null:captureDescendantCheck();
 let exited=false;const closed=new Promise<void>(resolve=>{child.once('close',()=>{exited=true;resolve();});});
 const observed=child.pid?probe(child.pid).catch(()=>null):Promise.resolve(null);
 let result:Promise<ChildCleanupEvidence>|undefined;
 return {async cleanup():Promise<ChildCleanupEvidence>{return result??=(async()=>{
  const original=await observed;
  const executableMatches=original?.executablePath&&isAbsolute(child.spawnfile)?resolve(original.executablePath).toLowerCase()===resolve(child.spawnfile).toLowerCase():false;
  let identityVerified:boolean|null=original?original.pid===child.pid&&original.parentPid===process.pid&&!!original.createdAt&&executableMatches:null;
  let exitConfirmed=exited;
  if(!exited&&identityVerified){
   const current=await probe(child.pid!).catch(()=>null);
   // CIM 재조회보다 자연 종료가 빠르면 held ChildProcess의 close가 이미 종료를 증명합니다.
   // 최초 확인한 신원을 보존하되, 살아 있는 PID는 여전히 재검증 없이 신호를 보내지 않습니다.
   if(exited)exitConfirmed=true;
   else{
    identityVerified=current?current.pid===original!.pid&&current.parentPid===original!.parentPid&&current.createdAt===original!.createdAt&&resolve(current.executablePath).toLowerCase()===resolve(original!.executablePath).toLowerCase():null;
    if(identityVerified&&!exited){try{child.kill('SIGTERM');await bounded(closed,testOptions?.graceMs??10000);exitConfirmed=true;}catch{exitConfirmed=exited;}}
    else exitConfirmed=exited;
   }
  }
  const descendantsConfirmed=identityVerified&&exitConfirmed?await descendants():null;
  return {pid:child.pid??null,parentPid:original?.parentPid??null,executablePath:original?.executablePath??null,createdAt:original?.createdAt??null,identityVerified,exitConfirmed,descendantsConfirmed,evidence:testOptions?'test_double':original?'actual_os':'unverified'};
 })();}};
}
export function childrenReport(runId:string,children:ChildCleanupEvidence[],failure=false):CleanupReport{
 if(failure||children.some(c=>c.identityVerified===true&&c.exitConfirmed===false))return report(runId,'failed','CLEANUP_FAILED',children);
 const confirmed=children.every(c=>c.identityVerified===true&&c.exitConfirmed===true&&c.descendantsConfirmed===true);
 return report(runId,confirmed?'confirmed':'unknown',confirmed?null:'DESCENDANT_LIFECYCLE_UNVERIFIED',children);
}
