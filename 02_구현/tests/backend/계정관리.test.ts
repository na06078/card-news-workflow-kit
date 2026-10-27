import {test,expect,vi} from 'vitest';
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw Error('UNMOCKED_NATIVE');})}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:vi.fn(()=>{throw Error('UNMOCKED_SDK');})}));
import {randomUUID} from 'node:crypto';
import type {NativeResult,NativeEvent} from '../../src/backend/연결.js';
import {ConnectionStateSchema} from '../../src/shared/연결계약.js';
import {createConnectionService} from '../../src/backend/연결.js';
const flush=()=>new Promise(r=>setTimeout(r,0));
function setup(){
 let active=false;
 const tasks:Array<{finish:(r:NativeResult)=>void;emit:(e:NativeEvent)=>void;cancel:ReturnType<typeof vi.fn>;confirm:ReturnType<typeof vi.fn>}> = [];
 const start=vi.fn((_p:unknown,_a:unknown,emit:(e:NativeEvent)=>void,_context?:{expectedAccountId?:string})=>{
  let finish!:(r:NativeResult)=>void;const done=new Promise<NativeResult>(r=>finish=r);
  const task={done,finish,emit,cancel:vi.fn(),code:vi.fn(),confirm:vi.fn()};tasks.push(task);return task;
 });
 const onAuthChanged=vi.fn();
 const service=createConnectionService({runner:{start},hasActiveRuns:()=>active,onAuthChanged});
 return {service,start,tasks,onAuthChanged,setActive:(v:boolean)=>{active=v;}};
}
const state={provider:'agy',status:'connected',version:'1.4.7',authMethod:'google_account',checkedAt:null,lastActivityAt:null,message:'확인',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'metadata'};
test('현재 native 계정과 별도 콘솔 표시를 계약에서 보존한다',()=>{
 const result=ConnectionStateSchema.safeParse({...state,accountId:'account@example.test',externalConsole:false});
 expect(result.success).toBe(true);
});
test('공식 로그아웃은 별도 명시 확인 진입점을 제공한다',()=>{
 const service=createConnectionService({runner:{start(){throw Error('NOT_EXPECTED');}},hasActiveRuns:()=>false});
 expect(typeof (service as unknown as {logout?:unknown}).logout).toBe('function');
});
test('현재 표시 계정과 명시 확인만 로그아웃하며 공식 확인 결과로만 성공한다',async()=>{
 const x=setup(),id=randomUUID();
 expect(()=>x.service.logout('agy',{requestId:id,confirm:true,expectedAccountId:'account@example.test'})).toThrow('STAGE_CONFLICT');
 x.service.start('agy','check',{requestId:randomUUID()});x.tasks[0].finish({connected:true,version:'1',accountId:'account@example.test'});await flush();
 expect(x.service.list().connections[1].accountId).toBe('account@example.test');
 expect(()=>x.service.logout('agy',{requestId:randomUUID(),confirm:false as true,expectedAccountId:'account@example.test'})).toThrow();
 expect(()=>x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'other@example.test'})).toThrow('STAGE_CONFLICT');
 x.setActive(true);expect(()=>x.service.logout('agy',{requestId:id,confirm:true,expectedAccountId:'account@example.test'})).toThrow('RUN_ACTIVE');x.setActive(false);
 const input={requestId:id,confirm:true as const,expectedAccountId:'account@example.test'};
 const out=x.service.logout('agy',input);expect(out.state.status).toBe('logout_pending');
 expect(x.start).toHaveBeenLastCalledWith('agy','logout',expect.any(Function),{expectedAccountId:'account@example.test'});
 expect(x.service.logout('agy',input)).toEqual({...out,replayed:true});
 x.service.logout('agy',{...input,requestId:randomUUID()});expect(x.start).toHaveBeenCalledTimes(2);
 expect(()=>x.service.logout('agy',{...input,expectedAccountId:'other@example.test'})).toThrow('REQUEST_ID_CONFLICT');
 x.tasks[1].finish({connected:false,version:'1',loggedOut:true});await flush();
 expect(x.service.list().connections[1]).toMatchObject({status:'login_required',accountId:null,errorCode:null});
});

