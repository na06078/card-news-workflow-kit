import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {DomainError} from '../../src/backend/도메인.js';
import {persistedRevisionReady} from '../../src/backend/재시도정책.js';
import type {RevisionDecision} from '../../src/shared/포트.js';
import {review} from './도움.js';
async function start(){const x=await review('실행데이터/카드수정복구/서버');const before=await x.s.getProject(x.target.projectId);expect((await x.s.mutate('revisions',x.target,{requestId:randomUUID(),version:1,scope:'text',cardIds:[x.cards[0]!.cardId],instruction:'명시 수정'})).status).toBe(202);return {...x,before,j:await x.claim()};}
for(const approved of [false,true])test.each(['no_change','unsupported','needs_scope','clarification'] as const)(`${approved?'approved':'ready'} fresh retry의 %s 종료는 콘텐츠 상태와 승인을 보존한다`,async status=>{
 const x=await review('실행데이터/카드수정복구/재시도후속/서버');
 try{
  if(approved){
   expect((await x.s.mutate('approve',x.target,{requestId:randomUUID(),stage:'final',version:1,acknowledgeWarnings:true})).status).toBe(202);
   const exporting=await x.claim();await x.s.commit(exporting.fence,{type:'failure',error:new DomainError('EXPORT_FAILED').error,externalOutcome:'known',retryAllowed:true});
  }
  expect((await x.s.mutate('revisions',x.target,{requestId:randomUUID(),version:1,scope:'text',cardIds:[x.cards[0].cardId],instruction:'명시 문구 확인'})).status).toBe(202);
  const first=await x.claim();await x.s.commit(first.fence,{type:'failure',error:new DomainError('PROVIDER_PROTOCOL_ERROR').error,externalOutcome:'known',retryAllowed:true});
  const before=await x.s.getProject(x.target.projectId),normal=approved?'approved':'ready';expect(before.status).toBe(normal);
  expect((await x.s.mutate('retry',{...x.target,runId:first.run.runId},{requestId:randomUUID(),version:before.projectVersion})).status).toBe(202);
  const queued=await x.s.getProject(x.target.projectId);expect(queued.status).toBe(normal);
  const child=await x.claim();expect(child.snapshot.status).toBe(normal);
  const decision:RevisionDecision=status==='needs_scope'?{kind:'revision',status,requestedScope:'layout',reason:'배치 범위를 확인하세요.'}:status==='clarification'?{kind:'revision',status,question:'어느 문장을 바꿀까요?'}:{kind:'revision',status,reason:'원고를 변경하지 않았습니다.'};
  await x.s.commit(child.fence,{type:'revision',decision});
  const after=await x.s.getProject(x.target.projectId);expect(after.status).toBe(normal);expect(after.stage).toBe(before.stage);expect(after.result).toEqual(before.result);expect(after.exports).toEqual(before.exports);expect(after.activeRun).toBeNull();expect(after.lastRun?.status).toBe('succeeded');expect(after.lastRun?.revisionOutcome).toEqual(decision);
 }finally{await x.s.close();}
});
test('적용 전 ready 카드는 적용 증거가 아니며 unknown fresh retry는 동의와 새 session을 요구한다',async()=>{
 const x=await start();try{expect(persistedRevisionReady(x.j.run,x.j.snapshot,x.j.revision)).toBe(false);await x.s.saveSession(x.j.fence,'old-revision-session',x.j.context!.cwd);await x.s.commit(x.j.fence,{type:'failure',error:new DomainError('PROVIDER_PROTOCOL_ERROR').error,externalOutcome:'unknown',retryAllowed:true});const p=await x.s.getProject(x.target.projectId);expect(p.result).toEqual(x.before.result);expect(p.lastRun?.retryAllowed).toBe(true);expect(p.lastRun?.retryRequiresUnknownConfirmation).toBe(true);
 const denied=await x.s.mutate('retry',{...x.target,runId:x.j.run.runId},{requestId:randomUUID(),version:p.projectVersion});expect('error'in denied.body&&denied.body.error.code).toBe('EXTERNAL_OUTCOME_UNKNOWN');expect((await x.s.mutate('retry',{...x.target,runId:x.j.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(202);const child=await x.claim();expect(child.run.revisionProtocol).toBe(2);expect(child.context?.engineSessionId).toBe(null);expect(child.run.revisionApplied).toBeUndefined();expect(child.snapshot.result).toEqual(x.before.result);
 }finally{await x.s.close();}
});
test('적용 marker를 새 렌더 retry에 그대로 상속하고 현재 버전 불일치는 거절한다',async()=>{
 const x=await start();try{const c=x.cards[0]!;const a=await x.s.commit(x.j.fence,{type:'revision',decision:{kind:'revision',status:'patch',patches:[{cardId:c.cardId,scope:'text',changes:{title:'반영 원고',body:c.body,sourceIds:c.sourceIds}}]}});await x.s.commit(a.fence,{type:'failure',error:new DomainError('RENDER_FAILED').error,externalOutcome:'known',retryAllowed:true});let p=await x.s.getProject(x.target.projectId);expect(persistedRevisionReady(p.lastRun!,p,x.j.revision)).toBe(true);expect(persistedRevisionReady(p.lastRun!,{...p,result:{...p.result!,version:99}},x.j.revision)).toBe(false);
 expect((await x.s.mutate('retry',{...x.target,runId:x.j.run.runId},{requestId:randomUUID(),version:p.projectVersion})).status).toBe(202);const child=await x.claim();expect(child.run.revisionApplied).toEqual(p.lastRun?.revisionApplied);expect(persistedRevisionReady(child.run,child.snapshot,child.revision)).toBe(true);
 await x.s.commit(child.fence,{type:'failure',error:new DomainError('RENDER_FAILED').error,externalOutcome:'known',retryAllowed:true});const db=new Database(x.options.dbPath);try{const row=db.prepare('SELECT payload FROM projects WHERE id=?').get(x.target.projectId) as any;const raw=JSON.parse(row.payload);raw.result.cards[0].revision++;db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(raw),x.target.projectId);}finally{db.close();}p=await x.s.getProject(x.target.projectId);expect(p.lastRun?.retryAllowed).toBe(false);expect((await x.s.mutate('retry',{...x.target,runId:child.run.runId},{requestId:randomUUID(),version:p.projectVersion})).status).toBe(409);
 }finally{await x.s.close();}
});
test.each(['CANCEL_CLEANUP_FAILED','question'] as const)('%s는 v2 fresh planning 재시도를 열지 않는다',async reason=>{
 const x=await start();try{if(reason==='question'){const db=new Database(x.options.dbPath);try{const row=db.prepare('SELECT payload FROM runs WHERE id=?').get(x.j.run.runId) as any;const r=JSON.parse(row.payload);r.questionId=randomUUID();db.prepare('UPDATE runs SET payload=? WHERE id=?').run(JSON.stringify(r),r.runId);}finally{db.close();}}
 await x.s.commit(x.j.fence,{type:'failure',error:new DomainError(reason==='question'?'PROVIDER_PROTOCOL_ERROR':reason).error,externalOutcome:'unknown',retryAllowed:true});const p=await x.s.getProject(x.target.projectId);expect(p.lastRun?.retryAllowed).toBe(false);expect((await x.s.mutate('retry',{...x.target,runId:x.j.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(409);
 }finally{await x.s.close();}
});
