import Database from 'better-sqlite3';
import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createWorkerHealth} from '../../src/backend/실행상태.js';
import {setup,review,exportBundle} from './도움.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {captureFetchReceipt as capture} from '../../src/providers/사실재검증.js';
import {applyFactLinkRepair} from '../../src/providers/사실재검증.js';
import {reviewed} from './의미검수대역.js';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {prepareFactCheckpoint,captureFetchReceipt} from '../../src/providers/사실재검증.js';
import type * as C from '../../src/shared/포트.js';
import {prepared,fail} from './부분복구도움.js';
test.each([{reviewer:'claude' as const},{reviewer:'agy' as const,reviewEffort:'medium' as const},{reviewer:'agy' as const,reviewEffort:'low' as const}])('UI처럼 검수자 값을 생략한 부분 재개도 저장 선택을 유지한다 · %j',async selection=>{
 const {s,target,job,draft,receipts}=await prepared(true,selection);
 try{
  await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);
  const p=await s.getProject(target.projectId),cp=p.factRecovery!;expect(cp.available).toBe(true);
  const input={requestId:randomUUID(),version:p.projectVersion,claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:cp.sourceRunId,checkpointId:cp.checkpointId};
  const out=await s.mutate('factReview',target,input);expect(out.status).toBe(202);
  expect((await s.getProject(target.projectId)).factReview!.reviewer).toEqual(job.snapshot.factReview!.reviewer);
 }finally{await s.close();}
});
test('체크포인트는 실패/재기동 후 보존되고 원본 실패에 연결된 새 무세션 작업만 멱등 접수한다',async()=>{
 const {s,options,target,job,draft,receipts,p}=await prepared();let reopened:C.Store|undefined;
 try{expect(typeof s.saveFactCheckpoint).toBe('function');await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);
 const failed=await s.getProject(target.projectId);expect(failed.factRecovery).toMatchObject({step:'links',sourceRunId:job.run.runId});expect(failed.storyboard).toEqual(p.storyboard);
 await s.close();reopened=await createStore(options);const again=await reopened.getProject(target.projectId);const cp=await reopened.getFactCheckpoint(target.projectId,again.factRecovery!.checkpointId);expect(cp.receipts).toEqual(receipts);expect(cp.draft).toEqual(draft);
 const input={requestId:randomUUID(),version:again.projectVersion,claimIndices:[0],cardIds:p.storyboard!.cards.map(c=>c.cardId),resumeFromRunId:job.run.runId,checkpointId:cp.checkpointId,reviewer:'claude' as const};
 const out=await reopened.mutate('factReview',target,input);expect(out.status).toBe(202);expect((await reopened.mutate('factReview',target,input)).replayed).toBe(true);
 const next=await reopened.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});expect(next!.factCheckpoint).toEqual(cp);expect(next!.context!.engineSessionId).toBeNull();expect((await reopened.getRun(job.run.runId)).status).toBe('failed');expect(await reopened.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'})).toBeNull();
 }finally{await (reopened??s).close();}
});

test('private 보완 관측은 현재 실행에 결합되고 재저장 생략으로 유실되지 않는다',async()=>{
 const {s,target,job,draft,receipts}=await prepared();try{
  const base=prepareFactCheckpoint(draft,job.snapshot,receipts),observation:C.FactRepairObservation={decision:{status:'unresolvable',links:[],reason:'private 진단'},actualModel:'claude-test',observedAt:new Date().toISOString(),originRunId:job.run.runId};
  await expect(s.saveFactCheckpoint(job.fence,{...base,repairObservation:{...observation,originRunId:randomUUID()}})).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});
  await s.saveFactCheckpoint(job.fence,{...base,repairObservation:observation});
  for(const bad of [{...observation,observedAt:'bad'},{...observation,actualModel:'secret key\nunsafe'},{...observation,unexpected:true}])await expect(s.saveFactCheckpoint(job.fence,{...base,repairObservation:bad} as any)).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});
  await s.saveFactCheckpoint(job.fence,base);await fail(s,job);
  const p=await s.getProject(target.projectId),cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId);expect(cp.repairObservation).toEqual(observation);
  const publicInput={requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:cp.checkpointId,repairObservation:observation};
  await expect(s.mutate('factReview',target,publicInput)).rejects.toMatchObject({issues:[{code:'unrecognized_keys',keys:['repairObservation']}]});expect((await s.getProject(target.projectId)).activeRun).toBeNull();expect(JSON.stringify(p)).not.toContain('private 진단');
 }finally{await s.close();}
});

