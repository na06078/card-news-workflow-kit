import {test,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createNativeConnectionRunner,parseAuthMetadata} from '../../src/backend/연결네이티브.js';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
test('계정 ID 표시를 추가해도 기존 Claude 구독 인증 조건을 완화하지 않는다',()=>{
 for(const subscriptionType of ['free','unknown',undefined]){
  expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'fixture@example.test',subscriptionType}),0).connected).toBe(false);
 }
});
test('별도 콘솔 종료 미확인은 중복 실행 방지 오류로 전파한다',async()=>{
 const children:ChildProcessWithoutNullStreams[]=[];
 const spawn=vi.fn(()=>{const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()}) as unknown as ChildProcessWithoutNullStreams;children.push(child);return child;});
 const handle={env:{},read:vi.fn(),logout:vi.fn(),close:vi.fn(async()=>{throw Error('native cleanup failed');})};
 const task=createNativeConnectionRunner({appRoot:'C:/fixture',cwd:'C:/fixture',spawnProcess:spawn,openAccountConsole:async()=>handle}).start('agy','check',()=>{});
 children[0]!.stdout.emit('data','1.4.7');children[0]!.emit('close',0);
 for(let i=0;i<8;i++)await Promise.resolve();
 task.cancel();
 expect((await task.done).errorCode).toBe('NATIVE_CLEANUP_UNCONFIRMED');
});
