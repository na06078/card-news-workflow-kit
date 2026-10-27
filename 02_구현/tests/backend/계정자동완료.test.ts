import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createConnectionService,type NativeEvent,type NativeResult} from '../../src/backend/연결.js';
import {ConnectionStateSchema} from '../../src/shared/연결계약.js';
const state={provider:'agy',status:'checking',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'확인 중',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'not_checked',externalConsole:true};
test('자동 확인 기능을 연결 응답 계약에 보존한다',()=>{
 expect(ConnectionStateSchema.safeParse({...state,autoConfirm:true}).success).toBe(true);
});
test('자동 확인 이벤트는 웹 상태로 전달되고 완료 뒤 제거된다',async()=>{
 let event!:(e:NativeEvent)=>void,finish!:(r:NativeResult)=>void;
 const confirm=vi.fn();
 const service=createConnectionService({hasActiveRuns:()=>false,runner:{start(_provider,_action,emit){event=emit;return {done:new Promise(r=>finish=r),cancel(){},code(){},confirm};}}});
 service.start('agy','login',{requestId:randomUUID()});
 event({externalConsole:true,autoConfirm:true} as NativeEvent&{autoConfirm:boolean});
 expect(service.list().connections[1]).toMatchObject({externalConsole:true,autoConfirm:true});
 finish({connected:true,version:'fixture',accountId:'fixture@example.test'});
 await Promise.resolve();await Promise.resolve();
 expect(service.list().connections[1]).toMatchObject({status:'connected',externalConsole:false,autoConfirm:false});
 expect(confirm).not.toHaveBeenCalled();
});
test('실제 로그아웃 작업은 자동 완료 이벤트로 수동 확인을 우회하지 않는다',async()=>{
 const tasks:Array<{emit:(e:NativeEvent)=>void;finish:(r:NativeResult)=>void;confirm:ReturnType<typeof vi.fn>}>=[];
 const service=createConnectionService({hasActiveRuns:()=>false,runner:{start(_p,_a,emit){
  let finish!:(r:NativeResult)=>void;const confirm=vi.fn();
  const done=new Promise<NativeResult>(r=>finish=r);tasks.push({emit,finish,confirm});return {done,confirm,cancel(){},code(){}};
 }}});
 service.start('agy','check',{requestId:randomUUID()});tasks[0].finish({connected:true,version:'fixture',accountId:'fixture@example.test'});
 await new Promise(r=>setTimeout(r,0));
 service.logout('agy',{requestId:randomUUID(),confirm:true,expectedAccountId:'fixture@example.test'});
 tasks[1].emit({externalConsole:true,autoConfirm:true});
 expect(service.list().connections[1]).toMatchObject({status:'logout_pending',autoConfirm:false});
 expect(tasks[1].confirm).not.toHaveBeenCalled();
 service.start('agy','check',{requestId:randomUUID()});expect(tasks[1].confirm).toHaveBeenCalledOnce();
 tasks[1].finish({connected:false,version:'fixture',loggedOut:true});await Promise.resolve();
});