test('인증 변경만 캐시를 비우고 실패한 확인은 오래된 계정을 지운다',async()=>{
 const x=setup();x.service.list();expect(x.onAuthChanged).not.toHaveBeenCalled();
 x.service.start('claude','check',{requestId:randomUUID()});x.tasks[0].finish({connected:true,version:'2',accountId:'first@example.test'});await flush();
 expect(x.onAuthChanged).toHaveBeenCalledTimes(1);
 x.service.start('claude','check',{requestId:randomUUID()});x.tasks[1].finish({connected:true,version:'2',accountId:'first@example.test'});await flush();
 expect(x.onAuthChanged).toHaveBeenCalledTimes(1);
 x.service.start('claude','login',{requestId:randomUUID()});expect(x.onAuthChanged).toHaveBeenCalledTimes(2);
 x.tasks[2].finish({connected:true,version:'2',accountId:'second@example.test'});await flush();expect(x.onAuthChanged).toHaveBeenCalledTimes(3);
 x.service.start('claude','check',{requestId:randomUUID()});x.tasks[3].finish({connected:false,version:'2',errorCode:'LOGIN_REQUIRED'});await flush();
 expect(x.service.list().connections[0]).toMatchObject({status:'login_required',accountId:null});expect(x.onAuthChanged).toHaveBeenCalledTimes(4);
 x.service.start('claude','check',{requestId:randomUUID()});x.tasks[4].finish({connected:true,version:'2',accountId:'not-an-email'});await flush();
 expect(x.service.list().connections[0]).toMatchObject({status:'connected',accountId:null});
});
test('로그아웃 프로세스 종료만으로 로그아웃 성공을 만들지 않는다',async()=>{
 const x=setup();x.service.start('agy','check',{requestId:randomUUID()});x.tasks[0].finish({connected:true,version:'1',accountId:'account@example.test'});await flush();
 x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'});expect(x.onAuthChanged).toHaveBeenCalledTimes(2);
 x.tasks[1].finish({connected:false,version:'1'});await flush();
 expect(x.service.list().connections[1]).toMatchObject({status:'error',accountId:null,errorCode:'AUTH_MODE_UNKNOWN'});
});

test('별도 콘솔 로그인 확인은 같은 작업의 confirm만 호출하고 재생은 반복하지 않는다',async()=>{
 const x=setup(),login=x.service.start('agy','login',{requestId:randomUUID()});
 x.tasks[0].emit({externalConsole:true});
 expect(x.service.list().connections[1]).toMatchObject({status:'login_pending',externalConsole:true});
 const input={requestId:randomUUID()},out=x.service.start('agy','check',input);
 expect(out.state.operationId).toBe(login.state.operationId);expect(x.tasks[0].confirm).toHaveBeenCalledOnce();expect(x.start).toHaveBeenCalledTimes(1);
 x.service.start('agy','check',input);expect(x.tasks[0].confirm).toHaveBeenCalledOnce();
 x.service.cancel('agy',{requestId:randomUUID(),operationId:login.state.operationId!});
 x.service.start('agy','check',{requestId:randomUUID()});expect(x.tasks[0].confirm).toHaveBeenCalledOnce();
 x.tasks[0].emit({externalConsole:true});x.tasks[0].finish({connected:true,version:'1',accountId:'late@example.test'});await flush();
 expect(x.service.list().connections[1]).toMatchObject({status:'unknown',accountId:null,externalConsole:false});
});
test('종료 미확인 오류는 이전 계정도 제거하고 후속 로그아웃을 막는다',async()=>{
 const x=setup();x.service.start('agy','check',{requestId:randomUUID()});x.tasks[0].finish({connected:true,version:'1',accountId:'account@example.test'});await flush();
 x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'});
 x.tasks[1].finish({connected:false,version:'1',errorCode:'NATIVE_CLEANUP_UNCONFIRMED'});await flush();
 expect(x.service.list().connections[1]).toMatchObject({status:'error',accountId:null,externalConsole:false});
 x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'});expect(x.start).toHaveBeenCalledTimes(2);expect(x.service.busy()).toBe(true);
});

test('메타데이터 확인 안내는 모델 목록을 계정 증거라 하지 않고 로그아웃 완료를 구분한다',async()=>{
 const x=setup();
 expect(x.service.start('agy','check',{requestId:randomUUID()}).state.message).not.toContain('모델 목록');
 x.tasks[0].finish({connected:true,version:'1',accountId:'account@example.test'});await flush();
 const out=x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'});
 expect(out.state.message).toContain('로그아웃');
 x.tasks[1].finish({connected:false,version:'1',loggedOut:true});await flush();expect(x.service.list().connections[1].message).toContain('로그아웃');
});

test('별도 콘솔의 check·logout도 기존 작업 확인만 전달하고 새 작업은 만들지 않는다',async()=>{
 const x=setup();const checking=x.service.start('agy','check',{requestId:randomUUID()});x.tasks[0].emit({externalConsole:true});
 const confirmation=x.service.start('agy','check',{requestId:randomUUID()});
 expect(x.tasks[0].confirm).toHaveBeenCalledOnce();expect(confirmation.state.operationId).toBe(checking.state.operationId);expect(x.start).toHaveBeenCalledTimes(1);
 x.tasks[0].finish({connected:true,version:'1',accountId:'account@example.test'});await flush();
 const logout=x.service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'});x.tasks[1].emit({externalConsole:true});
 const after=x.service.start('agy','check',{requestId:randomUUID()});
 expect(after.state).toMatchObject({operationId:logout.state.operationId,status:'logout_pending'});expect(x.tasks[1].confirm).toHaveBeenCalledOnce();expect(x.start).toHaveBeenCalledTimes(2);
 x.tasks[1].finish({connected:false,version:'1',loggedOut:true});await flush();
});





