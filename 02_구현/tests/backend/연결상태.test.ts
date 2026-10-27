import {test,expect,vi} from 'vitest';
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw Error('UNMOCKED_NATIVE');})}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:vi.fn(()=>{throw Error('UNMOCKED_SDK');})}));
import {randomUUID} from 'node:crypto';
import type {NativeResult,NativeEvent} from '../../src/backend/연결.js';
import {createConnectionService} from '../../src/backend/연결.js';
import {ConnectionListSchema} from '../../src/shared/연결계약.js';
function setup(active=false){
 let finish!:(r:NativeResult)=>void,emit!:(e:NativeEvent)=>void;
 const task={done:new Promise<NativeResult>(r=>finish=r),cancel:vi.fn(),code:vi.fn()};
 const start=vi.fn((_p:unknown,_a:unknown,e:(e:NativeEvent)=>void)=>{emit=e;return task;});
 const service=createConnectionService({runner:{start},hasActiveRuns:()=>active,timeoutMs:100});
 return {service,start,task,finish,event:(e:NativeEvent)=>emit(e)};
}
test('비동기 접수·동일 ID 재생·동시 중복 방지·완료 메타데이터',async()=>{
 const x=setup(),id=randomUUID();const a=x.service.start('claude','check',{requestId:id});
 expect(a.state.status).toBe('checking');expect(x.start).toHaveBeenCalledTimes(1);
 expect(x.service.start('claude','check',{requestId:id})).toEqual({...a,replayed:true});
 expect(x.service.start('claude','login',{requestId:randomUUID()}).state.operationId).toBe(a.state.operationId);
 expect(x.start).toHaveBeenCalledTimes(1);
 expect(()=>x.service.start('claude','login',{requestId:id})).toThrow('REQUEST_ID_CONFLICT');
 x.finish({connected:true,version:'2.1.309'});await Promise.resolve();
 expect(x.service.list().connections[0]).toMatchObject({status:'connected',verification:'metadata',authMethod:'subscription',loginUrl:null,needsCode:false});
 expect(x.service.start('claude','check',{requestId:id}).state).toEqual(a.state);
});
test('작업 중 연결 차단·취소 후 늦은 callback 무시·원문 비보관',async()=>{
 expect(()=>setup(true).service.start('agy','login',{requestId:randomUUID()})).toThrow('RUN_ACTIVE');
 const x=setup(),a=x.service.start('claude','login',{requestId:randomUUID()});
 x.event({loginUrl:'https://claude.ai/oauth/authorize?state=test',needsCode:true});
 x.service.code('claude',{requestId:randomUUID(),operationId:a.state.operationId!,authorizationCode:'test-only-code'});
 expect(x.task.code).toHaveBeenCalledWith('test-only-code');
 x.service.cancel('claude',{requestId:randomUUID(),operationId:a.state.operationId!});expect(x.task.cancel).toHaveBeenCalledTimes(1);
 x.event({needsCode:true});x.finish({connected:true,version:'2'});await Promise.resolve();
 expect(x.service.list().connections[0]).toMatchObject({status:'unknown',errorCode:'CANCELED',needsCode:false,loginUrl:null});
 expect(JSON.stringify(x.service.list())).not.toContain('test-only-code');
});
test('시간 초과는 자기 작업을 취소하고 실패를 성공으로 덮지 않는다',async()=>{
 vi.useFakeTimers();try{const x=setup();x.service.start('agy','check',{requestId:randomUUID()});
 await vi.advanceTimersByTimeAsync(101);expect(x.task.cancel).toHaveBeenCalledOnce();expect(x.service.list().connections[1]).toMatchObject({status:'error',errorCode:'CONNECTION_TIMEOUT'});
 x.finish({connected:true,version:'1.4.7'});await Promise.resolve();expect(x.service.list().connections[1]!.status).toBe('error');
 }finally{vi.useRealTimers();}
});
test('요청하지 않은 코드·다른 작업 취소·변조된 요청 ID는 거절한다',()=>{
 const x=setup(),a=x.service.start('agy','check',{requestId:randomUUID()});
 expect(()=>x.service.code('agy',{requestId:randomUUID(),operationId:a.state.operationId!,authorizationCode:'test-code'})).toThrow('STAGE_CONFLICT');
 expect(()=>x.service.cancel('agy',{requestId:randomUUID(),operationId:randomUUID()})).toThrow('STAGE_CONFLICT');
 expect(()=>x.service.start('agy','check',{requestId:'not-a-uuid'})).toThrow();
 x.service.cancel('agy',{requestId:randomUUID(),operationId:a.state.operationId!});x.finish({connected:false,version:null});
});
test('자식 종료 미확인은 새 네이티브 중복 실행을 허용하지 않는다',async()=>{
 const x=setup(),a=x.service.start('claude','login',{requestId:randomUUID()});
 x.service.cancel('claude',{requestId:randomUUID(),operationId:a.state.operationId!});
 x.finish({connected:false,version:null,errorCode:'NATIVE_CLEANUP_UNCONFIRMED'});await Promise.resolve();await Promise.resolve();
 expect(x.service.list().connections[0]).toMatchObject({status:'error',errorCode:'NATIVE_CLEANUP_UNCONFIRMED'});
 x.service.start('claude','login',{requestId:randomUUID()});expect(x.start).toHaveBeenCalledTimes(1);
});
test('조회는 네이티브 실행 없이 미확인 상태만 반환한다',()=>{
 const start=vi.fn();const service=createConnectionService({runner:{start},hasActiveRuns:()=>false});
 expect(ConnectionListSchema.parse(service.list()).connections.map(s=>s.status)).toEqual(['unknown','unknown']);
 expect(start).not.toHaveBeenCalled();
});
