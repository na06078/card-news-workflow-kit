import {spawn,type ChildProcessWithoutNullStreams,type SpawnOptionsWithoutStdio} from 'node:child_process';
import {resolve} from 'node:path';
import {childEnvironment} from '../providers/자식환경.js';
import {officialLoginUrl,type ConnectionRunner,type NativeResult} from './연결.js';
import type {ConnectionProvider} from '../shared/연결계약.js';
/** Output remains transient. Never log raw CLI output, email, tokens or authorization codes. */
export function parseAuthMetadata(provider:ConnectionProvider,text:string,exitCode:number|null):NativeResult{
 const no=(errorCode='AUTH_MODE_UNKNOWN'):NativeResult=>({connected:false,version:null,errorCode});
 if(provider==='claude'){
  try{const a=JSON.parse(text) as Record<string,unknown>;
   if(a.loggedIn===false)return no('LOGIN_REQUIRED');
   if(a.authMethod!=='claude.ai'||a.apiProvider!=='firstParty')return no('AUTH_PATH_FORBIDDEN');
   if(typeof a.subscriptionType!=='string'||!['pro','max','team','enterprise'].includes(a.subscriptionType.toLowerCase()))return no('AUTH_MODE_UNKNOWN');
   const email=typeof a.email==='string'&&/^[^\s@\x00-\x1f\x7f]{1,128}@[^\s@\x00-\x1f\x7f]{1,190}\.[^\s@\x00-\x1f\x7f]{1,63}$/.test(a.email)?a.email:null;
   return exitCode===0&&a.loggedIn===true&&email?{connected:true,version:null,accountId:email}:no('ACCOUNT_ID_UNAVAILABLE');
  }catch{return no('NATIVE_RESPONSE_UNRECOGNIZED');}
 }
 // Model availability never proves authentication or the current account.
 return no('ACCOUNT_ID_UNAVAILABLE');
}
const ACCOUNT_POLL_INTERVAL_MS=500;
type SpawnProcess=(command:string,args:string[],options:SpawnOptionsWithoutStdio)=>ChildProcessWithoutNullStreams;
export interface AccountObservation {accountId:string|null;ready:boolean;timestamp:number}
export interface AccountConsole {env:Record<string,string>;read():Promise<AccountObservation|null>;logout(expectedAccountId:string):Promise<void>;close():Promise<void>}
export interface AccountConsoleOptions {executable:string;cwd:string;appRoot:string}
export function createNativeConnectionRunner(options:{appRoot:string;cwd:string;spawnProcess?:SpawnProcess;commandTimeoutMs?:number;openAccountConsole?:(options:AccountConsoleOptions)=>Promise<AccountConsole>}):ConnectionRunner{
 const spawnProcess=options.spawnProcess??((command,args,opts)=>spawn(command,args,{...opts,stdio:['pipe','pipe','pipe']}));
 return {start(provider,action,emit,context){
  const executable=provider==='claude'?resolve(options.appRoot,'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'):'C:/Users/YH/AppData/Local/agy/bin/agy.EXE';
  let child:ChildProcessWithoutNullStreams|null=null,canceled=false,acceptsCode=false,abortCurrent:(()=>void)|null=null;
  let confirmCurrent:(()=>void)|null=null;
  const cancel=()=>{canceled=true;acceptsCode=false;abortCurrent?.();confirmCurrent?.();};
  function run(args:string[],loginFlow=false,env=childEnvironment(),deadline?:number):Promise<{text:string;exit:number|null}>{
   if(process.env.CARDNEWS_LIVE_CALLS==='forbidden'&&!options.spawnProcess)return Promise.reject(new Error('LIVE_CALLS_FORBIDDEN'));
   if(canceled)return Promise.reject(new Error('CANCELED'));
   return new Promise((ok,fail)=>{
    let out='',scanOut='',scanErr='',size=0,settled=false,timedOut=false,killTimer:ReturnType<typeof setTimeout>|null=null;
    const c=spawnProcess(executable,args,{cwd:options.cwd,env,shell:false,windowsHide:true});child=c;
    const finish=(error?:string,exit:number|null=null)=>{if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);if(child===c){child=null;abortCurrent=null;}acceptsCode=false;const text=out;out=scanOut=scanErr='';error?fail(new Error(error)):ok({text,exit});};
    const stop=()=>{if(settled)return;killTimer??=setTimeout(()=>finish('NATIVE_CLEANUP_UNCONFIRMED'),3000);try{c.kill();}catch{/* No process-name kill or credential reset fallback. */}};abortCurrent=stop;
    const timer=setTimeout(()=>{timedOut=true;stop();},deadline===undefined?(options.commandTimeoutMs??180000):Math.max(0,deadline-Date.now()));timer.unref?.();
    function consume(chunk:string,stderr:boolean){
     if(settled||canceled)return;size+=Buffer.byteLength(chunk);if(size>131072){canceled=true;stop();return;}
     if(!stderr)out+=chunk;
     if(!loginFlow)return;
     const text=(stderr?scanErr:scanOut)+chunk;
     for(const match of text.matchAll(/https:\/\/[^\s<>"'\x1b]+/g)){
      // Only publish complete URL tokens; incomplete chunk tails are scanned again.
      if(match.index!+match[0].length===text.length)continue;
      const url=officialLoginUrl(provider,match[0]);if(url)emit({loginUrl:url});
     }
     const prompted=/(?:enter|paste|provide)[^\r\n]{0,70}(?:authorization|authentication|verification|auth)\s+code\s*:?/i.test(text)||/(?:enter|paste)\s+(?:the\s+)?code\s*:/i.test(text);
     if(prompted){
      if(!acceptsCode){acceptsCode=true;emit({needsCode:true});}
     }
     if(stderr)scanErr=prompted?'':text.slice(-16384);else scanOut=prompted?'':text.slice(-16384);
    }
    c.stdout.setEncoding('utf8');c.stderr.setEncoding('utf8');
    c.stdout.on('data',(s:string)=>consume(s,false));c.stderr.on('data',(s:string)=>consume(s,true));
    c.stdin.on('error',()=>{canceled=true;stop();});
    c.once('error',()=>finish('NATIVE_PROCESS_FAILED'));
    c.once('close',(exit:number|null)=>finish(canceled?'CANCELED':timedOut?'NATIVE_TIMEOUT':undefined,exit));
    if(!loginFlow)c.stdin.end();
   });
  }
  const done=(async():Promise<NativeResult>=>{
   let version:string|null=null;
   try{
    const v=await run(['--version']);if(v.exit===0)version=v.text.match(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/)?.[0]??null;
    if(canceled)throw Error('CANCELED');
    if(provider==='agy'){
     const handle=await (options.openAccountConsole??(await import('./계정콘솔.js')).openNativeAccountConsole)({executable,cwd:options.cwd,appRoot:options.appRoot});
     try{
      emit({externalConsole:true,autoConfirm:action!=='logout'});
      const deadline=Date.now()+(options.commandTimeoutMs??180000);
      const pause=()=>new Promise<void>(ok=>{
       const finish=()=>{clearTimeout(timer);confirmCurrent=null;ok();};
       const timer=setTimeout(finish,Math.min(ACCOUNT_POLL_INTERVAL_MS,Math.max(0,deadline-Date.now())));
       confirmCurrent=finish;if(canceled)finish();
      });
      const assertActive=()=>{if(canceled)throw Error('CANCELED');if(Date.now()>=deadline)throw Error('NATIVE_TIMEOUT');};
      let identity:AccountObservation|null=null;
      if(action==='logout'){
       await new Promise<void>((ok,fail)=>{
        const timer=setTimeout(()=>{confirmCurrent=null;fail(Error('NATIVE_TIMEOUT'));},Math.max(0,deadline-Date.now()));
        confirmCurrent=()=>{clearTimeout(timer);confirmCurrent=null;ok();};if(canceled)confirmCurrent();
       });
       assertActive();identity=await handle.read();
      }else{
       while(true){assertActive();identity=await handle.read();assertActive();
        if(identity?.ready&&identity.accountId&&Date.now()-identity.timestamp<=30000&&identity.timestamp<=Date.now()+1000)break;
        await pause();
       }
      }
      if(!identity?.ready||!identity.accountId)return {connected:false,version,accountId:null,errorCode:'ACCOUNT_ID_UNAVAILABLE'};
      const accountId=identity.accountId;
      while(true){
      const usage=await run(['--print','/usage','--output-format','json'],false,handle.env,deadline);
      assertActive();
      let authenticated=false;try{const j=JSON.parse(usage.text);authenticated=usage.exit===0&&j.command?.name==='usage'&&Array.isArray(j.command?.data?.groups)&&j.command.data.groups.length>0&&j.command.data.groups.every((g:Record<string,unknown>)=>Array.isArray(g.buckets));}catch{/* No model-list or text fallback. */}
      if(!authenticated)return {connected:false,version,accountId:null,errorCode:'AUTH_METADATA_UNCONFIRMED'};
      if(action==='logout'){
       if(identity.accountId!==context?.expectedAccountId)return {connected:false,version,accountId:null,errorCode:'ACCOUNT_MISMATCH'};
       await handle.logout(identity.accountId);
       // Only explicit structured native authentication failure proves logout.
       // An exit, a killed TUI, empty email or quota/network failure does not.
       const after=await run(['--print','/usage','--output-format','json'],false,handle.env);
       let signedOut=false;try{const j=JSON.parse(after.text);signedOut=after.exit!==0&&after.exit!==null&&j.status==='ERROR'&&typeof j.error==='string'&&/^authentication required\b/i.test(j.error)&&j.num_turns===0&&j.usage?.input_tokens===0&&j.usage?.output_tokens===0&&j.usage?.total_tokens===0;}catch{/* Unknown native errors remain unconfirmed. */}
       return signedOut?{connected:false,version,accountId:null,loggedOut:true,errorCode:'LOGIN_REQUIRED'}:{connected:false,version,accountId:null,errorCode:'LOGOUT_UNCONFIRMED'};
      }
      let latest=await handle.read();assertActive();
      if(latest?.accountId&&latest.accountId!==accountId)throw Error('ACCOUNT_MISMATCH');
      const ready=(value:AccountObservation|null)=>!!value?.ready&&value.accountId===accountId&&Date.now()-value.timestamp<=30000&&value.timestamp<=Date.now()+1000;
      if(ready(latest))return {connected:true,version,accountId};
      // A later busy/invalid observation revokes the earlier grant. Wait for ready,
      // then query authentication again; never close a console still doing work.
      do{await pause();assertActive();latest=await handle.read();assertActive();
       if(latest?.accountId&&latest.accountId!==accountId)throw Error('ACCOUNT_MISMATCH');
      }while(!ready(latest));
      }
     }finally{
      try{await handle.close();}catch{throw Error('NATIVE_CLEANUP_UNCONFIRMED');}
     }
    }
    if(provider==='claude'&&action==='login'){
     const login=await run(['auth','login','--claudeai'],true);
     if(login.exit!==0)return {connected:false,version,errorCode:'LOGIN_FAILED'};
    }
    const result=await run(['auth','status']);
    const metadata=parseAuthMetadata(provider,result.text,result.exit);
    if(action==='logout'){
     if(!metadata.connected||!metadata.accountId||metadata.accountId!==context?.expectedAccountId)return {connected:false,version,accountId:null,errorCode:'ACCOUNT_MISMATCH'};
     const logout=await run(['auth','logout']);
     if(logout.exit!==0)return {connected:false,version,accountId:null,errorCode:'LOGOUT_FAILED'};
     const after=await run(['auth','status']);const verified=parseAuthMetadata('claude',after.text,after.exit);
     return verified.errorCode==='LOGIN_REQUIRED'?{connected:false,version,accountId:null,loggedOut:true,errorCode:'LOGIN_REQUIRED'}:{connected:false,version,accountId:null,errorCode:'LOGOUT_UNCONFIRMED'};
    }
    return {...metadata,version};
   }catch(e){return {connected:false,version,errorCode:e instanceof Error&&['CANCELED','NATIVE_CLEANUP_UNCONFIRMED','LIVE_CALLS_FORBIDDEN','NATIVE_TIMEOUT','ACCOUNT_MISMATCH'].includes(e.message)?e.message:'NATIVE_PROCESS_FAILED'};}
  })();
  return {done,cancel,confirm(){confirmCurrent?.();},code(value){if(canceled||!child||!acceptsCode||!/^[^\s\x00-\x1f\x7f]{1,4096}$/.test(value))throw new Error('CODE_NOT_REQUESTED');acceptsCode=false;child.stdin.write(value+'\n');}};
 }};
}
