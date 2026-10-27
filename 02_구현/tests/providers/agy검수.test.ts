import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {parseAgyReviewOutput} from '../../src/providers/agy검수.js';
import {createOfflineAgySemanticReviewer} from '../../src/providers/agy검수.js';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {ReviewContext,ReviewSelection} from '../../src/shared/포트.js';
const context:ReviewContext={projectId:'11111111-1111-4111-8111-111111111111',runId:'22222222-2222-4222-8222-222222222222',attempt:1,cwd:resolve('.')};
const selection:ReviewSelection={provider:'agy',model:'gemini-3.8-flash-high'},cid='33333333-3333-4333-8333-333333333333';
const decision={verdict:'supported',reviewedCardIds:[],reviewedClaimIndices:[],issues:[]};
function frames(){return [{event:'init',conversation_id:cid,init:{cwd:context.cwd,tools:['finish'],permission_mode:'request-review'}},{event:'result',result:{conversation_id:cid,status:'SUCCESS',num_turns:1,structured_output:decision}}];}
it('공식 NDJSON의 단일 결과를 읽고 미반환 관측 모델은 추측하지 않는다',()=>{
 expect(parseAgyReviewOutput(frames().map(x=>JSON.stringify(x)).join('\n'),context,selection)).toEqual({decision,actualModel:null});
});
it.each(['cwd','model','agent','tools-shape','conversation','result','trailing','missing-output','tool-step'])('agy 검수 프로토콜 불일치 %s는 거절한다',mode=>{
 const events:any[]=frames();
 if(mode==='cwd')events[0].init.cwd=resolve('other');
 if(mode==='model')events[0].init.model='gemini-3.8-flash-low';
 if(mode==='agent')events[0].init.agent='other';
 if(mode==='tools-shape')events[0].init.tools=null;
 if(mode==='conversation')events[1].result.conversation_id=context.runId;
 if(mode==='result')events.push(events[1]);
 if(mode==='trailing')events.push({event:'step_update'});
 if(mode==='missing-output')delete events[1].result.structured_output;
 if(mode==='tool-step')events.splice(1,0,{event:'step_update',step_update:{conversation_id:cid,step_type:'tool',tool_name:'generate_image',state:'DONE'}});
 expect(()=>parseAgyReviewOutput(events.map(x=>JSON.stringify(x)).join('\n'),context,selection)).toThrow();
});
it('init의 전체 카탈로그와 실제 검수 실행 도구를 혼동하지 않는다',()=>{
 const events:any[]=frames();events[0].init.tools=['finish','run_command','generate_image'];
 expect(parseAgyReviewOutput(events.map(e=>JSON.stringify(e)).join('\n'),context,selection).decision).toEqual(decision);
});
it.each(['high','medium','low'])('실제 argv/stdin/제한 agent/파서에 선택된 agy %s를 전달한다 — 전송만 대역',async effort=>{
 const cwd=resolve('실행데이터/실사용검수복구/스트림/기존검수모델전환',randomUUID());await mkdir(cwd,{recursive:true});
 const selected={provider:'agy' as const,model:`gemini-3.8-flash-${effort}`};
 const input={projectId:context.projectId,cards:[{cardId:context.runId,title:'합성',body:'합성 검수 자료',sourceIds:[]}],claims:[],sources:[]};
 let calls=0;
 const reviewer=createOfflineAgySemanticReviewer({selection:selected,livePermission:{inference:true,approvalReference:'명시 합성 검증'}},(_exe,args,options)=>{
  calls++;expect(args[args.indexOf('--model')+1]).toBe(selected.model);expect(args).not.toContain('-p');expect(args).not.toContain('--dangerously-skip-permissions');
  expect(JSON.parse(options.stdin).message.content).toContain('합성 검수 자료');
  const events:any[]=frames();events[0].init.cwd=cwd;events[1].result.structured_output={...decision,reviewedCardIds:[context.runId]};
  return {result:Promise.resolve({exitCode:0,stdout:events.map(e=>JSON.stringify(e)).join('\n'),stderr:''}),cleanup:async()=>({runId:context.runId,status:'confirmed',verifiedAt:'2026-10-26T00:00:00Z',reason:'EXPLICIT_TRANSPORT_DOUBLE',children:[]})};
 });
 try{expect(await reviewer.review({...context,cwd},input)).toMatchObject({reviewer:selected,actualModel:null,verdict:'supported'});}finally{await reviewer.dispose();}
 expect(calls).toBe(1);expect(await readFile(resolve(cwd,'.agents/agents/cardnews-review/agent.md'),'utf8')).toContain('  - finish');
});