test('관측 원문 SHA 위조는 저장 경계에서 거절하고 체크포인트를 남기지 않는다',async()=>{
 const {s,target,job,draft,receipts}=await prepared();try{
 const write=prepareFactCheckpoint(draft,job.snapshot,receipts);write.receipts[0].evidenceSha256='b'.repeat(64);
 await expect(s.saveFactCheckpoint(job.fence,write)).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});
 await fail(s,job);expect((await s.getProject(target.projectId)).factRecovery).toBeUndefined();
 }finally{await s.close();}
});
test.each(['scope','reviewer','reviewEffort','stale','cross-project','source-run','active','model'])('재개 %s 위반은 새 작업/콘텐츠 변경 없이 거절한다',async mode=>{
 const {s,target,job,draft,receipts,options}=await prepared();try{
 await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);let p=await s.getProject(target.projectId);const cp=p.factRecovery!;
 const input:C.FactReviewRequest={requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,resumeFromRunId:cp.sourceRunId,checkpointId:cp.checkpointId,reviewer:'claude'};let pid=target.projectId;
 if(mode==='scope')input.cardIds=[input.cardIds[0]];if(mode==='reviewer')input.reviewer='agy';if(mode==='reviewEffort')input.reviewEffort='low';if(mode==='stale')input.version--;if(mode==='source-run')input.resumeFromRunId=randomUUID();
 if(mode==='model')await s.setProjectModel(pid,{requestId:randomUUID(),version:p.modelSettingsVersion!,model:'claude-haiku-4-5'});
 if(mode==='cross-project'){const other=await s.createProject({createRequestId:randomUUID(),topic:'다른 프로젝트'});if(!('data'in other.body))throw Error();pid=other.body.data.projectId;input.version=1;}
 if(mode==='active'){expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,reviewer:'claude'})).status).toBe(202);input.version=(await s.getProject(pid)).projectVersion;}
 p=await s.getProject(pid);const out=await s.mutate('factReview',{projectId:pid},input);expect('error'in out.body&&out.body.error.code).toBe(mode==='scope'||mode==='reviewer'||mode==='reviewEffort'?'FACT_SCOPE_INVALID':mode==='stale'?'VERSION_CONFLICT':mode==='source-run'||mode==='cross-project'?'NOT_FOUND':mode==='active'?'RUN_ACTIVE':'FACT_PROPOSAL_STALE');
 const after=await s.getProject(pid);expect(after.projectVersion).toBe(p.projectVersion);expect(after.activeRun?.runId).toBe(p.activeRun?.runId);expect(after.storyboard).toEqual(p.storyboard);
 }finally{await s.close();}
});
test('trusted 운영 이관은 저장 history·범위·출처 SHA를 검증하고 원래 실패와 현재 콘텐츠를 보존한다',async()=>{
 const {s,target,job,draft,receipts}=await prepared();try{
 await fail(s,job);const before=await s.getProject(target.projectId),input={sourceRunId:job.run.runId,snapshotVersion:job.snapshot.projectVersion,draft,receipts,sourceFileSha256:'a'.repeat(64)};
 await expect(s.importFactCheckpoint(target.projectId,{...input,sourceFileSha256:'BAD'})).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});
 expect((await s.importFactCheckpoint(target.projectId,input)).available).toBe(true);const after=await s.getProject(target.projectId);expect(after.storyboard).toEqual(before.storyboard);expect(after.claims).toEqual(before.claims);expect(after.projectVersion).toBe(before.projectVersion);expect((await s.getRun(job.run.runId)).status).toBe('failed');expect((await s.importFactCheckpoint(target.projectId,input)).checkpointId).toBe(after.factRecovery!.checkpointId);await expect(s.importFactCheckpoint(target.projectId,{...input,sourceFileSha256:'b'.repeat(64)})).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});
 }finally{await s.close();}
});
test.each([false,true])('채워진 schema3→4 DDL/기록 보존과 실패 rollback %s',async rollback=>{
 const {s,options}=await prepared();await s.close();let db=new Database(options.dbPath);const tables=['projects','history','runs','requests','project_model_settings'];const records=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
 db.exec('DROP TABLE fact_checkpoint_jobs;DROP TABLE fact_checkpoints;DELETE FROM schema_migrations WHERE version=4');
 if(rollback)db.exec("CREATE TRIGGER fail_v4 BEFORE INSERT ON schema_migrations WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT,'v4 rollback probe'); END");db.close();
 if(rollback)await expect(createStore(options)).rejects.toThrow('v4 rollback probe');else{const reopened=await createStore(options);await reopened.close();}
 db=new Database(options.dbPath);try{for(const t of tables)expect(db.prepare(`SELECT * FROM ${t}`).all()).toEqual(records[t]);expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {v:number}).v).toBe(rollback?3:4);expect(db.prepare("SELECT name FROM sqlite_master WHERE name='fact_checkpoints'").all()).toHaveLength(rollback?0:1);}finally{db.close();}
});

