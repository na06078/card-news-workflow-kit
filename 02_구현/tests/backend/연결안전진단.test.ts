import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createConnectionService,type NativeResult} from '../../src/backend/연결.js';
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw Error('UNMOCKED_NATIVE');})}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:vi.fn(()=>{throw Error('UNMOCKED_SDK');})}));
const flush=()=>new Promise(r=>setTimeout(r,0));
function setup(){let finish!:(r:NativeResult)=>void;const task={done:new Promise<NativeResult>(r=>finish=r),cancel:vi.fn(),code:vi.fn()};const start=vi.fn(()=>task);const s=createConnectionService({runner:{start},hasActiveRuns:()=>false});return {s,finish,task,start};}
it.each([
 ['ACCOUNT_MISMATCH','계정이 일치하지','다시 확인'],
 ['LOGOUT_UNCONFIRMED','로그아웃 완료','확인'],
 ['ACCOUNT_ID_UNAVAILABLE','현재 계정 ID','확인'],
 ['AUTH_METADATA_UNCONFIRMED','인증 메타데이터','확인'],
])('B18 %s는 안전한 원인·조치와 원래 작업 ID를 유지한다',async(errorCode,reason,action)=>{
 const x=setup(),out=x.s.start('agy','check',{requestId:randomUUID()});x.finish({connected:false,version:'1',errorCode,accountId:'secret@example.test'});await flush();
 const state=x.s.list().connections[1];expect(state).toMatchObject({status:'error',errorCode,operationId:out.state.operationId,accountId:null,verification:'not_checked'});
 expect(state.message).toContain(reason);expect(state.message).toContain(action);expect(JSON.stringify(x.s.list())).not.toContain('secret@example.test');await x.s.dispose();
});
it('B18 종료 미확인은 취소·dispose로 재종료하거나 잠금을 해제하지 않는다',async()=>{
 const x=setup(),out=x.s.start('agy','login',{requestId:randomUUID()});x.finish({connected:false,version:'1',errorCode:'NATIVE_CLEANUP_UNCONFIRMED'});await flush();
 x.s.cancel('agy',{requestId:randomUUID(),operationId:out.state.operationId!});
 x.s.start('agy','check',{requestId:randomUUID()});x.s.start('agy','login',{requestId:randomUUID()});await x.s.dispose();
 expect(x.s.busy()).toBe(true);expect(x.start).toHaveBeenCalledOnce();expect(x.task.cancel).not.toHaveBeenCalled();
 const state=x.s.list().connections[1];expect(state).toMatchObject({errorCode:'NATIVE_CLEANUP_UNCONFIRMED',operationId:out.state.operationId,accountId:null});expect(state.message).toContain('소유');expect(state.message).toContain('종료');
});
it('B18 알 수 없는 native 오류 코드는 원문 대신 안전한 일반 오류로 제한한다',async()=>{
 const x=setup();x.s.start('claude','check',{requestId:randomUUID()});x.finish({connected:false,version:null,errorCode:'SENSITIVE_TOKEN C:/private stdout'});await flush();
 expect(x.s.list().connections[0].errorCode).toBe('NATIVE_PROCESS_FAILED');expect(JSON.stringify(x.s.list())).not.toContain('SENSITIVE_TOKEN');await x.s.dispose();
});
