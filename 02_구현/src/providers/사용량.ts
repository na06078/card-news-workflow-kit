import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import type {Options,AccountInfo,SDKUserMessage} from '@anthropic-ai/claude-agent-sdk';
import type {ProviderReading} from '../shared/작업공간계약.js';
import {childEnvironment,assertChildEnvironment} from './자식환경.js';
import {inspectAccountMetadata} from './구독검증.js';
import {ProviderFailure} from './오류.js';
import {MetadataErrorCodeSchema,type MetadataErrorCode} from '../shared/작업공간계약.js';
import {ModelCatalogSchema,type ModelCatalog,type QuotaProvider,type QuotaMetric} from '../shared/작업공간계약.js';
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const percent=(v:unknown,max=100):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
const date=(v:unknown):string|null=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const safeLabel=(v:unknown,fallback:string)=>typeof v==='string'&&/^[a-zA-Z0-9가-힣 ()_.:/-]{1,120}$/.test(v)?v:fallback;
export const METADATA_ERROR='사용량 정보를 확인하지 못했습니다. 다시 조회해 주세요.';
/** DTO 코드만 허용하고 외부 오류 문장은 절대 사용하지 않습니다. */
export function metadataDiagnostic(value:unknown):{errorCode:MetadataErrorCode;message:string}{
 const parsed=MetadataErrorCodeSchema.safeParse(value),errorCode=parsed.success?parsed.data:'METADATA_UNAVAILABLE';
 const messages:Record<MetadataErrorCode,string>={
  AUTH_PATH_FORBIDDEN:'허용되지 않은 인증·과금 경로가 확인되어 메타데이터 조회를 차단했습니다. 공식 구독 로그인 경로를 확인해 주세요.',
  AUTH_MODE_UNKNOWN:'본인 구독 인증을 확인하지 못해 메타데이터 조회를 차단했습니다. 공식 구독 로그인 상태를 확인해 주세요.',
  METADATA_CLEANUP_UNCONFIRMED:'메타데이터 조회용 자식 프로세스의 종료를 확인하지 못했습니다. 조회 결과를 사용하지 않습니다. 앱을 종료하고 해당 소유 프로세스의 종료를 확인해 주세요.',
  METADATA_UNAVAILABLE:METADATA_ERROR,
 };
 return {errorCode,message:messages[errorCode]};
}
function knownAuthError(error:unknown){return error instanceof ProviderFailure&&(error.code==='AUTH_PATH_FORBIDDEN'||error.code==='AUTH_MODE_UNKNOWN');}
class MetadataCleanupFailure extends Error {}
function diagnostic(error:unknown){return metadataDiagnostic(error instanceof MetadataCleanupFailure?'METADATA_CLEANUP_UNCONFIRMED':knownAuthError(error)?(error as ProviderFailure).code:undefined);}
function failedModels(error:unknown=null):ModelCatalog{const d=diagnostic(error);return {status:'error',checkedAt:null,models:[],error:d.message,errorCode:d.errorCode};}
function failedQuota(provider:'claude'|'agy',error:unknown=null):QuotaProvider{const d=diagnostic(error);return {provider,label:provider==='claude'?'Claude':'Antigravity',status:'error',checkedAt:null,metrics:[],message:d.message,errorCode:d.errorCode};}