test('승인된 결과·기존 PNG/ZIP 내보내기는 체크포인트 실패/재개/새 제안 저장 뒤 바이트까지 보존한다',async()=>{
 const mock=createMockSnapshot('selection'),state=await review('실행데이터/부분복구/backend',[{text:'기존 불확실한 문장',kind:'uncertain',sourceIds:[mock.sources[0].sourceId],availability:'unknown',conditions:[]}]),{s,target,claim,options}=state;
 const health=createWorkerHealth(options.dataDir,randomUUID(),()=>new Date().toISOString());health.update('ready');
 try{let p=await s.getProject(target.projectId);expect((await s.mutate('approve',target,{requestId:randomUUID(),stage:'final',version:p.result!.version,acknowledgeWarnings:true})).status).toBe(202);let j=await claim();p=await s.getProject(target.projectId);const bundle=await exportBundle(j,p,state.assets.filter(a=>a.kind==='preview'));await s.commit(j.fence,{type:'exports',resultVersion:p.result!.version,...bundle});const before=await s.getProject(target.projectId);
 const hashes=await Promise.all(bundle.assets.map(async a=>createHash('sha256').update(await readFile(a.absolutePath)).digest('hex')));
 expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:before.projectVersion,claimIndices:[0],cardIds:before.result!.cards.map(c=>c.cardId),reviewer:'claude'})).status).toBe(202);j=await claim();const source={...p.sources[0],sourceId:randomUUID(),evidence:'새 제안 수치 10',access:'opened' as const,accessedAt:new Date().toISOString()};
 const draft:C.FactProposalDraft={kind:'factReview',sources:[source],findings:[{claimIndex:0,cardIds:[p.result!.cards[0].cardId],classification:'factual_error',reason:'합성 후보',afterClaim:{...p.claims[0],text:source.evidence,kind:'verified',sourceIds:[source.sourceId]},comparisons:[]}],cards:p.result!.cards.map(c=>({cardId:c.cardId,title:c.title,body:source.evidence,sourceIds:[source.sourceId]}))};
 const receipts=[capture('f1',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,source.accessedAt)];await s.saveFactCheckpoint(j.fence,prepareFactCheckpoint(draft,j.snapshot,receipts));await fail(s,j);p=await s.getProject(target.projectId);expect(p.factRecovery!.available).toBe(true);
 expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,reviewer:'claude',resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId})).status).toBe(202);j=await claim();const content=applyFactLinkRepair(j.snapshot,draft,receipts,{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'같은 주장 연결'});await s.commit(j.fence,{type:'content',content:reviewed(j.snapshot,content,'unverifiable')});
 const after=await s.getProject(target.projectId);expect(after.factReview!.state).toBe('ready');expect(after.result).toEqual(before.result);expect(after.exports).toEqual(before.exports);expect(after.sources).toEqual(before.sources);expect(await Promise.all(bundle.assets.map(async a=>createHash('sha256').update(await readFile(a.absolutePath)).digest('hex')))).toEqual(hashes);expect((await s.getExports(target.projectId)).entries).toEqual(before.exports);
 }finally{await s.close();}
});

test('stale 내용·lease fence·checkpoint 쓰기 rollback은 모델 실행 전에 원자 거절한다',async()=>{
 const {s,target,job,draft,receipts,options}=await prepared();try{
 const write=prepareFactCheckpoint(draft,job.snapshot,receipts);await expect(s.saveFactCheckpoint({...job.fence,fencingToken:job.fence.fencingToken+1},write)).rejects.toMatchObject({error:{code:'VERSION_CONFLICT'}});
 const db=new Database(options.dbPath);db.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON fact_checkpoints BEGIN SELECT RAISE(ABORT,'checkpoint rollback probe'); END");await expect(s.saveFactCheckpoint(job.fence,write)).rejects.toThrow('checkpoint rollback probe');expect(db.prepare('SELECT * FROM fact_checkpoints').all()).toHaveLength(0);db.exec('DROP TRIGGER reject_checkpoint');db.close();
 await s.saveFactCheckpoint(job.fence,write);await fail(s,job);await expect(s.saveFactCheckpoint(job.fence,write)).rejects.toMatchObject({error:{code:'VERSION_CONFLICT'}});let p=await s.getProject(target.projectId);const cp=p.factRecovery!;
 const edit=new Database(options.dbPath),stored=JSON.parse((edit.prepare('SELECT payload FROM projects WHERE id=?').get(target.projectId) as {payload:string}).payload) as C.ProjectSnapshot;stored.storyboard!.cards[0].body+=' 내용 변경';edit.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(stored),target.projectId);edit.close();
 p=await s.getProject(target.projectId);expect(p.factRecovery!.available).toBe(false);const out=await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,reviewer:'claude',resumeFromRunId:cp.sourceRunId,checkpointId:cp.checkpointId});expect(out).toMatchObject({status:409,body:{error:{code:'FACT_PROPOSAL_STALE'}}});expect((await s.getProject(target.projectId)).activeRun).toBeNull();
 }finally{await s.close();}
});

