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
   return exitCode===0&&a.loggedIn===true&&typeof a.subscriptionType==='string'&&['pro','max','team','enterprise'].includes(a.subscriptionType.toLowerCase())?{connected:true,version:null}:no();
  }catch{return no('NATIVE_RESPONSE_UNRECOGNIZED');}
 }
 // Installed agy models emits tab-separated ID/display-name rows (parent's masked live observation).
 const rows=text.trim().split(/\r?\n/).filter(Boolean);
 const valid=rows.length>0&&rows.every(row=>/^(?:gemini|claude|gpt)-[A-Za-z0-9._-]+\t[^\t\r\n]{1,200}$/.test(row));
 return exitCode===0&&valid?{connected:true,version:null}:no(exitCode===0?'NATIVE_RESPONSE_UNRECOGNIZED':'NATIVE_PROCESS_FAILED');
}
type SpawnProcess=(command:string,args:string[],options:SpawnOptionsWithoutStdio)=>ChildProcessWithoutNullStreams;
export function createNativeConnectionRunner(options:{appRoot:string;cwd:string;spawnProcess?:SpawnProcess;commandTimeoutMs?:number}):ConnectionRunner{
 const spawnProcess=options.spawnProcess??((command,args,opts)=>spawn(command,args,{...opts,stdio:['pipe','pipe','pipe']}));
 return {start(provider,action,emit){
  const executable=provider==='claude'?resolve(options.appRoot,'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'):'C:/Users/YH/AppData/Local/agy/bin/agy.EXE';
  let child:ChildProcessWithoutNullStreams|null=null,canceled=false,acceptsCode=false,abortCurrent:(()=>void)|null=null;
  const cancel=()=>{canceled=true;acceptsCode=false;abortCurrent?.();};
  function run(args:string[],loginFlow=false):Promise<{text:string;exit:number|null}>{
   if(canceled)return Promise.reject(new Error('CANCELED'));
   return new Promise((ok,fail)=>{
    let out='',scanOut='',scanErr='',size=0,settled=false,killTimer:ReturnType<typeof setTimeout>|null=null;
    const c=spawnProcess(executable,args,{cwd:options.cwd,env:childEnvironment(),shell:false,windowsHide:true});child=c;
    const finish=(error?:string,exit:number|null=null)=>{if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);if(child===c){child=null;abortCurrent=null;}acceptsCode=false;const text=out;out=scanOut=scanErr='';error?fail(new Error(error)):ok({text,exit});};
    const stop=()=>{if(settled)return;killTimer??=setTimeout(()=>finish('NATIVE_CLEANUP_UNCONFIRMED'),3000);try{c.kill();}catch{/* No process-name kill or credential reset fallback. */}};abortCurrent=stop;
    const timer=setTimeout(()=>{canceled=true;stop();},options.commandTimeoutMs??180000);timer.unref?.();
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
    c.once('close',(exit:number|null)=>finish(canceled?'CANCELED':undefined,exit));
   });
  }
  const done=(async():Promise<NativeResult>=>{
   let version:string|null=null;
   try{
    const v=await run(['--version']);if(v.exit===0)version=v.text.match(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/)?.[0]??null;
    if(provider==='claude'&&action==='login'){
     const login=await run(['auth','login','--claudeai'],true);
     if(login.exit!==0)return {connected:false,version,errorCode:'LOGIN_FAILED'};
    }
    const result=await run(provider==='claude'?['auth','status']:['models'],provider==='agy');
    return {...parseAuthMetadata(provider,result.text,result.exit),version};
   }catch(e){return {connected:false,version,errorCode:e instanceof Error&&['CANCELED','NATIVE_CLEANUP_UNCONFIRMED'].includes(e.message)?e.message:'NATIVE_PROCESS_FAILED'};}
  })();
  return {done,cancel,code(value){if(canceled||!child||!acceptsCode||!/^[^\s\x00-\x1f\x7f]{1,4096}$/.test(value))throw new Error('CODE_NOT_REQUESTED');acceptsCode=false;child.stdin.write(value+'\n');}};
 }};
}
