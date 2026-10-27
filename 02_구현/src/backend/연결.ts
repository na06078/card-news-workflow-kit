import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {ConnectionProviderSchema,ConnectionRequestSchema,ConnectionCancelRequestSchema,ConnectionCodeRequestSchema,ConnectionLogoutRequestSchema,ConnectionStateSchema,type ConnectionProvider,type ConnectionState} from '../shared/연결계약.js';
import {DomainError} from './도메인.js';
export type NativeResult={connected:boolean;version:string|null;errorCode?:string;accountId?:string|null;loggedOut?:boolean};
export type NativeEvent={loginUrl?:string;needsCode?:boolean;externalConsole?:boolean;autoConfirm?:boolean};
export type ConnectionTask={done:Promise<NativeResult>;cancel():void;code(value:string):void;confirm?():void};
export type ConnectionRunner={start(provider:ConnectionProvider,action:'check'|'login'|'logout',emit:(event:NativeEvent)=>void,context?:{expectedAccountId?:string}):ConnectionTask};
type MutationInput={requestId:string;operationId?:string;authorizationCode?:string;confirm?:boolean;expectedAccountId?:string};
type NativeAction='check'|'login'|'logout';
const nativeErrorCodes=new Set(['ACCOUNT_MISMATCH','LOGOUT_UNCONFIRMED','ACCOUNT_ID_UNAVAILABLE','AUTH_METADATA_UNCONFIRMED','AUTH_PATH_FORBIDDEN','AUTH_MODE_UNKNOWN','LOGIN_REQUIRED','LOGIN_FAILED','LOGOUT_FAILED','CANCELED','LIVE_CALLS_FORBIDDEN','NATIVE_TIMEOUT','NATIVE_PROCESS_FAILED','NATIVE_RESPONSE_UNRECOGNIZED']);
function connectionFailureMessage(code:string|null):string{
 const messages:Record<string,string>={
  ACCOUNT_MISMATCH:'현재 계정과 요청한 계정이 일치하지 않아 계정 작업을 중단했습니다. 공식 도구의 현재 계정을 다시 확인해 주세요. 자동 로그아웃이나 계정 전환은 하지 않습니다.',
  LOGOUT_UNCONFIRMED:'공식 로그아웃 완료와 후속 미로그인 상태를 확인하지 못했습니다. 로그아웃 성공으로 처리하지 않았습니다. 공식 도구의 현재 로그인 상태를 확인해 주세요.',
  ACCOUNT_ID_UNAVAILABLE:'공식 도구에서 현재 계정 ID를 확인하지 못했습니다. 계정을 추정하지 않으며 로그아웃은 진행할 수 없습니다. 공식 화면의 현재 계정을 확인한 뒤 연결을 다시 확인해 주세요.',
  AUTH_METADATA_UNCONFIRMED:'계정 ID와 별개로 인증 메타데이터를 확인하지 못했습니다. 검색·이미지 생성 가능 여부도 확인되지 않았습니다. 공식 로그인 상태를 확인한 뒤 연결을 다시 확인해 주세요.',
  AUTH_PATH_FORBIDDEN:'허용되지 않은 인증·과금 경로입니다. 공식 구독 로그인 경로를 확인해 주세요.',
  AUTH_MODE_UNKNOWN:'본인 구독 인증을 확인하지 못했습니다. 공식 구독 로그인 상태를 확인해 주세요.',
 };
 return messages[code??'']??'계정 연결을 확인하지 못했습니다. 공식 로그인 상태를 확인해 주세요.';
}

