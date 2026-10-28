import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {prepared,fail} from './부분복구도움.js';
import {prepareFactCheckpoint} from '../../src/providers/사실재검증.js';
import {checkpointSummary} from '../../src/backend/부분복구.js';
import type * as C from '../../src/shared/포트.js';
function records(db:Database.Database){return JSON.stringify((db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM "${name}"`).all()]));}
test('저장 관측이 있는 실패를 일반 retry로 새 수집·보완에 우회 접수하지 않는다',async()=>{
 const {s,target,job,draft,receipts}=await prepared();try{
 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:{decision:{status:'unresolvable',links:[],reason:'private'},actualModel:null,observedAt:new Date().toISOString(),originRunId:job.run.runId}});
 await s.commit(job.fence,{type:'failure',error:{code:'FACT_SCOPE_INVALID',message:'합성 실패',retryable:true,nextActions:['retry'],projectId:target.projectId,runId:job.run.runId,currentVersion:null,details:{}},externalOutcome:'known',retryAllowed:true});
 const before=await s.getProject(target.projectId);expect(before.lastRun!.retryAllowed).toBe(false);expect(before.allowedActions).not.toContain('retry');
 const out=await s.mutate('retry',{...target,runId:job.run.runId},{requestId:randomUUID(),version:before.projectVersion});expect(out.status).toBe(409);expect('error'in out.body&&out.body.error.code).toBe('FACT_PROPOSAL_STALE');const after=await s.getProject(target.projectId);expect(after.lastRun!.runId).toBe(job.run.runId);expect(after.projectVersion).toBe(before.projectVersion);expect(after.activeRun).toBeNull();
 }finally{await s.close();}
});
test.each(['stale','current-run','model','reviewer','worker','queue','unknown','active','cleanup'])('유효 재사용도 기존 %s 안전 가드를 해제하지 않는다',async mode=>{
 const {s,target,job,draft,receipts}=await prepared();try{
 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:{decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'private'},actualModel:null,observedAt:new Date().toISOString(),originRunId:job.run.runId}});await fail(s,job);
 const p=await s.getProject(target.projectId),cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId),r=await s.getRun(job.run.runId);let model=cp.requestedModel;
 expect(checkpointSummary(cp,p,r,new Date().toISOString(),model).available).toBe(true);
 if(mode==='stale')cp.contentHash='a'.repeat(64);if(mode==='current-run')p.lastRun!.runId=randomUUID();if(mode==='model')model='different-model';if(mode==='reviewer')p.factReview!.reviewer={provider:'agy',model:'gemini-3.8-flash-low'};
 if(mode==='worker')p.execution!.worker.state='unknown';if(mode==='queue')p.execution!.queue={blockingProjectId:randomUUID(),reason:'running'};if(mode==='unknown')r.externalOutcome='unknown';if(mode==='active')p.activeRun={...r,status:'running'};if(mode==='cleanup')r.error={...r.error!,code:'CANCEL_CLEANUP_FAILED'};
 const summary=checkpointSummary(cp,p,r,new Date().toISOString(),model);expect(summary.available).toBe(false);expect(summary.reason).toBeTruthy();expect(JSON.stringify(summary)).not.toContain('private');
 }finally{await s.close();}
});
test('유효한 저장 연결은 GET에서 쓰기 없이 의미 재개로 표시하고 오래된 orphan 이슈를 제거한다',async()=>{
 const {s,target,job,draft,receipts,options}=await prepared();const db=new Database(options.dbPath);
 try{
 const observation:C.FactRepairObservation={decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'private 응답 비노출'},actualModel:'claude-test',originRunId:job.run.runId,observedAt:new Date().toISOString()};
 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:observation});await fail(s,job);
 const before=records(db),p=await s.getProject(target.projectId),again=await s.getProject(target.projectId);
 expect(p.factRecovery).toMatchObject({available:true,step:'semantic',reuseRepairObservation:true,issues:[],reason:null});expect(again.factRecovery).toEqual(p.factRecovery);
 expect(p.factIssues!.some(i=>i.code==='FACT_CARD_LINK_MISSING')).toBe(false);expect(JSON.stringify(p)).not.toContain('private 응답');expect(records(db)).toBe(before);
 const cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId);expect(cp.step).toBe('links');expect(cp.draft).toEqual(draft);expect(cp.repairObservation).toEqual(observation);
 }finally{db.close();await s.close();}
});
test.each(['unresolvable','duplicate','unknown','missing','unknown-source','corrupt-receipt','corrupt-shape','corrupt-null'])('저장 연결 %s는 안전한 사유와 영향 카드를 표시하고 새 작업을 접수하지 않는다',async mode=>{
 const {s,target,job,draft,receipts,options}=await prepared();const db=new Database(options.dbPath);
 try{
 const decision:C.FactLinkRepairDecision={status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'private 응답 /secret/path'};
 if(mode==='unresolvable'){decision.status='unresolvable';decision.links=[];}

 if(mode==='unknown')decision.links[0].cardIds=[randomUUID()];


 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:{decision,actualModel:'test',observedAt:new Date().toISOString(),originRunId:job.run.runId}});await fail(s,job);
 if(mode.startsWith('corrupt')||mode==='duplicate'||mode==='missing'||mode==='unknown-source'){
  const row=db.prepare('SELECT checkpoint_id,payload FROM fact_checkpoints').get() as {checkpoint_id:string;payload:string};const cp=JSON.parse(row.payload);
  if(mode==='duplicate')cp.repairObservation.decision.links[0].cardIds.push(draft.cards[1].cardId);
  else if(mode==='missing')cp.repairObservation.decision.links=[];
  else if(mode==='unknown-source')cp.draft.findings[0].afterClaim.sourceIds=[randomUUID()];
  else if(mode==='corrupt-receipt')cp.receipts[0].evidenceSha256='a'.repeat(64);
  else if(mode==='corrupt-null')cp.repairObservation=null;
  else cp.repairObservation.decision={raw:'private raw invalid'};
  db.prepare('UPDATE fact_checkpoints SET payload=? WHERE checkpoint_id=?').run(JSON.stringify(cp),row.checkpoint_id);
 }
 const before=records(db),p=await s.getProject(target.projectId),cp=p.factRecovery!;
 expect(cp.available).toBe(false);expect(cp.reason).toContain(mode==='unresolvable'?'연결을 확정하지 못했습니다':mode==='duplicate'?'중복':mode==='unknown'?'대상':mode==='missing'?'누락':'검증');
 expect(cp.issues.length).toBeGreaterThan(0);expect(cp.issues.flatMap(i=>i.cardIds)).toContain(draft.cards[1].cardId);expect(cp.issues.some(i=>i.code==='FACT_CARD_LINK_MISSING')).toBe(false);
 expect(p.factIssues).toEqual(expect.arrayContaining(cp.issues));expect(JSON.stringify(p)).not.toMatch(/private|secret\/path/);expect(p.allowedActions).not.toContain('resume_fact_review');expect(records(db)).toBe(before);
 const runs=db.prepare('SELECT COUNT(*) AS n FROM runs').get();
 const result=await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:cp.sourceRunId,checkpointId:cp.checkpointId});
 expect(result.status).toBe(409);expect('error'in result.body&&result.body.error.code).toBe('FACT_PROPOSAL_STALE');expect('error'in result.body&&result.body.error.message).toBe(cp.reason);expect('error'in result.body&&result.body.error.details.reason).toBe(cp.issues[0].code);expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual(runs);expect((await s.getProject(target.projectId)).activeRun).toBeNull();
 }finally{db.close();await s.close();}
});
test('알려진 근거 참조만 빠진 제안은 조회에서 재사용 가능하되 저장 원본은 바꾸지 않는다',async()=>{
 const {s,target,job,draft,receipts,options}=await prepared();const db=new Database(options.dbPath);
 try{
  const extra={...draft.sources[0],sourceId:randomUUID()};draft.sources.push(extra);draft.cards[1].sourceIds=[extra.sourceId];
  const observation:C.FactRepairObservation={decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'합성 저장 응답'},actualModel:null,observedAt:new Date().toISOString(),originRunId:job.run.runId};
  await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:observation});await fail(s,job);
  const before=records(db),p=await s.getProject(target.projectId);
  expect(p.factRecovery).toMatchObject({available:true,step:'semantic',reuseRepairObservation:true,issues:[]});expect(records(db)).toBe(before);
  const cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId);expect(cp.draft).toEqual(draft);expect(cp.repairObservation).toEqual(observation);
 }finally{db.close();await s.close();}
});
