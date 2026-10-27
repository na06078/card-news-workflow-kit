import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createStore} from '../../src/backend/저장소.js';
import {DomainError} from '../../src/backend/도메인.js';
import {createWorker} from '../../src/worker/작업자.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {EngineContext,WorkerOptions,ProjectSnapshot} from '../../src/shared/포트.js';
const at='2026-10-23T00:00:00.000Z';
async function setup(){
 const dataDir=await mkdtemp(resolve(process.env.TMPDIR??resolve(process.env.LOCALAPPDATA!,'hermes/cache/scratch'),'조사재시도-'));
 const dbPath=resolve(dataDir,'검사.sqlite'),s=await createStore({dataDir,dbPath,dataMode:'mock',clock:()=>at});
 const c=await s.createProject({topic:'격리 조사',createRequestId:randomUUID(),claudeModel:'offline-selected-model'});if(!('data'in c.body))throw Error('create');
 const pid=c.body.data.projectId,claim=()=>s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'});
 await s.mutate('research',{projectId:pid},{version:1,requestId:randomUUID()});const j=(await claim())!;
 await s.saveSession(j.fence,'원본세션',j.context!.cwd);
 await s.commit(j.fence,{type:'failure',error:new DomainError('RESEARCH_FAILED',pid).error,externalOutcome:'unknown',retryAllowed:true});
 return {s,pid,j,dataDir,dbPath,claim,close:async()=>{await s.close();await rm(dataDir,{recursive:true,force:true});}};
}
function inspect<T>(path:string,fn:(db:Database.Database)=>T){const db=new Database(path);try{return fn(db);}finally{db.close();}}
function legacy(f:Awaited<ReturnType<typeof setup>>){return inspect(f.dbPath,db=>{
 let parent=f.j.run.runId;for(let attempt=2;attempt<=3;attempt++){
 const rid=randomUUID(),r={...JSON.parse((db.prepare('SELECT payload FROM runs WHERE id=?').get(parent) as {payload:string}).payload),runId:rid,attempt,error:new DomainError('SESSION_RECOVERY_UNVERIFIED',f.pid).error,externalOutcome:'not_started'};
 db.prepare('INSERT INTO runs(id,project_id,status,payload,base_version,parent_id) VALUES(?,?,?,?,?,?)').run(rid,f.pid,'failed',JSON.stringify(r),3,parent);
 db.prepare('INSERT INTO invocations VALUES(?,?,?)').run(rid,attempt,JSON.stringify({phase:'terminal_commit',state:'committed'}));parent=rid;
 }return parent;
});}
function worker(f:Awaited<ReturnType<typeof setup>>,seen:EngineContext[],snapshots:ProjectSnapshot[]=[]){
 const forbidden=vi.fn(()=>{throw Error('FORBIDDEN_SIDE_EFFECT');});
 const options:WorkerOptions={store:f.s,dataDir:f.dataDir,ownerId:randomUUID(),dataMode:'mock',clock:()=>at,claudeOptions:{livePermission:{inference:false,search:false,image:false}},
 createClaudeAdapter:({bridge})=>({async *start(c,input){seen.push(structuredClone(c));snapshots.push(structuredClone((input as {snapshot:ProjectSnapshot}).snapshot));const p=createMockSnapshot('selection');yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:p.candidates,sources:p.sources,shortageReason:null});},answer:forbidden,status:id=>f.s.getRun(id),cancel:async runId=>({runId,status:'confirmed',verifiedAt:at,reason:'OFFLINE_DOUBLE',children:[]}),dispose:async()=>[]}),
 agy:{generate:forbidden,cancel:forbidden,dispose:async()=>[]},renderCard:forbidden,buildExport:forbidden,font:{family:'Noto Sans KR',absolutePath:'unused',licenseAssetId:randomUUID()},fontLicensePath:'unused'};
 return createWorker(options);
}
test('legacy 1→2→3는 원래 unknown 확인·CAS·멱등·불변 기록을 보존하고 새 turn으로 간다',async()=>{
 const f=await setup(),seen:EngineContext[]=[],snapshots:ProjectSnapshot[]=[],w=worker(f,seen,snapshots);try{
 const rid=legacy(f),before=await f.s.getProject(f.pid),target={projectId:f.pid,runId:rid};
 const frozen=inspect(f.dbPath,db=>({runs:db.prepare('SELECT * FROM runs').all(),sessions:db.prepare('SELECT * FROM sessions').all(),history:db.prepare('SELECT * FROM history').all(),events:db.prepare('SELECT * FROM events').all()}));
 expect(before.lastRun).toMatchObject({retryAllowed:true,retryRequiresUnknownConfirmation:true,externalOutcome:'not_started'});
 expect(await f.s.getRun(rid)).toEqual(before.lastRun);
 expect(await f.s.mutate('retry',target,{requestId:randomUUID(),version:before.projectVersion-1,confirmUnknownOutcome:true})).toMatchObject({status:409,body:{error:{code:'VERSION_CONFLICT'}}});
 expect(await f.s.mutate('retry',target,{requestId:randomUUID(),version:before.projectVersion})).toMatchObject({status:409,body:{error:{code:'EXTERNAL_OUTCOME_UNKNOWN'}}});
 const input={requestId:randomUUID(),version:before.projectVersion,confirmUnknownOutcome:true},accepted=await f.s.mutate('retry',target,input);
 expect(accepted.status).toBe(202);expect(await f.s.mutate('retry',target,input)).toMatchObject({replayed:true,body:accepted.body});
 await w.tick();expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({attempt:4,engineSessionId:null,cwd:f.j.context!.cwd,requestedModel:'offline-selected-model'});
 expect(await f.s.mutate('retry',target,input)).toMatchObject({replayed:true,body:accepted.body});
 const after=snapshots[0]!;for(const key of ['topic','period','researchVersion','selectedCandidateIds','claudeModel','modelSettingsVersion','candidates','sources','claims','storyboard','result'] as const)expect(after[key]).toEqual(before[key]);
 inspect(f.dbPath,db=>{expect(db.prepare('SELECT * FROM runs WHERE id IN (?,?,?) ORDER BY rowid').all(...frozen.runs.map((r:any)=>r.id))).toEqual(frozen.runs);expect(db.prepare('SELECT * FROM sessions').all()).toEqual(frozen.sessions);expect(db.prepare('SELECT * FROM history WHERE version<=?').all(before.projectVersion)).toEqual(frozen.history);expect(db.prepare('SELECT * FROM events WHERE seq<=?').all((frozen.events.at(-1) as any).seq)).toEqual(frozen.events);});
 }finally{await w.dispose();await f.close();}
});
test('worker 복구 차단은 raw retryAllowed=false이며 adapter를 시작하지 않는다',async()=>{
 const f=await setup(),seen:EngineContext[]=[],w=worker(f,seen);try{
 // Old queued row fixture: exercise worker recovery gate independently of the new API gate.
 inspect(f.dbPath,db=>{const r={...f.j.run,runId:randomUUID(),attempt:2,status:'queued',externalOutcome:'not_started',retryAllowed:false};db.prepare('INSERT INTO runs(id,project_id,status,payload,base_version,parent_id) VALUES(?,?,?,?,?,?)').run(r.runId,f.pid,'queued',JSON.stringify(r),3,f.j.run.runId);const old=JSON.parse((db.prepare('SELECT payload FROM runs WHERE id=?').get(f.j.run.runId) as any).payload);old.error=new DomainError('TOOL_PERMISSION_DENIED').error;db.prepare('UPDATE runs SET payload=? WHERE id=?').run(JSON.stringify(old),old.runId);});
 await w.tick();expect(seen).toHaveLength(0);expect((await f.s.getProject(f.pid)).lastRun).toMatchObject({error:{code:'SESSION_RECOVERY_UNVERIFIED'},retryAllowed:false});
 expect(inspect(f.dbPath,db=>JSON.parse((db.prepare('SELECT payload FROM runs ORDER BY rowid DESC LIMIT 1').get() as any).payload).retryAllowed)).toBe(false);
 }finally{await w.dispose();await f.close();}
});
test.each(['auth','permission','other','arbitrary_guard','question_id','stored_question','open_question','prepared','started','known_guard','wrong_kind','wrong_phase','cycle','attempt_gap','session_cwd','session_project','cross_project','root_disallowed','terminal_prepared','payload_identity','corrupt_json'] as const)('%s: 저장 세션 연구 retry API와 affordance를 함께 차단한다',async scenario=>{
 const f=await setup();try{
 const rid=legacy(f);
 inspect(f.dbPath,db=>{
  const update=(id:string,change:(r:any)=>void)=>{const r=JSON.parse((db.prepare('SELECT payload FROM runs WHERE id=?').get(id) as any).payload);change(r);db.prepare('UPDATE runs SET payload=? WHERE id=?').run(JSON.stringify(r),id);};
  const root=f.j.run.runId;
  if(scenario==='auth'||scenario==='permission'||scenario==='other'||scenario==='arbitrary_guard')update(root,r=>{r.error=new DomainError(scenario==='auth'?'AUTH_PATH_FORBIDDEN':scenario==='permission'?'TOOL_PERMISSION_DENIED':scenario==='other'?'PROVIDER_PROTOCOL_ERROR':'SESSION_RECOVERY_UNVERIFIED').error;});
  if(scenario==='corrupt_json')db.prepare('UPDATE runs SET payload=? WHERE id=?').run('{broken',root);
  if(scenario==='payload_identity')update(root,r=>{r.runId=rid;});
  if(scenario==='terminal_prepared')db.prepare('INSERT INTO invocations VALUES(?,?,?)').run(rid,3,JSON.stringify({phase:'terminal_commit',state:'prepared'}));
  if(scenario==='root_disallowed')update(root,r=>{r.retryAllowed=false;});
  if(scenario==='question_id')update(root,r=>{r.questionId=randomUUID();});
  if(scenario==='wrong_kind')update(root,r=>{r.kind='editorial';});
  if(scenario==='wrong_phase')update(root,r=>{r.phase='editorial';});
  if(scenario==='attempt_gap')update(rid,r=>{r.attempt=9;});
  if(scenario==='known_guard')update(rid,r=>{r.externalOutcome='known';});
  if(scenario==='prepared'||scenario==='started')db.prepare('INSERT INTO invocations VALUES(?,?,?)').run(rid,3,JSON.stringify({phase:'research',state:scenario}));
  if(scenario==='cycle')db.prepare('UPDATE runs SET parent_id=? WHERE id=?').run(rid,root);
  if(scenario==='session_cwd')db.prepare('UPDATE sessions SET cwd=?').run(resolve(f.dataDir,'outside'));
  if(['cross_project','session_project'].includes(scenario)){
   const pid=randomUUID(),payload=JSON.parse((db.prepare('SELECT payload FROM projects WHERE id=?').get(f.pid) as any).payload);payload.projectId=pid;db.prepare('INSERT INTO projects VALUES(?,?)').run(pid,JSON.stringify(payload));
   if(scenario==='cross_project'){db.prepare('UPDATE runs SET project_id=? WHERE id=?').run(pid,root);update(root,r=>{r.projectId=pid;});}else db.prepare('UPDATE sessions SET project_id=?').run(pid);
  }
  if(scenario==='stored_question'||scenario==='open_question'){
   const q={...createMockSnapshot('question').question!,questionId:randomUUID(),runId:scenario==='open_question'?null:root,kind:scenario==='open_question'?'output_size':'editorial',status:scenario==='open_question'?'open':'answered'};
   db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,NULL)').run(f.pid,q.questionId,1,q.status,JSON.stringify(q));
   if(scenario==='open_question'){const p=JSON.parse((db.prepare('SELECT payload FROM projects WHERE id=?').get(f.pid) as any).payload);p.question=q;db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),f.pid);}
  }
 });
 const p=await f.s.getProject(f.pid);expect(p.lastRun?.retryAllowed).toBe(false);expect((await f.s.getRun(rid)).retryAllowed).toBe(false);expect(p.allowedActions).not.toContain('retry');
 expect((await f.s.mutate('retry',{projectId:f.pid,runId:rid},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(409);expect(await f.claim()).toBeNull();
 }finally{await f.close();}
});
test('1000개를 넘는 계보는 유한 탐색 후 fail closed한다',async()=>{
 const f=await setup();try{
 const rid=inspect(f.dbPath,db=>db.transaction(()=>{
  const base=JSON.parse((db.prepare('SELECT payload FROM runs WHERE id=?').get(f.j.run.runId) as any).payload);let parent=base.runId;
  const insert=db.prepare('INSERT INTO runs(id,project_id,status,payload,base_version,parent_id) VALUES(?,?,?,?,?,?)');
  for(let attempt=2;attempt<=1001;attempt++){const runId=randomUUID(),r={...base,runId,attempt,error:new DomainError('SESSION_RECOVERY_UNVERIFIED').error,externalOutcome:'not_started'};insert.run(runId,f.pid,'failed',JSON.stringify(r),3,parent);parent=runId;}return parent;
 })());
 const p=await f.s.getProject(f.pid);expect(p.lastRun?.retryAllowed).toBe(false);expect((await f.s.mutate('retry',{projectId:f.pid,runId:rid},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(409);expect(await f.claim()).toBeNull();
 }finally{await f.close();}
});
test('session 없는 일반 research 권한 실패 retry는 기존 동작을 유지한다',async()=>{
 const f=await setup();try{
 inspect(f.dbPath,db=>{db.prepare('DELETE FROM sessions').run();const r=JSON.parse((db.prepare('SELECT payload FROM runs WHERE id=?').get(f.j.run.runId) as any).payload);r.error=new DomainError('TOOL_PERMISSION_DENIED').error;db.prepare('UPDATE runs SET payload=? WHERE id=?').run(JSON.stringify(r),r.runId);});
 const p=await f.s.getProject(f.pid);expect(p.lastRun?.retryAllowed).toBe(true);expect((await f.s.mutate('retry',{projectId:f.pid,runId:f.j.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(202);expect((await f.claim())?.context?.engineSessionId).toBeNull();
 }finally{await f.close();}
});
test('직접 RESEARCH_FAILED의 명시 retry는 원본을 보존하고 새 adapter turn을 시작한다',async()=>{
 const f=await setup(),seen:EngineContext[]=[],w=worker(f,seen);try{
 const before=await f.s.getProject(f.pid),old=await f.s.getRun(f.j.run.runId);
 expect((await f.s.mutate('retry',{projectId:f.pid,runId:old.runId},{requestId:randomUUID(),version:before.projectVersion,confirmUnknownOutcome:true})).status).toBe(202);
 await w.tick();expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({engineSessionId:null,phase:'research',requestedModel:'offline-selected-model'});
 expect((await f.s.getProject(f.pid)).lastRun?.status).toBe('succeeded');expect(await f.s.getRun(old.runId)).toEqual(old);
 }finally{await w.dispose();await f.close();}
});
