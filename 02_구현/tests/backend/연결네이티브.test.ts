import {test,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createNativeConnectionRunner,parseAuthMetadata} from '../../src/backend/연결네이티브.js';
import {officialLoginUrl} from '../../src/backend/연결.js';
vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),spawn:vi.fn(()=>{throw Error('UNEXPECTED_NATIVE_SPAWN');})}));
test('live 금지 환경은 기본 CLI를 실행하기 전에 차단한다',async()=>{
 const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work'}).start('claude','check',()=>{});
 expect((await t.done).errorCode).toBe('LIVE_CALLS_FORBIDDEN');
});
test('exit0/help는 인증 증거가 아니고 실제 메타데이터 형태만 허용한다',()=>{
 expect(parseAuthMetadata('agy','Usage: agy models',0).connected).toBe(false);
 expect(parseAuthMetadata('agy','gemini-4-argon-medium\tGemini 4 Argon (Medium)\n',0).connected).toBe(false);
 expect(parseAuthMetadata('agy','gemini-4-argon-medium\tGemini 4 Argon (Medium)\n',1).connected).toBe(false);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}),0).connected).toBe(false);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',email:'current@example.test'}),0)).toEqual({connected:true,version:null,accountId:'current@example.test'});
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:true,authMethod:'api_key'}),0).connected).toBe(false);
 expect(parseAuthMetadata('claude',JSON.stringify({loggedIn:false}),1).errorCode).toBe('LOGIN_REQUIRED');
});
test('공식 HTTPS 로그인 주소만 노출한다',()=>{
 for(const url of ['http://claude.ai/oauth/authorize','https://claude.ai.evil.com/oauth/authorize','https://user@claude.ai/oauth/authorize','https://console.anthropic.com/oauth/authorize','https://platform.claude.com/oauth/authorize','https://claude.ai:444/oauth/authorize','https://evil.com/'])expect(officialLoginUrl('claude',url)).toBeNull();
 expect(officialLoginUrl('agy','https://accounts.google.com/o/oauth2/v2/auth?state=test')).not.toBeNull();
});
test('Claude 로그아웃은 현재 ID 재확인 뒤 공식 logout 및 미로그인 후속검사를 모두 요구한다',async()=>{
 const f=fakeSpawn(),r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn});
 const t=r.start('claude','logout',()=>{},{expectedAccountId:'current@example.test'});
 f.close(0,'2.1.309');await f.flush();
 expect(f.spawn.mock.calls[1]![1]).toEqual(['auth','status']);
 f.close(1,JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',email:'current@example.test'}));await f.flush();
 expect(f.spawn.mock.calls[2]![1]).toEqual(['auth','logout']);
 f.close(2,'done');await f.flush();expect(f.spawn.mock.calls[3]![1]).toEqual(['auth','status']);
 f.close(3,JSON.stringify({loggedIn:false}),1);
 expect(await t.done).toEqual({connected:false,version:'2.1.309',accountId:null,loggedOut:true,errorCode:'LOGIN_REQUIRED'});
});
test('agy 로그인은 확인 POST 없이 준비된 계정을 자동 인증하고 소유 콘솔을 닫는다',async()=>{
 const f=fakeSpawn(),events:unknown[]=[];
 const consoleHandle={env:{HOME:'C:/owned',USERPROFILE:'C:/owned'},read:vi.fn(async()=>({accountId:'current@example.test',ready:true,timestamp:Date.now()})),logout:vi.fn(),close:vi.fn(async()=>{})};
 const open=vi.fn(async()=>consoleHandle);
 const r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:open});
 const t=r.start('agy','login',e=>events.push(e));f.close(0,'agy 1.4.7');await f.flush();await f.flush();
 expect(open).toHaveBeenCalledTimes(1);expect(events).toContainEqual({externalConsole:true,autoConfirm:true});
 await f.flush();await f.flush();
 expect(f.spawn.mock.calls[1]![1]).toEqual(['--print','/usage','--output-format','json']);
 expect(f.spawn.mock.calls[1]![2]).toEqual(expect.objectContaining({env:consoleHandle.env}));
 f.close(1,JSON.stringify({command:{name:'usage',data:{groups:[{buckets:[]}]}}}));
 expect(await t.done).toEqual({connected:true,version:'1.4.7',accountId:'current@example.test'});expect(consoleHandle.close).toHaveBeenCalledOnce();
});
test('agy 실제 로그아웃은 소유 TUI 고정 명령 후 공식 미로그인 메타데이터로 검증한다',async()=>{
 const f=fakeSpawn(),h={env:{HOME:'C:/owned'},read:vi.fn(async()=>({accountId:'current@example.test',ready:true,timestamp:Date.now()})),logout:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h});
 const t=r.start('agy','logout',()=>{},{expectedAccountId:'current@example.test'});
 f.close(0,'1.4.7');await f.flush();await f.flush();t.confirm!();await f.flush();await f.flush();
 f.close(1,JSON.stringify({command:{name:'usage',data:{groups:[{buckets:[]}]}}}));await f.flush();await f.flush();
 expect(h.logout).toHaveBeenCalledWith('current@example.test');
 expect(f.spawn.mock.calls[2]![1]).toEqual(['--print','/usage','--output-format','json']);
 f.close(2,JSON.stringify({status:'ERROR',error:'authentication required',num_turns:0,usage:{input_tokens:0,output_tokens:0,total_tokens:0}}),1);
 expect(await t.done).toEqual({connected:false,version:'1.4.7',accountId:null,loggedOut:true,errorCode:'LOGIN_REQUIRED'});
});
test('비대화형 메타데이터 프로세스 stdin은 종료해 인증 대기를 막는다',async()=>{
 const f=fakeSpawn(),t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn}).start('claude','check',()=>{});
 expect(f.children[0]!.stdin.writableEnded).toBe(true);
 f.close(0,'2.1.309');await f.flush();expect(f.children[1]!.stdin.writableEnded).toBe(true);
 f.close(1,JSON.stringify({loggedIn:false}),1);await t.done;
});
test('별도 콘솔 확인 대기는 시간초과 때 소유 콘솔을 정리하고 원인을 구별한다',async()=>{
 vi.useFakeTimers();try{
  const f=fakeSpawn(),h={env:{},read:vi.fn(),logout:vi.fn(),close:vi.fn(async()=>{})};
  const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h,commandTimeoutMs:100}).start('agy','check',()=>{});
  f.close(0,'1.4.7');await f.flush();await f.flush();await vi.advanceTimersByTimeAsync(101);
  expect((await t.done).errorCode).toBe('NATIVE_TIMEOUT');expect(h.close).toHaveBeenCalledOnce();expect(h.read).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
test.each([undefined,'other@example.test','Current@example.test'])('Claude 현재 ID 불일치(%s)는 공식 logout을 호출하지 않는다',async expectedAccountId=>{
 const f=fakeSpawn(),t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn}).start('claude','logout',()=>{},{expectedAccountId});
 f.close(0,'2.1.309');await f.flush();f.close(1,JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',email:'current@example.test'}));
 expect((await t.done).errorCode).toBe('ACCOUNT_MISMATCH');expect(f.spawn).toHaveBeenCalledTimes(2);
});
test.each([null,{accountId:null,ready:true,timestamp:0},{accountId:'current@example.test',ready:false,timestamp:0}])('agy 준비 전 값(%j)은 확인을 눌러도 준비까지 기다린다',async observation=>{
 vi.useFakeTimers();try{
 const f=fakeSpawn(),h={env:{},read:vi.fn(async()=>observation),logout:vi.fn(),close:vi.fn(async()=>{})};
 const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h,commandTimeoutMs:1000}).start('agy','login',()=>{});
 f.close(0,'1.4.7');await f.flush();await f.flush();t.confirm!();await vi.advanceTimersByTimeAsync(1001);
 expect(await t.done).toMatchObject({connected:false,errorCode:'NATIVE_TIMEOUT'});expect(f.spawn).toHaveBeenCalledTimes(1);expect(h.logout).not.toHaveBeenCalled();expect(h.close).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
test('별도 콘솔 대기 취소는 소유 콘솔만 닫고 웹 코드를 받지 않는다',async()=>{
 const f=fakeSpawn(),h={env:{},read:vi.fn(),logout:vi.fn(),close:vi.fn(async()=>{})};
 const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h}).start('agy','login',()=>{});
 f.close(0,'1.4.7');await f.flush();await f.flush();expect(()=>t.code('not-requested')).toThrow('CODE_NOT_REQUESTED');t.cancel();
 expect((await t.done).errorCode).toBe('CANCELED');expect(h.close).toHaveBeenCalledOnce();expect(h.read).toHaveBeenCalledOnce();
});
test.each(['network failed',JSON.stringify({status:'ERROR',error:'quota exceeded',num_turns:0,usage:{input_tokens:0,output_tokens:0,total_tokens:0}}),JSON.stringify({status:'SUCCESS',response:'authentication required',usage:{total_tokens:10}})])('agy 로그아웃 뒤 일반 오류·모델 문장(%s)은 성공으로 올리지 않는다',async response=>{
 const f=fakeSpawn(),h={env:{},read:vi.fn(async()=>({accountId:'current@example.test',ready:true,timestamp:Date.now()})),logout:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h}).start('agy','logout',()=>{},{expectedAccountId:'current@example.test'});
 f.close(0,'1.4.7');await f.flush();await f.flush();t.confirm!();await f.flush();await f.flush();f.close(1,JSON.stringify({command:{name:'usage',data:{groups:[{buckets:[]}]}}}));await f.flush();await f.flush();f.close(2,response,1);
 const result=await t.done;expect(result.errorCode).toBe('LOGOUT_UNCONFIRMED');expect(result.loggedOut).not.toBe(true);
});
test('공식 logout 직전 계정 변경은 별도 불일치 오류이며 후속 성공으로 바꾸지 않는다',async()=>{
 const f=fakeSpawn(),h={env:{},read:vi.fn(async()=>({accountId:'current@example.test',ready:true,timestamp:Date.now()})),logout:vi.fn(async()=>{throw Error('ACCOUNT_MISMATCH');}),close:vi.fn(async()=>{})};
 const t=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:async()=>h}).start('agy','logout',()=>{},{expectedAccountId:'current@example.test'});
 f.close(0,'1.4.7');await f.flush();await f.flush();t.confirm!();await f.flush();await f.flush();f.close(1,JSON.stringify({command:{name:'usage',data:{groups:[{buckets:[]}]}}}));
 expect((await t.done).errorCode).toBe('ACCOUNT_MISMATCH');expect(f.spawn).toHaveBeenCalledTimes(2);
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
test('agy 버전 종료 직후 취소는 새 콘솔을 열지 않는다',async()=>{
 const f=fakeSpawn(),open=vi.fn();
 const r=createNativeConnectionRunner({appRoot:'C:/app',cwd:'C:/work',spawnProcess:f.spawn,openAccountConsole:open});
 const t=r.start('agy','login',()=>{});f.close(0,'agy 1.4.7');t.cancel();await f.flush();
 expect(open).not.toHaveBeenCalled();expect((await t.done).errorCode).toBe('CANCELED');
});