type Pending={
 id:string;
 action:NativeAction;
 task:ConnectionTask|null;
 timer:ReturnType<typeof setTimeout>|null;
 ended:boolean;
 cleanupUnconfirmed?:boolean;
};
export function createConnectionService(options:{
 runner:ConnectionRunner;
 hasActiveRuns:()=>boolean;
 timeoutMs?:number;
 onAuthChanged?:()=>void;
}){
 const states:ConnectionState[]=(['claude','agy'] as const).map(provider=>({
  provider,status:'unknown',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,
  message:'아직 연결을 확인하지 않았습니다.',errorCode:null,operationId:null,
  loginUrl:null,needsCode:false,verification:'not_checked',accountId:null,externalConsole:false,autoConfirm:false,
 }));
 const pending=new Map<ConnectionProvider,Pending>();
 const receipts=new Map<string,{fingerprint:string;state:ConnectionState}>();
 const secret=randomBytes(32);
 const now=()=>new Date().toISOString();
 const state=(provider:ConnectionProvider)=>states.find(item=>item.provider===provider)!;
 let disposed=false;

 function mutate(provider:ConnectionProvider,action:string,input:MutationInput,fn:()=>void){
  ConnectionProviderSchema.parse(provider);
  // Keep only a keyed digest: never retain authorization codes in receipts.
  const fingerprint=createHmac('sha256',secret).update(JSON.stringify([
   action,input.operationId??null,input.authorizationCode??null,input.confirm??null,input.expectedAccountId??null,
  ])).digest('hex');
  const key=provider+':'+input.requestId,old=receipts.get(key);
  if(old){
   if(old.fingerprint!==fingerprint)throw new DomainError('REQUEST_ID_CONFLICT');
   return {state:structuredClone(old.state),replayed:true};
  }
  if(disposed)throw new DomainError('STAGE_CONFLICT');
  if(receipts.size>=10000)throw new DomainError('STORAGE_BUSY');
  fn();
  const snapshot=structuredClone(state(provider));
  receipts.set(key,{fingerprint,state:snapshot});
  return {state:structuredClone(snapshot),replayed:false};
 }
 function updateAccount(provider:ConnectionProvider,accountId:string|null){
  if((state(provider).accountId??null)!==accountId)options.onAuthChanged?.();
  state(provider).accountId=accountId;
 }
 function end(provider:ConnectionProvider,op:Pending,status:ConnectionState['status'],code:string|null,message:string){
  if(pending.get(provider)!==op||op.ended)return;
  op.ended=true;
  if(op.timer)clearTimeout(op.timer);
  if(status!=='connected'){
   updateAccount(provider,null);
   Object.assign(state(provider),{authMethod:'unknown',verification:'not_checked'});
  }
  Object.assign(state(provider),{
   status,errorCode:code,message,loginUrl:null,needsCode:false,externalConsole:false,autoConfirm:false,lastActivityAt:now(),
  });
 }
 function receiveEvent(provider:ConnectionProvider,op:Pending,event:NativeEvent){
  if(pending.get(provider)!==op||op.ended)return;
  const url=event.loginUrl?officialLoginUrl(provider,event.loginUrl):null;
  const autoConfirm=provider==='agy'&&op.action!=='logout'&&event.autoConfirm===true;
  Object.assign(state(provider),{
   lastActivityAt:now(),
   ...(event.externalConsole!==undefined?{externalConsole:event.externalConsole}:{}),
   ...(event.autoConfirm!==undefined?{autoConfirm}:{}),
   ...(autoConfirm?{message:'계정 정보를 자동 확인하고 있습니다. 확인이 끝나면 연결 창이 자동으로 닫힙니다.'}:{}),
   ...(url?{loginUrl:url,status:'login_pending',message:'공식 브라우저에서 로그인을 완료해 주세요.'}:{}),
   ...(event.needsCode?{needsCode:true,status:'login_pending',message:'공식 로그인 화면에서 발급한 인증 코드가 필요합니다.'}:{}),
  });
 }
 function receiveResult(provider:ConnectionProvider,op:Pending,action:NativeAction,result:NativeResult){
  if(pending.get(provider)!==op)return;
  // Cleanup failure wins even after cancellation/timeout and keeps the duplicate-run lock.
  if(result.errorCode==='NATIVE_CLEANUP_UNCONFIRMED'){
   op.cleanupUnconfirmed=true;
   op.ended=true;
   updateAccount(provider,null);
   Object.assign(state(provider),{
    status:'error',authMethod:'unknown',verification:'not_checked',externalConsole:false,autoConfirm:false,
    errorCode:result.errorCode,loginUrl:null,needsCode:false,lastActivityAt:now(),
    message:'앱 소유 연결 창·자식 프로세스의 종료를 확인하지 못했습니다. 중복 실행을 막았습니다. 앱을 종료하고 해당 소유 창·프로세스가 종료되었는지 확인한 뒤 앱을 다시 시작해 주세요. 다른 프로세스나 계정 설정을 일괄 정리하지 마세요.',
   });
   return;
  }
  if(op.ended)return;
  const parsed=ConnectionStateSchema.shape.accountId.safeParse(result.accountId);
  updateAccount(provider,result.connected&&parsed.success?parsed.data??null:null);
  Object.assign(state(provider),{
   version:result.version,checkedAt:now(),
   authMethod:result.connected?(provider==='claude'?'subscription':'google_account'):'unknown',
   verification:result.connected?'metadata':'not_checked',
  });
  const loggedOut=action==='logout'&&result.loggedOut===true&&!result.connected;
  const status=result.connected?'connected':loggedOut||result.errorCode==='LOGIN_REQUIRED'?'login_required':'error';
  const code=result.connected||loggedOut?null:result.errorCode===undefined?'AUTH_MODE_UNKNOWN':nativeErrorCodes.has(result.errorCode)?result.errorCode:'NATIVE_PROCESS_FAILED';
  const message=loggedOut?'공식 로그아웃과 후속 미로그인 상태를 확인했습니다.':result.connected
   ?'계정 연결 메타데이터를 확인했습니다. 검색·이미지 생성 성공이나 잔여 한도를 뜻하지 않습니다.'
   :connectionFailureMessage(code);
  end(provider,op,status,code,message);
 }
 function begin(provider:ConnectionProvider,action:NativeAction,input:MutationInput){
  return mutate(provider,action,input,()=>{
   const existing=pending.get(provider);
   if(existing){
    if(action==='check'&&!existing.ended&&state(provider).externalConsole){
     existing.task?.confirm?.();
    }
    return;
   }
   if(action==='logout'&&(state(provider).status!=='connected'||!state(provider).accountId||state(provider).accountId!==input.expectedAccountId)){
    throw new DomainError('STAGE_CONFLICT');
   }
   if(options.hasActiveRuns())throw new DomainError('RUN_ACTIVE',null,null,'제작 작업을 마치거나 취소한 뒤 연결해 주세요.');
   if(action==='login'||action==='logout')options.onAuthChanged?.();
   const op:Pending={id:randomUUID(),action,task:null,timer:null,ended:false};
   pending.set(provider,op);
   Object.assign(state(provider),{
    status:action==='logout'?'logout_pending':action==='login'?'login_pending':'checking',
    operationId:op.id,errorCode:null,authMethod:'unknown',verification:'not_checked',
    loginUrl:null,needsCode:false,externalConsole:false,autoConfirm:false,lastActivityAt:now(),
    message:action==='logout'?'공식 도구에서 현재 계정 로그아웃을 확인합니다.':action==='login'
     ?'공식 로그인 절차를 시작합니다. 별도 공식 화면의 안내를 완료해 주세요.'
     :'공식 도구의 현재 계정 연결 메타데이터를 확인합니다.',
   });
   try{
    op.task=options.runner.start(provider,action,event=>receiveEvent(provider,op,event),
     action==='logout'?{expectedAccountId:input.expectedAccountId}:undefined);
    op.timer=setTimeout(()=>{
     end(provider,op,'error','CONNECTION_TIMEOUT','연결 확인 시간이 초과되었습니다. 공식 로그인 상태를 확인한 뒤 다시 시도해 주세요.');
     op.task?.cancel();
    },options.timeoutMs??180000);
    op.timer.unref?.();
    void op.task.done.then(result=>receiveResult(provider,op,action,result),()=>{
     end(provider,op,'error','NATIVE_PROCESS_FAILED','공식 연결 프로세스를 실행하지 못했습니다.');
    }).finally(()=>{
     if(op.timer)clearTimeout(op.timer);
     if(pending.get(provider)===op&&!op.cleanupUnconfirmed)pending.delete(provider);
    });
   }catch{
    end(provider,op,'error','NATIVE_PROCESS_FAILED','공식 연결 프로세스를 실행하지 못했습니다.');
    pending.delete(provider);
   }
  });
 }
 return {
  list:()=>({connections:structuredClone(states)}),
  busy:()=>pending.size>0,
  start(provider:ConnectionProvider,action:'check'|'login',input:{requestId:string}){
   ConnectionRequestSchema.parse(input);
   return begin(provider,action,input);
  },
  logout(provider:ConnectionProvider,input:{requestId:string;confirm:true;expectedAccountId:string}){
   ConnectionLogoutRequestSchema.parse(input);
   return begin(provider,'logout',input);
  },
  cancel(provider:ConnectionProvider,input:{requestId:string;operationId:string}){
   ConnectionCancelRequestSchema.parse(input);
   return mutate(provider,'cancel',input,()=>{
    const op=pending.get(provider);
    if(!op||op.id!==input.operationId)throw new DomainError('STAGE_CONFLICT');
    if(op.cleanupUnconfirmed)return;
    end(provider,op,'unknown','CANCELED','이 앱의 연결 작업을 취소했습니다. 기존 로그인은 삭제하지 않습니다.');
    op.task?.cancel();
   });
  },
  code(provider:ConnectionProvider,input:{requestId:string;operationId:string;authorizationCode:string}){
   ConnectionCodeRequestSchema.parse(input);
   return mutate(provider,'code',input,()=>{
    const op=pending.get(provider);
    if(!op||op.ended||op.id!==input.operationId||!state(provider).needsCode)throw new DomainError('STAGE_CONFLICT');
    op.task!.code(input.authorizationCode);
    Object.assign(state(provider),{needsCode:false,lastActivityAt:now(),message:'공식 로그인 프로세스에 코드를 전달했습니다. 연결 확인을 기다립니다.'});
   });
  },
  async dispose(){
   disposed=true;
   for(const [provider,op]of pending){
    if(op.cleanupUnconfirmed)continue;
    end(provider,op,'unknown','CANCELED','서버의 연결 작업을 종료했습니다.');
    op.task?.cancel();
   }
   await Promise.allSettled([...pending.values()].map(op=>op.task?.done));
  },
 };
}
export function officialLoginUrl(provider:ConnectionProvider,value:string):string|null{
 try{const u=new URL(value);const hosts=provider==='claude'?['claude.ai']:['accounts.google.com','antigravity.google'];
  if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname)||value.length>8192)return null;
  if(provider==='claude'&&!/^\/(?:oauth|login)(?:\/|$)/.test(u.pathname))return null;
  if(provider==='agy'&&u.hostname==='antigravity.google'&&!/^\/(?:auth|oauth)(?:\/|$)/.test(u.pathname))return null;
  return u.href;
 }catch{return null;}
}
export type ConnectionService=ReturnType<typeof createConnectionService>;