export interface MetadataQuery {
 initializationResult():Promise<{account:AccountInfo}>;accountInfo():Promise<AccountInfo>;
 supportedModels():Promise<unknown>;usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options:{skipBehaviors:true}):Promise<unknown>;close():void;
}
export interface MetadataOptions {appRoot:string;cwd:string;signal?:AbortSignal;timeoutMs?:number;cleanupMs?:number;dependencies?:{
 open?:(args:{prompt:AsyncIterable<SDKUserMessage>;options:Options})=>MetadataQuery;
 runAgy?:(signal:AbortSignal)=>Promise<unknown>;
 spawnProcess?:typeof spawn;
 };}
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((ok,fail)=>{const stop=()=>fail(Error('METADATA_ABORTED'));if(signal.aborted){work.catch(()=>{});stop();return;}signal.addEventListener('abort',stop,{once:true});work.then(ok,fail).finally(()=>signal.removeEventListener('abort',stop));});
}
async function bounded<T>(promise:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new MetadataCleanupFailure()),ms);})]);}finally{if(timer)clearTimeout(timer);}}
function owned(child:ChildProcessWithoutNullStreams){
 let closed=false;const exit=new Promise<void>(resolve=>{child.once('close',()=>{closed=true;resolve();});child.on('error',()=>{});});
 const kill=()=>{if(!closed)try{child.kill();}catch{/* No name-based/process-tree cleanup. */}};
 return {exit,kill,async cleanup(ms:number){try{await bounded(exit,Math.min(250,ms));}catch{kill();await bounded(exit,ms);}}};
}
async function runNativeAgy(options:MetadataOptions,signal:AbortSignal):Promise<unknown>{
 if(process.env.CARDNEWS_LIVE_CALLS==='forbidden'&&!options.dependencies?.spawnProcess)throw Error('LIVE_CALLS_FORBIDDEN');
 if(signal.aborted)throw Error('METADATA_ABORTED');const env=childEnvironment();assertChildEnvironment(env);
 const child=(options.dependencies?.spawnProcess??spawn)(resolve(homedir(),'AppData/Local/agy/bin/agy.EXE'),['--print','/usage','--output-format','json'],{cwd:options.cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
 const tracked=owned(child);let text='',size=0;let failed=false;child.stdin.end();
 child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{size+=Buffer.byteLength(chunk);if(size>1048576){failed=true;tracked.kill();}else text+=chunk;});child.stderr.on('data',()=>{});child.on('error',()=>{failed=true;});child.once('close',code=>{if(code!==0)failed=true;});
 signal.addEventListener('abort',tracked.kill,{once:true});
 try{await abortable(tracked.exit,signal);if(failed)throw Error('METADATA_NATIVE_ERROR');return JSON.parse(text);}finally{signal.removeEventListener('abort',tracked.kill);await tracked.cleanup(options.cleanupMs??2000);text='';}
}
export async function readProviderMetadata(options:MetadataOptions):Promise<ProviderReading> {
 const at=new Date().toISOString(),controller=new AbortController();const cancel=()=>controller.abort();
 options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
 const timer=setTimeout(cancel,options.timeoutMs??30000);
 let models=parseModels(null,at),claude=parseClaudeUsage(null,at),agy=parseAgyUsage(null,at);
 const claudeWork=async()=>{
 const children:ReturnType<typeof owned>[]=[];let handle:MetadataQuery|undefined;let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 try{
 if(controller.signal.aborted)throw Error('METADATA_ABORTED');
 if(process.env.CARDNEWS_LIVE_CALLS==='forbidden'&&!options.dependencies?.open)throw Error('LIVE_CALLS_FORBIDDEN');
 const open=options.dependencies?.open??(await import('@anthropic-ai/claude-agent-sdk')).query;
 if(controller.signal.aborted)throw Error('METADATA_ABORTED');
 const executable=resolve(options.appRoot,'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe');
 handle=open({prompt:(async function*():AsyncGenerator<SDKUserMessage>{await gate;})(),options:{pathToClaudeCodeExecutable:executable,spawnClaudeCodeProcess:o=>{
 if(controller.signal.aborted||resolve(o.command)!==executable)throw Error('METADATA_SPAWN_FORBIDDEN');
 if(process.env.CARDNEWS_LIVE_CALLS==='forbidden'&&!options.dependencies?.spawnProcess)throw Error('LIVE_CALLS_FORBIDDEN');
 assertChildEnvironment(o.env);const child=(options.dependencies?.spawnProcess??spawn)(o.command,o.args,{cwd:o.cwd,env:o.env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
 children.push(owned(child));return child;
 },cwd:options.cwd,env:childEnvironment(),settingSources:[],strictMcpConfig:true,mcpServers:{},plugins:[],tools:[],permissionMode:'default',persistSession:false,abortController:controller,settings:{forceLoginMethod:'claudeai',apiKeyHelper:'',autoMemoryEnabled:false,disableAllHooks:true}}});
 inspectAccountMetadata((await abortable(handle.initializationResult(),controller.signal)).account);inspectAccountMetadata(await abortable(handle.accountInfo(),controller.signal));
 try{models=parseModels(await abortable(handle.supportedModels(),controller.signal),at);}catch(error){if(knownAuthError(error))throw error;models=failedModels(error);}
 try{if(controller.signal.aborted)throw Error('METADATA_ABORTED');claude=parseClaudeUsage(await abortable(handle.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true}),controller.signal),at);}catch(error){if(knownAuthError(error))throw error;claude=failedQuota('claude',error);}
  inspectAccountMetadata(await abortable(handle.accountInfo(),controller.signal));
 }catch(error){models=failedModels(error);claude=failedQuota('claude',error);}finally{release();let cleanupFailed=false;try{handle?.close();}catch{cleanupFailed=true;}
 if(controller.signal.aborted)children.forEach(c=>c.kill());
 const exits=await Promise.allSettled(children.map(c=>c.cleanup(options.cleanupMs??2000)));
 if(cleanupFailed||exits.some(result=>result.status==='rejected')){const error=new MetadataCleanupFailure();models=failedModels(error);claude=failedQuota('claude',error);}
 }
 };
 const agyWork=async()=>{try{if(controller.signal.aborted)throw Error('METADATA_ABORTED');const raw=options.dependencies?.runAgy?await abortable(options.dependencies.runAgy(controller.signal),controller.signal):await runNativeAgy(options,controller.signal);agy=parseAgyUsage(raw,at);}catch(error){agy=failedQuota('agy',error);}};
 try{await Promise.all([claudeWork(),agyWork()]);return {models,providers:[claude,agy]};}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
}
export function parseModels(raw:unknown,checkedAt:string):ModelCatalog {
 const failed=failedModels();
 if(!Array.isArray(raw)||!raw.length)return failed;
 const rows=raw.map(item=>{const row=object(item);return {value:row.value,displayName:safeLabel(row.displayName,'Claude 모델'),description:safeLabel(row.description,'')};});
 const result=ModelCatalogSchema.safeParse({status:'ready',checkedAt,models:rows,error:null});
 return result.success?result.data:failed;
}
export function parseAgyUsage(raw:unknown,checkedAt:string):QuotaProvider {
 const groups=object(object(object(raw).command).data).groups;const metrics:QuotaMetric[]=[];
 if(!Array.isArray(groups)||groups.some(g=>!Array.isArray(object(g).buckets)))return failedQuota('agy');
 groups.forEach((item,i)=>{const group=object(item);if(Array.isArray(group.buckets))group.buckets.forEach((item,j)=>{
 const row=object(item),remaining=percent(row.remaining_fraction,1);
 metrics.push({id:`agy-${i}-${j}`,label:`Antigravity · ${safeLabel(group.name,`그룹 ${i+1}`)} · ${safeLabel(row.name,safeLabel(row.window,`한도 ${j+1}`))}`,remainingPercent:remaining===null?null:remaining*100,resetsAt:date(row.reset_time),scope:'model',source:'agy /usage'});
 });});
 return {provider:'agy',label:'Antigravity',status:'ready',checkedAt,metrics,message:'이미지 전용 잔여량은 제공되지 않습니다.'};
}
export function parseClaudeUsage(raw:unknown,checkedAt:string):QuotaProvider {
 const data=object(raw),limits=object(data.rate_limits);const metrics:QuotaMetric[]=[];
 if(data.rate_limits===null||typeof data.rate_limits!=='object'||Array.isArray(data.rate_limits)||data.rate_limits_available!==true||!['pro','max','team'].includes(String(data.subscription_type).toLowerCase()))return failedQuota('claude');
 const names:Record<string,string>={five_hour:'5시간',seven_day:'7일',seven_day_oauth_apps:'OAuth 앱 7일',seven_day_opus:'Opus 7일',seven_day_sonnet:'Sonnet 7일'};
 for(const [id,label] of Object.entries(names))if(id in limits&&limits[id]!==null){const row=object(limits[id]),used=percent(row.utilization);metrics.push({id,label,remainingPercent:used===null?null:100-used,resetsAt:date(row.resets_at),scope:id.includes('opus')||id.includes('sonnet')?'model':'account',source:'Claude SDK usage control'});}
 if(Array.isArray(limits.model_scoped))limits.model_scoped.forEach((item,i)=>{const row=object(item),used=percent(row.utilization);metrics.push({id:`model-${i}`,label:safeLabel(row.display_name,`모델 한도 ${i+1}`),remainingPercent:used===null?null:100-used,resetsAt:date(row.resets_at),scope:'model',source:'Claude SDK usage control'});});
 return {provider:'claude',label:'Claude',status:'ready',checkedAt,metrics,message:null};
}
