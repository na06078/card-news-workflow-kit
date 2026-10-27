import {execFile} from 'node:child_process';
import {mkdir,writeFile,readFile,rm,lstat,mkdtemp,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {childEnvironment} from '../providers/자식환경.js';
import type {AccountConsole,AccountConsoleOptions,AccountObservation} from './연결네이티브.js';
export interface OwnedConsoleTarget {pid:number;executable:string;createdAt:string}
export type ConsoleControl=(action:'launch'|'inspect'|'logout'|'stop',target:OwnedConsoleTarget|undefined,env:Record<string,string>,cwd:string,executable:string)=>Promise<unknown>;
const validEmail=(v:unknown):v is string=>typeof v==='string'&&/^[^\s@\x00-\x1f\x7f]{1,128}@[^\s@\x00-\x1f\x7f]{1,190}\.[^\s@\x00-\x1f\x7f]{1,63}$/.test(v);
const activeProfiles=new Set<string>();
function statusLineCommand(args:string[]):string {
 if(args.some(value=>/[\x00-\x1f]/.test(value)))throw Error('NATIVE_PATH_UNSUPPORTED');
 const invocation=args.map(value=>"'"+value.replaceAll("'","''")+"'").join(' ');
 // agy's CMD argv layer escapes embedded quotes. Keep its command ASCII-only;
 // PowerShell decodes the exact paths and forwards statusLine JSON as UTF-8.
 const script="$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';"+
  "$OutputEncoding=[System.Text.UTF8Encoding]::new($false);"+
  "[Console]::InputEncoding=$OutputEncoding;[Console]::OutputEncoding=$OutputEncoding;"+
  "$payload=[Console]::In.ReadToEnd();$payload | & "+invocation+";exit $LASTEXITCODE";
 const command='powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');
 if(command.length>7900)throw Error('NATIVE_PATH_UNSUPPORTED');
 return command;
}
/** Global credentials/config are untouched; only this app's own preferences persist. */
export async function openNativeAccountConsole(options:AccountConsoleOptions&{control?:ConsoleControl}):Promise<AccountConsole>{
 const control:ConsoleControl=options.control??((action,target,env,cwd,executable)=>new Promise((ok,fail)=>{
  if(process.env.CARDNEWS_LIVE_CALLS==='forbidden'){fail(Error('LIVE_CALLS_FORBIDDEN'));return;}
  const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve(options.appRoot,'scripts/계정콘솔제어.ps1'),'-Action',action,'-Executable',executable,'-WorkDirectory',cwd];
  if(target)args.push('-OwnedPid',String(target.pid),'-CreatedAt',target.createdAt);
  execFile('powershell.exe',args,{env,cwd,windowsHide:true,timeout:15000,maxBuffer:32768},(error,stdout)=>{if(error){fail(Error('NATIVE_CONSOLE_CONTROL_FAILED'));return;}try{ok(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{fail(Error('NATIVE_CONSOLE_RESPONSE_INVALID'));}});
 }));
 const base=resolve(options.cwd,'계정연결');await mkdir(base,{recursive:true});
 const home=join(base,'agy프로필');
 if(activeProfiles.has(home))throw Error('NATIVE_PROFILE_BUSY');
 activeProfiles.add(home);
 const operationId=randomUUID(),launchedAt=Date.now();let directory='';
 const env={...childEnvironment(),HOME:home,USERPROFILE:home,CARDNEWS_ACCOUNT_OPERATION:operationId};
 // Preserve user-completed onboarding/trust; isolate each observation and producer.
 let target:OwnedConsoleTarget|undefined,closed=false,logoutSent=false;
 let liveGrant:AccountObservation|null=null;
 try{
  await mkdir(join(home,'.gemini/antigravity-cli'),{recursive:true});
  directory=await mkdtemp(join(home,'관측-'));
  await writeFile(join(directory,'작업표식.json'),JSON.stringify({operationId,expiresAt:launchedAt+240000}),{mode:0o600,flag:'wx'});
  const command=statusLineCommand([process.execPath,resolve(options.appRoot,'scripts/계정상태수집.cjs'),join(directory,'현재계정.json'),operationId]);
  const settingsFile=join(home,'.gemini/antigravity-cli/settings.json');
  let settings:Record<string,unknown>={};
  try{
   const previous:unknown=JSON.parse(await readFile(settingsFile,'utf8'));
   if(!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('NATIVE_SETTINGS_INVALID');
   settings=previous as Record<string,unknown>;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await writeFile(settingsFile,JSON.stringify({...settings,statusLine:{type:'command',command,enabled:true,stack_with_default:true}}),{mode:0o600});
  const result=await control('launch',undefined,env,options.cwd,options.executable) as OwnedConsoleTarget;
  if(!Number.isSafeInteger(result.pid)||result.pid<=0||resolve(result.executable).toLowerCase()!==resolve(options.executable).toLowerCase()||!/^\d{16,20}$/.test(result.createdAt))throw Error('NATIVE_CONSOLE_IDENTITY_INVALID');
  target=result;
 }catch(error){if(directory)await rm(directory,{recursive:true,force:true});activeProfiles.delete(home);throw error;}
 async function read():Promise<AccountObservation|null>{
  if(closed)return null;
  const identity=join(directory,'현재계정.json');
  async function consumeLatest(){
   // Claim only this record so a producer's newer busy update is never deleted.
   const claimed=join(directory,'소비-'+randomUUID()+'.json');
   try{await rename(identity,claimed);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
   liveGrant=null;
   try{
    const info=await lstat(claimed);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)return;
    const data=JSON.parse(await readFile(claimed,'utf8'));
    if(data.operationId!==operationId||!Number.isSafeInteger(data.timestamp)||data.timestamp<launchedAt||data.timestamp>Date.now()+1000||Date.now()-data.timestamp>30000||typeof data.ready!=='boolean'||!(data.accountId===null||validEmail(data.accountId)))return;
    liveGrant={timestamp:data.timestamp,accountId:data.accountId,ready:data.ready};
   }finally{await rm(claimed,{force:true});}
  }
  try{
   await consumeLatest();
   if(!liveGrant||Date.now()-liveGrant.timestamp>30000){liveGrant=null;return null;}
   // No PowerShell on empty polls; cached grants require exact owned liveness.
   const state=await control('inspect',target,env,options.cwd,options.executable) as {alive:boolean};
   if(state.alive!==true){liveGrant=null;return null;}
   await consumeLatest(); // Updates arriving during inspect supersede cached ready.
   if(!liveGrant||Date.now()-liveGrant.timestamp>30000){liveGrant=null;return null;}
   return {...liveGrant};
  }catch{liveGrant=null;return null;}
 }
 return {env,read,async logout(expectedAccountId){
  if(logoutSent||!validEmail(expectedAccountId))throw Error('ACCOUNT_MISMATCH');
  // This operation's freshly observed identity remains only in memory after file consumption.
  await read();const snapshot=liveGrant;liveGrant=null;
  if(!snapshot?.ready||snapshot.accountId!==expectedAccountId||Date.now()-snapshot.timestamp>30000)throw Error('ACCOUNT_MISMATCH');
  logoutSent=true;await control('logout',target,env,options.cwd,options.executable);
 },async close(){
  if(closed)return;closed=true;
  try{await control('stop',target,env,options.cwd,options.executable);activeProfiles.delete(home);}finally{await rm(directory,{recursive:true,force:true});}
 }};
}
