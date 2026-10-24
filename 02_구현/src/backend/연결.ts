import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {ConnectionProviderSchema,ConnectionRequestSchema,ConnectionCancelRequestSchema,ConnectionCodeRequestSchema,type ConnectionProvider,type ConnectionState} from '../shared/연결계약.js';
import {DomainError} from './도메인.js';
export type NativeResult={connected:boolean;version:string|null;errorCode?:string};
export type NativeEvent={loginUrl?:string;needsCode?:boolean};
export type ConnectionTask={done:Promise<NativeResult>;cancel():void;code(value:string):void};
export type ConnectionRunner={start(provider:ConnectionProvider,action:'check'|'login',emit:(event:NativeEvent)=>void):ConnectionTask};
export function createConnectionService(options:{runner:ConnectionRunner;hasActiveRuns:()=>boolean;timeoutMs?:number}){
 const states:ConnectionState[]=(['claude','agy'] as const).map(provider=>({provider,status:'unknown',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'아직 연결을 확인하지 않았습니다.',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'not_checked'}));
 type Pending={id:string;task:ConnectionTask|null;timer:ReturnType<typeof setTimeout>|null;ended:boolean;cleanupUnconfirmed?:boolean};
 const pending=new Map<ConnectionProvider,Pending>(),receipts=new Map<string,{fingerprint:string;state:ConnectionState}>(),secret=randomBytes(32);
 const now=()=>new Date().toISOString();let disposed=false;
 const state=(p:ConnectionProvider)=>states.find(s=>s.provider===p)!;
 function mutate(p:ConnectionProvider,action:string,input:{requestId:string;operationId?:string;authorizationCode?:string},fn:()=>void){
  ConnectionProviderSchema.parse(p);
  // Retain only a keyed digest, never authorization code or raw process output.
  const fingerprint=createHmac('sha256',secret).update(JSON.stringify([action,input.operationId??null,input.authorizationCode??null])).digest('hex');
  const key=p+':'+input.requestId,old=receipts.get(key);
  if(old){if(old.fingerprint!==fingerprint)throw new DomainError('REQUEST_ID_CONFLICT');return {state:structuredClone(old.state),replayed:true};}
  if(disposed)throw new DomainError('STAGE_CONFLICT');
  if(receipts.size>=10000)throw new DomainError('STORAGE_BUSY');
  fn();const snapshot=structuredClone(state(p));receipts.set(key,{fingerprint,state:snapshot});return {state:structuredClone(snapshot),replayed:false};
 }
 function end(p:ConnectionProvider,op:Pending,status:ConnectionState['status'],code:string|null,message:string){
  if(pending.get(p)!==op||op.ended)return;op.ended=true;if(op.timer)clearTimeout(op.timer);
  Object.assign(state(p),{status,errorCode:code,message,loginUrl:null,needsCode:false,lastActivityAt:now()});
 }
 return {
  list:()=>({connections:structuredClone(states)}),busy:()=>pending.size>0,
  start(p:ConnectionProvider,action:'check'|'login',input:{requestId:string}){
   ConnectionRequestSchema.parse(input);
   return mutate(p,action,input,()=>{
    if(pending.has(p))return;
    if(options.hasActiveRuns())throw new DomainError('RUN_ACTIVE',null,null,'제작 작업을 마치거나 취소한 뒤 연결해 주세요.');
    const op:Pending={id:randomUUID(),task:null,timer:null,ended:false};pending.set(p,op);
    Object.assign(state(p),{status:action==='login'?'login_pending':'checking',operationId:op.id,errorCode:null,authMethod:'unknown',verification:'not_checked',loginUrl:null,needsCode:false,lastActivityAt:now(),message:p==='agy'?'공식 모델 목록을 확인합니다. 미로그인 시 공식 브라우저 로그인이 열릴 수 있습니다.':'공식 Claude 계정 연결을 확인합니다.'});
    try{
     op.task=options.runner.start(p,action,event=>{
      if(pending.get(p)!==op||op.ended)return;
      const url=event.loginUrl?officialLoginUrl(p,event.loginUrl):null;
      Object.assign(state(p),{lastActivityAt:now(),...(url?{loginUrl:url,status:'login_pending',message:'공식 브라우저에서 로그인을 완료해 주세요.'}:{}),...(event.needsCode?{needsCode:true,status:'login_pending',message:'공식 로그인 화면에서 발급한 인증 코드가 필요합니다.'}:{})});
     });
     op.timer=setTimeout(()=>{end(p,op,'error','CONNECTION_TIMEOUT','연결 확인 시간이 초과되었습니다. 공식 로그인 상태를 확인한 뒤 다시 시도해 주세요.');op.task?.cancel();},options.timeoutMs??180000);op.timer.unref?.();
     void op.task.done.then(result=>{
      if(pending.get(p)!==op)return;
      if(result.errorCode==='NATIVE_CLEANUP_UNCONFIRMED'){op.cleanupUnconfirmed=true;op.ended=true;Object.assign(state(p),{status:'error',errorCode:result.errorCode,loginUrl:null,needsCode:false,lastActivityAt:now(),message:'연결 자식 프로세스의 종료를 확인하지 못했습니다. 중복 실행을 막았습니다. 앱을 종료하고 해당 프로세스를 확인해 주세요.'});return;}
      if(op.ended)return;
      Object.assign(state(p),{version:result.version,checkedAt:now(),authMethod:result.connected?(p==='claude'?'subscription':'google_account'):'unknown',verification:result.connected?'metadata':'not_checked'});
      end(p,op,result.connected?'connected':result.errorCode==='LOGIN_REQUIRED'?'login_required':'error',result.connected?null:result.errorCode??'AUTH_MODE_UNKNOWN',result.connected?'계정 연결 메타데이터를 확인했습니다. 검색·이미지 생성 성공이나 잔여 한도를 뜻하지 않습니다.':'계정 연결을 확인하지 못했습니다. 공식 로그인 상태를 확인해 주세요.');
     },()=>end(p,op,'error','NATIVE_PROCESS_FAILED','공식 연결 프로세스를 실행하지 못했습니다.')).finally(()=>{if(op.timer)clearTimeout(op.timer);if(pending.get(p)===op&&!op.cleanupUnconfirmed)pending.delete(p);});
    }catch{end(p,op,'error','NATIVE_PROCESS_FAILED','공식 연결 프로세스를 실행하지 못했습니다.');pending.delete(p);}
   });
  },
  cancel(p:ConnectionProvider,input:{requestId:string;operationId:string}){
   ConnectionCancelRequestSchema.parse(input);return mutate(p,'cancel',input,()=>{
    const op=pending.get(p);if(!op||op.id!==input.operationId)throw new DomainError('STAGE_CONFLICT');
    end(p,op,'unknown','CANCELED','이 앱의 연결 작업을 취소했습니다. 기존 로그인은 삭제하지 않습니다.');op.task?.cancel();
   });
  },
  code(p:ConnectionProvider,input:{requestId:string;operationId:string;authorizationCode:string}){
   ConnectionCodeRequestSchema.parse(input);return mutate(p,'code',input,()=>{
    const op=pending.get(p);if(!op||op.ended||op.id!==input.operationId||!state(p).needsCode)throw new DomainError('STAGE_CONFLICT');
    op.task!.code(input.authorizationCode);Object.assign(state(p),{needsCode:false,lastActivityAt:now(),message:'공식 로그인 프로세스에 코드를 전달했습니다. 연결 확인을 기다립니다.'});
   });
  },
  async dispose(){disposed=true;for(const [p,op]of pending){end(p,op,'unknown','CANCELED','서버의 연결 작업을 종료했습니다.');op.task?.cancel();}await Promise.allSettled([...pending.values()].map(op=>op.task?.done));}
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
