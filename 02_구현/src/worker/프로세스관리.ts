import type {CleanupReport} from '../shared/포트.js';
export async function bounded<T>(promise:Promise<T>,graceMs=10000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject({code:'WORKER_BOUNDARY_UNSETTLED'}),graceMs);})]);}finally{clearTimeout(timer);}}
/** 취소 시에도 반환/정리 경계를 기다림. grace 초과는 명시 불명, 성공으로 바꾸지 않습니다. */
export async function waitForSettlement<T>(promise:Promise<T>,signal:AbortSignal,graceMs=10000):Promise<T>{
 let onAbort:()=>void=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{onAbort=()=>{timer=setTimeout(()=>reject({code:'WORKER_BOUNDARY_UNSETTLED'}),graceMs);};signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});
 try{return await Promise.race([promise,timeout]);}finally{signal.removeEventListener('abort',onAbort);clearTimeout(timer);}
}
export function cleanupAccepted(report:CleanupReport,runId:string):boolean{
 return report.runId===runId&&['confirmed','not_started'].includes(report.status)&&report.children.every(c=>c.identityVerified===true&&c.exitConfirmed===true&&c.descendantsConfirmed===true);
}
