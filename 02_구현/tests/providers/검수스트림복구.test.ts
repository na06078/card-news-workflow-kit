import {it,expect,vi} from 'vitest';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOfflineAgySemanticReviewer,type AgyReviewSpawn} from '../../src/providers/agy검수.js';
import type {ReviewContext,CleanupReport} from '../../src/shared/포트.js';
const selection={provider:'agy' as const,model:'gemini-3.8-flash-high'};
const cid='33333333-3333-4333-8333-333333333333';
async function setup(){
 const context:ReviewContext={projectId:randomUUID(),runId:randomUUID(),attempt:1,cwd:resolve('실행데이터/실사용검수복구/스트림',randomUUID())};
 await mkdir(context.cwd,{recursive:true});
 const cardId=randomUUID(),input={projectId:context.projectId,cards:[{cardId,title:'합성 제목',body:'비공개 합성 본문',sourceIds:[]}],claims:[],sources:[]};
 const frames=[{event:'init',conversation_id:cid,init:{cwd:context.cwd,tools:Array.from({length:60},(_,i)=>`catalog_${i}`),agent:'cardnews-review',model:selection.model}},
 {event:'step_update',conversation_id:cid,step_update:{conversation_id:cid,step_type:'message',text:'THINKING_DO_NOT_PERSIST'}},
 {event:'result',result:{conversation_id:cid,status:'SUCCESS',num_turns:1,structured_output:{verdict:'supported',reviewedCardIds:[cardId],reviewedClaimIndices:[],issues:[]}}}];
 const cleanup:CleanupReport={runId:context.runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_TRANSPORT_DOUBLE',children:[]};
 return {context,input,frames,cleanup};
}
it('완전한 terminal 응답은 native close 없이도 정리 후 발행하며 실제 프레임 진행만 알린다',async()=>{
 const s=await setup();let cleanups=0;const progress:unknown[]=[];
 const spawn:AgyReviewSpawn=(_exe,_args,options)=>{
  queueMicrotask(()=>{const text=s.frames.map(x=>JSON.stringify(x)).join('\r\n')+'\r\n';for(let i=0;i<text.length;i+=7)options.onStdout?.(text.slice(i,i+7));});
  return {result:new Promise(()=>{}),cleanup:async()=>{cleanups++;return s.cleanup;}};
 };
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'},onProgress:e=>{progress.push(e);}},spawn);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([reviewer.review(s.context,s.input),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('TERMINAL_STILL_WAITING_FOR_NATIVE_CLOSE')),250);})]);
  expect(result).toMatchObject({verdict:'supported',actualModel:selection.model});expect(cleanups).toBe(1);
  expect(progress).toEqual(expect.arrayContaining(['connected','generating','result_received'].map(phase=>expect.objectContaining({phase,actualModel:selection.model}))));
  const diagnostic=await readFile(join(s.context.cwd,'검수진단.json'),'utf8');
  expect(diagnostic).not.toContain('THINKING_DO_NOT_PERSIST');expect(diagnostic).not.toContain('비공개 합성 본문');
  expect(JSON.parse(diagnostic)).toMatchObject({frameCount:3,terminalReceived:true,nativeExitObserved:false,cleanupStatus:'confirmed'});
 }finally{clearTimeout(timer);await reviewer.dispose();}
});
it('부분 응답 deadline은 REVIEW_TIMEOUT이며 내용 없는 진단과 정리 결과를 남긴다',async()=>{
 const s=await setup();let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});let cleanups=0;
 let close!:(value:{exitCode:number|null;stdout:string;stderr:string})=>void;
 const native=new Promise<{exitCode:number|null;stdout:string;stderr:string}>(r=>{close=r;});
 const partial=JSON.stringify(s.frames[0])+'\n'+JSON.stringify(s.frames[1])+'\n'+ '{"event":"result","private":"PARTIAL_SECRET';
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  options.onStdout?.(partial);started();
  return {result:native,cleanup:async()=>{cleanups++;close({exitCode:null,stdout:partial,stderr:''});await Promise.resolve();return s.cleanup;}};
 });
 vi.useFakeTimers();
 try{
  const outcome=reviewer.review(s.context,s.input).catch(e=>e);await ready;
  await vi.advanceTimersByTimeAsync(300001);
  expect(await outcome).toMatchObject({code:'REVIEW_TIMEOUT'});expect(cleanups).toBe(1);
  const text=await readFile(join(s.context.cwd,'검수진단.json'),'utf8');
  expect(text).not.toContain('PARTIAL_SECRET');expect(text).not.toContain('THINKING_DO_NOT_PERSIST');
  expect(JSON.parse(text)).toMatchObject({frameCount:2,terminalReceived:false,partialLine:true,cleanupStatus:'confirmed',nativeExitObserved:true,exitCode:null,outcome:'REVIEW_TIMEOUT'});
 }finally{vi.useRealTimers();await reviewer.dispose();}
});
it('수신한 UTF8 바이트 분할은 한글 경계와 CRLF를 보존한다',async()=>{
 const s=await setup();s.frames[2]!.result!.structured_output={verdict:'unverifiable',reviewedCardIds:[s.input.cards[0]!.cardId],reviewedClaimIndices:[],issues:[{cardId:s.input.cards[0]!.cardId,claimIndex:null,sourceIds:[],message:'한글 경계 보존',suggestion:null}]} as any;
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{const bytes=Buffer.from(s.frames.map(e=>JSON.stringify(e)).join('\r\n')+'\r\n');for(const byte of bytes)options.onStdout?.(Buffer.from([byte]));});
  return {result:new Promise(()=>{}),cleanup:async()=>s.cleanup};
 });
 try{expect((await reviewer.review(s.context,s.input)).issues[0]?.message).toBe('한글 경계 보존');}finally{await reviewer.dispose();}
});
it('정리 중 도착한 중복 terminal은 retained 결과를 발행하지 않는다',async()=>{
 const s=await setup();const statuses:string[]=[];
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'},onProgress:e=>{statuses.push(e.status);}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(s.frames.map(e=>JSON.stringify(e)).join('\n')+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>{options.onStdout?.(JSON.stringify(s.frames[2])+'\n');return s.cleanup;}};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'PROVIDER_PROTOCOL_ERROR'});expect(statuses).not.toContain('completed');
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({frameCount:4,terminalReceived:true,protocolFailed:true});
 }finally{await reviewer.dispose();}
});
it('정리 중 terminal 뒤 불완전 UTF8 바이트도 후속 데이터로 거절한다',async()=>{
 const s=await setup();
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(s.frames.map(e=>JSON.stringify(e)).join('\n')+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>{options.onStdout?.(Buffer.from([0xed]));return s.cleanup;}};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'PROVIDER_PROTOCOL_ERROR'});}finally{await reviewer.dispose();}
});
it('finish-only 검수의 실제 금지 tool step은 카탈로그 허용과 별개로 즉시 거절한다',async()=>{
 const s=await setup();const forbidden={event:'step_update',conversation_id:cid,step_update:{conversation_id:cid,step_type:'tool',tool_name:'run_command',state:'DONE'}};let cleanups=0;
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(JSON.stringify(s.frames[0])+'\n');options.onStdout?.(JSON.stringify(forbidden)+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>{cleanups++;return s.cleanup;}};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'TOOL_PERMISSION_DENIED'});expect(cleanups).toBe(1);
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({catalogToolCount:60,steps:[{type:'tool',tool:'forbidden',status:'DONE'}],terminalReceived:false});
 }finally{await reviewer.dispose();}
});
it('검증 terminal 뒤 앱 정리 종료는 native exit0으로 위장하지 않는다',async()=>{
 const s=await setup();const stdout=s.frames.map(e=>JSON.stringify(e)).join('\n')+'\n';
 let close!:(r:{exitCode:number|null;stdout:string;stderr:string})=>void;const native=new Promise<{exitCode:number|null;stdout:string;stderr:string}>(r=>{close=r;});
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(stdout);});
  return {result:native,cleanup:async()=>{close({exitCode:1,stdout,stderr:''});await Promise.resolve();return s.cleanup;}};
 });
 try{expect((await reviewer.review(s.context,s.input)).verdict).toBe('supported');
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({nativeExitObserved:true,exitCode:1,terminalReceived:true,cleanupRequested:true,outcome:'COMPLETED'});
 }finally{await reviewer.dispose();}
});
it.each([1,null])('terminal 전 native exit %s는 성공이나 timeout으로 둔갑하지 않는다',async exitCode=>{
 const s=await setup();const stdout=JSON.stringify(s.frames[0])+'\n';
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  options.onStdout?.(stdout);return {result:Promise.resolve({exitCode,stdout,stderr:'PRIVATE_STDERR'}),cleanup:async()=>s.cleanup};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'FACT_REVIEW_FAILED'});
  const text=await readFile(join(s.context.cwd,'검수진단.json'),'utf8');expect(text).not.toContain('PRIVATE_STDERR');expect(JSON.parse(text)).toMatchObject({nativeExitObserved:true,exitCode,terminalReceived:false,outcome:'FAILED'});
 }finally{await reviewer.dispose();}
});
it.each(['unknown','failed'] as const)('terminal 검증 뒤 정리 %s는 발행을 차단하고 불명 증거를 유지한다',async status=>{
 const s=await setup();const statuses:string[]=[];
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'},onProgress:e=>{statuses.push(e.status);}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(s.frames.map(e=>JSON.stringify(e)).join('\n')+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>({...s.cleanup,status,reason:'UNVERIFIED_TEST_TRANSPORT'})};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'CANCEL_CLEANUP_FAILED'});expect(statuses).not.toContain('completed');
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({cleanupStatus:status,outcome:'CANCEL_CLEANUP_FAILED'});
  expect(await reviewer.dispose()).toMatchObject([{status,reason:'UNVERIFIED_TEST_TRANSPORT'}]);
 }finally{await reviewer.dispose();}
});
it('사용자 취소는 REVIEW_TIMEOUT과 구별하고 부분 스트림 진단을 남긴다',async()=>{
 const s=await setup(),abort=new AbortController();
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'},signal:abort.signal},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(JSON.stringify(s.frames[0])+'\n'+ '{"private":"CANCEL_SECRET');abort.abort();});
  return {result:new Promise(()=>{}),cleanup:async()=>s.cleanup};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'EXTERNAL_OUTCOME_UNKNOWN'});
  const text=await readFile(join(s.context.cwd,'검수진단.json'),'utf8');expect(text).not.toContain('CANCEL_SECRET');expect(JSON.parse(text)).toMatchObject({outcome:'EXTERNAL_OUTCOME_UNKNOWN',partialLine:true,cleanupStatus:'confirmed'});
 }finally{await reviewer.dispose();}
});
it('정상 init 다음 잘못된 JSON 프레임은 즉시 거절하고 내용을 진단에 복사하지 않는다',async()=>{
 const s=await setup();
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(JSON.stringify(s.frames[0])+'\n');options.onStdout?.('{"private":"MALFORMED_SECRET",not-json}\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>s.cleanup};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'FACT_REVIEW_FAILED'});
  const text=await readFile(join(s.context.cwd,'검수진단.json'),'utf8');expect(text).not.toContain('MALFORMED_SECRET');expect(JSON.parse(text)).toMatchObject({frameCount:2,terminalReceived:false,protocolFailed:true});
 }finally{await reviewer.dispose();}
});
it('같은 청크의 terminal 뒤 중복 프레임도 순서대로 관측하고 거절한다',async()=>{
 const s=await setup();
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.([...s.frames,s.frames[2]].map(e=>JSON.stringify(e)).join('\n')+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>s.cleanup};
 });
 try{await expect(reviewer.review(s.context,s.input)).rejects.toMatchObject({code:'PROVIDER_PROTOCOL_ERROR'});
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({frameCount:4,terminalReceived:true,eventCounts:{init:1,step_update:1,result:2},protocolFailed:true});
 }finally{await reviewer.dispose();}
});
it('정리 자체의 deadline은 응답 timeout과 구별하고 확인 불가를 진단한다',async()=>{
 const s=await setup();let cleaning!:()=>void;const ready=new Promise<void>(r=>{cleaning=r;});
 const reviewer=createOfflineAgySemanticReviewer({selection,livePermission:{inference:true,approvalReference:'offline'}},(_exe,_args,options)=>{
  queueMicrotask(()=>{options.onStdout?.(s.frames.map(e=>JSON.stringify(e)).join('\n')+'\n');});
  return {result:new Promise(()=>{}),cleanup:async()=>{cleaning();return new Promise(()=>{});}};
 });
 vi.useFakeTimers();
 try{const outcome=reviewer.review(s.context,s.input).catch(e=>e);await ready;await vi.advanceTimersByTimeAsync(10001);
  expect(await outcome).toMatchObject({code:'CANCEL_CLEANUP_FAILED'});
  expect(JSON.parse(await readFile(join(s.context.cwd,'검수진단.json'),'utf8'))).toMatchObject({cleanupStatus:'failed',outcome:'CANCEL_CLEANUP_FAILED'});
 }finally{vi.useRealTimers();await reviewer.dispose();}
});
