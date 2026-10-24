import {test,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createNativeConnectionRunner,parseAuthMetadata} from '../../src/backend/연결네이티브.js';
import {officialLoginUrl} from '../../src/backend/연결.js';
test('exit0/help는 인증 증거가 아니고 실제 메타데이터 형태만 허용한다',()=>{
 expect(parseAuthMetadata('agy','Usage: agy models',0).connected).toBe(false);
 expect(parseAuthMetadata('agy','gemini-4-argon-medium\tGemini 4 Argon (Medium)\n',0).connected).toBe(true);
 expect(parseAuthMetadata('agy','gemini-4-argon-medium\tGemini 4 Argon (Medium)\n',1).connected).toBe(false);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}),0).connected).toBe(true);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'api_key'}),0).connected).toBe(false);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:false}),1).errorCode).toBe('LOGIN_REQUIRED');
});
test('공식 HTTPS 로그인 주소만 노출한다',()=>{
 for(const url of ['http://claude.ai/oauth/authorize','https://claude.ai.evil.com/oauth/authorize','https://user@claude.ai/oauth/authorize','https://console.anthropic.com/oauth/authorize','https://platform.claude.com/oauth/authorize','https://claude.ai:444/oauth/authorize','https://evil.com/'])expect(officialLoginUrl('claude',url)).toBeNull();
 expect(officialLoginUrl('agy','https://accounts.google.com/o/oauth2/v2/auth?state=test')).not.toBeNull();
});
function fakeSpawn(){
 const children:ChildProcessWithoutNullStreams[]=[];
 const spawn=vi.fn((_command:string,_args:string[],_options:unknown)=>{const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>true)}) as unknown as ChildProcessWithoutNullStreams;children.push(c);return c;});
 return {spawn,children,async flush(){await Promise.resolve();await Promise.resolve();},close(i:number,text:string,exit=0){(children[i]!.stdout as PassThrough).end(text);children[i]!.emit('close',exit);}};
}
test('생산 runner는 고정 공식 명령 실행 후 로그인 종료와 별도로 auth status를 확인한다',async()=>{
 const f=fakeSpawn(),events:unknown[]=[];
 const r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn});
 const t=r.start('claude','login',e=>events.push(e));
 expect(f.spawn.mock.calls[0]).toEqual(expect.arrayContaining(['C:\\app\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe']));
 f.close(0,'2.1.309 (Claude Code)');await f.flush();
 expect(f.spawn.mock.calls[1]![1]).toEqual(['auth','login','--claudeai']);
 (f.children[1]!.stderr as PassThrough).write('https://claude.ai/oauth/authorize?state=test\nPaste the authorization code:');
 expect(events).toContainEqual(expect.objectContaining({needsCode:true}));
 t.code('fake-test-code');expect((f.children[1]!.stdin as PassThrough).read().toString()).toBe('fake-test-code\n');
 f.children[1]!.stderr.emit('data','Waiting for callback');
 expect(()=>t.code('second-test-code')).toThrow('CODE_NOT_REQUESTED');
 f.close(1,'Success');await f.flush();
 expect(f.spawn.mock.calls[2]![1]).toEqual(['auth','status']);
 f.close(2,JSON.stringify({loggedIn:false}),1);
 expect((await t.done).connected).toBe(false);
});
test('취소 kill 오류도 유한 종료 미확인으로 반환한다',async()=>{
 vi.useFakeTimers();try{const f=fakeSpawn();const r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn});
 const t=r.start('agy','check',()=>{});vi.mocked(f.children[0]!.kill).mockImplementation(()=>{throw new Error('test-only kill denial');});
 expect(()=>t.cancel()).not.toThrow();await vi.advanceTimersByTimeAsync(3001);expect((await t.done).errorCode).toBe('NATIVE_CLEANUP_UNCONFIRMED');
 }finally{vi.useRealTimers();}
});
test('agy는 존재하지 않는 auth 명령 대신 models를 호출하고 자기 자식만 취소한다',async()=>{
 const f=fakeSpawn(),r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn});
 const t=r.start('agy','login',()=>{});f.close(0,'agy 1.4.7');await f.flush();
 expect(f.spawn.mock.calls[1]![0]).toBe('C:/Users/YH/AppData/Local/agy/bin/agy.EXE');
 expect(f.spawn.mock.calls[1]![1]).toEqual(['models']);t.cancel();
 expect(f.children[1]!.kill).toHaveBeenCalledTimes(1);f.close(1,'');expect((await t.done).connected).toBe(false);
});
