/** CN-1 persistence port (shared/포트.ts Store), SQL ownership stays here.
 * createStore does not claim/reconcile/generate automatically. close is caller-owned.
 * New assets: dataDir/projects/{projectId}/attempts/{runId}/{attempt}/... only.
 * content(cards) and incomplete production are nonterminal; use returned fence to continue.
 * production may persist partial cards/assets; retry preserves ready cards and immutable history.
 * candidates(shortage) opens an app question and releases the lease: worker must stop that phase.
 * readAnswer adopts only its stored answer version; markAnswerDelivered MUST win before callback delivery.
 * mark records permission to deliver once, NOT proof that the external SDK received the answer.
 * Retry context contains only explicit same-project run ancestry session metadata. It is NOT permission
 * to resume an unverified pending SDK callback; G1/W1 recovery gate remains mandatory.
 * reconcile reports unreferenced registered asset IDs; unindexed staging files are preserved, never adopted/deleted.
 */
import Database from 'better-sqlite3';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import * as C from '../shared/포트.js';
import {deleteProjectFiles,verifyProjectFilesAbsent,validateProjectDeletionPath} from './프로젝트삭제.js';
import {DeleteProjectRequestSchema,ModelSelectionRequestSchema} from '../shared/작업공간계약.js';
import {DomainError,requireThat as must} from './도메인.js';
import {checkedWrite,checkpointMatches,checkpointSummary} from './부분복구.js';
import {prepareFactCheckpoint} from '../providers/사실재검증.js';
import {factFingerprint,beginFactReview,saveFactProposal,applyFactProposal,factIssues} from './사실복구.js';
import {checkStoredFacts} from '../worker/검수.js';
import {buildSemanticReviewInput,semanticInputHash} from '../providers/검수내용.js';
import {persistedRevisionReady,freshEditorialAllowed} from './재시도정책.js';
import {readWorkerState} from './실행상태.js';
import {recoveryActions} from './복구행동.js';
import {verifyAsset,safeFilename} from './파일경계.js';
type Row={payload:string};
export const createStore:C.CreateStore=async options=>{
 await mkdir(dirname(resolve(options.dbPath)),{recursive:true});await mkdir(options.dataDir,{recursive:true});
 const db=new Database(options.dbPath);db.pragma('foreign_keys = ON');db.pragma('journal_mode = WAL');db.pragma(`busy_timeout = ${options.busyTimeoutMs??1500}`);
 const clock=options.clock??(()=>new Date().toISOString()),id=options.idFactory??randomUUID;
 let appRoot=dirname(fileURLToPath(import.meta.url));while(!existsSync(resolve(appRoot,'package.json'))){const parent=dirname(appRoot);must(parent!==appRoot,'STAGE_CONFLICT');appRoot=parent;}
 const recoverySql=await readFile(resolve(appRoot,'migrations/004_부분복구.sql'),'utf8');
 const sql=await readFile(resolve(appRoot,'migrations/001_초기.sql'),'utf8');
 const deletionSql=await readFile(resolve(appRoot,'migrations/003_프로젝트삭제.sql'),'utf8');
 const modelSql=await readFile(resolve(appRoot,'migrations/002_모델설정.sql'),'utf8');
 try{db.transaction(()=>{db.exec(sql);db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)').run(clock());db.prepare('INSERT OR IGNORE INTO store_settings VALUES(1,?)').run(options.dataMode);must((db.prepare('SELECT data_mode FROM store_settings WHERE id=1').get() as {data_mode:string}).data_mode===options.dataMode,'STAGE_CONFLICT');const version=(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {v:number}).v;must(version===1||version===2||version===3||version===4,'STAGE_CONFLICT');if(version===1){db.exec(modelSql);db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(clock());}if(version<3){db.exec(deletionSql);db.prepare('INSERT INTO schema_migrations VALUES(3,?)').run(clock());}if(version<4){db.exec(recoverySql);db.prepare('INSERT INTO schema_migrations VALUES(4,?)').run(clock());}}).immediate();}catch(e){db.close();throw e;}
 const parse=<T>(row:Row|undefined):T=>{must(row,'NOT_FOUND');return JSON.parse(row.payload) as T;};
 const project=(pid:string)=>parse<C.ProjectSnapshot>(db.prepare('SELECT payload FROM projects WHERE id=?').get(pid) as Row|undefined);
 const deletion=(pid:string)=>db.prepare('SELECT request_id,version,state FROM project_deletions WHERE project_id=?').get(pid) as {request_id:string;version:number;state:string}|undefined;
 const writable=(pid:string)=>must(!deletion(pid),'PROJECT_DELETING',pid);
 const modelSettings=(pid:string)=>(db.prepare('SELECT model,version,updated_at FROM project_model_settings WHERE project_id=?').get(pid) as {model:string|null;version:number;updated_at:string}|undefined)??{model:null,version:0,updated_at:''};
 const run=(rid:string)=>parse<C.Run>(db.prepare('SELECT payload FROM runs WHERE id=?').get(rid) as Row|undefined);
 // Derive retry affordances without mutating persisted runs/history.
 const researchRetry=(r:C.Run,p:C.ProjectSnapshot)=>{
  let current:C.Run|null=r,child:C.Run|null=null,rootFound=false,eligible=true,hasSession=false,unknown=false;
  const seen=new Set<string>(),cwd=resolve(options.dataDir,'projects',p.projectId,'engine');
  if(p.question?.status==='open')eligible=false;
  for(let depth=0;current&&depth<1000;depth++){
   const row=db.prepare('SELECT project_id,parent_id FROM runs WHERE id=?').get(current.runId) as {project_id:string;parent_id:string|null}|undefined;
   if(!row||seen.has(current.runId)||row.project_id!==p.projectId||current.projectId!==p.projectId||current.kind!=='research'||current.phase!=='research'||!Number.isSafeInteger(current.attempt)||current.attempt<1||child&&child.attempt!==current.attempt+1)return {fresh:false,blocked:true,unknown:false};
   seen.add(current.runId);unknown ||= current.externalOutcome==='unknown';
   const sessions=db.prepare('SELECT project_id,cwd FROM sessions WHERE run_id=?').all(current.runId) as {project_id:string;cwd:string}[];
   hasSession ||= sessions.length>0;
   if(sessions.some(s=>s.project_id!==p.projectId||resolve(s.cwd)!==cwd))return {fresh:false,blocked:true,unknown:false};
   const questions=(db.prepare('SELECT payload FROM questions WHERE project_id=?').all(p.projectId) as Row[]).some(q=>JSON.parse(q.payload).runId===current!.runId);
   if(current.questionId!==null||questions)eligible=false;
   if(!rootFound){
    if(current.status==='failed'&&current.error?.code==='RESEARCH_FAILED'&&current.retryAllowed){rootFound=true;}
    else if(!(current.status==='failed'&&current.error?.code==='SESSION_RECOVERY_UNVERIFIED'&&current.externalOutcome==='not_started'&&!(db.prepare('SELECT payload FROM invocations WHERE run_id=?').all(current.runId) as Row[]).some(j=>{const mark=JSON.parse(j.payload);return mark.phase!=='terminal_commit'||mark.state!=='committed';})))eligible=false;
   }
   child=current;
   if(!row.parent_id){if(current.attempt!==1)return {fresh:false,blocked:true,unknown:false};current=null;break;}
   const parent=db.prepare('SELECT payload FROM runs WHERE id=?').get(row.parent_id) as Row|undefined;
   if(!parent)return {fresh:false,blocked:true,unknown:false};
   try{const parsed=C.RunSchema.safeParse(JSON.parse(parent.payload));if(!parsed.success||parsed.data.runId!==row.parent_id)return {fresh:false,blocked:true,unknown:false};current=parsed.data;}catch{return {fresh:false,blocked:true,unknown:false};}
  }
  if(current)return {fresh:false,blocked:true,unknown:false};
  const fresh=eligible&&rootFound;
  return {fresh,blocked:hasSession&&!fresh,unknown:fresh&&unknown};
 };
 const retryPolicy=(r:C.Run,p:C.ProjectSnapshot)=>{
  if(r.kind==='research')return researchRetry(r,p);
  if(!['editorial','revision','factReview'].includes(r.kind))return {fresh:false,blocked:false,unknown:false};
  const row=db.prepare('SELECT revision FROM runs WHERE id=?').get(r.runId) as {revision:string|null};const revision:C.RevisionRequest|null=row.revision?JSON.parse(row.revision):null;
  const seen=new Set<string>();let current:C.Run|null=r,hasSession=false,hasQuestion=p.question?.status==='open';
  for(let depth=0;current&&depth<1000;depth++){
   if(seen.has(current.runId)||current.projectId!==p.projectId)return {fresh:false,blocked:true,unknown:false};seen.add(current.runId);
   const sessions=db.prepare('SELECT project_id,cwd FROM sessions WHERE run_id=?').all(current.runId) as {project_id:string;cwd:string}[];hasSession ||= sessions.length>0;
   if(sessions.some(s=>s.project_id!==p.projectId||resolve(s.cwd)!==resolve(options.dataDir,'projects',p.projectId,'engine')))return {fresh:false,blocked:true,unknown:false};
   hasQuestion ||= current.questionId!==null||(db.prepare('SELECT payload FROM questions WHERE project_id=?').all(p.projectId) as Row[]).some(q=>JSON.parse(q.payload).runId===current!.runId);
   const parent=(db.prepare('SELECT parent_id FROM runs WHERE id=?').get(current.runId) as {parent_id:string|null}|undefined)?.parent_id;
   if(!parent){current=null;break;}const parentRow=db.prepare('SELECT payload FROM runs WHERE id=?').get(parent) as Row|undefined;if(!parentRow)return {fresh:false,blocked:true,unknown:false};current=JSON.parse(parentRow.payload);
  }
  if(current)return {fresh:false,blocked:true,unknown:false};
  const fresh=freshEditorialAllowed(r,revision,hasQuestion),persisted=persistedRevisionReady(r,p,revision);
  const needsProvider=r.kind!=='revision'||revision?.scope==='storyboard'||revision?.scope==='text'||revision?.scope==='layout';
  return {fresh,blocked:hasSession&&needsProvider&&!fresh&&!persisted,unknown:false};
 };
 const publicRun=(r:C.Run,p=project(r.projectId)):C.Run=>{
  const policy=retryPolicy(r,p);
  return {...r,retryAllowed:policy.blocked?false:r.retryAllowed,retryRequiresUnknownConfirmation:policy.unknown};
 };
 const checkpoint=(pid:string,cid:string)=>parse<C.FactCheckpoint>(db.prepare('SELECT payload FROM fact_checkpoints WHERE project_id=? AND checkpoint_id=?').get(pid,cid) as Row|undefined);
 const latestCheckpoint=(pid:string,rid:string)=>{const row=db.prepare('SELECT payload FROM fact_checkpoints WHERE project_id=? AND source_run_id=?').get(pid,rid) as Row|undefined;return row?JSON.parse(row.payload) as C.FactCheckpoint:undefined;};
 const putCheckpoint=(p:C.ProjectSnapshot,r:C.Run,write:C.FactCheckpointWrite,snapshotVersion:number,sourceFileSha256:string|null=null)=>{
  const checked=checkedWrite(write,p),old=latestCheckpoint(p.projectId,r.runId);
  must(!old||old.step!=='semantic'||checked.step==='semantic','FACT_SCOPE_INVALID',p.projectId);
  // Provenance can only name this producer run or an exact observation inherited from its saved parent.
  const parentRow=db.prepare('SELECT checkpoint_id FROM fact_checkpoint_jobs WHERE run_id=?').get(r.runId) as {checkpoint_id:string}|undefined;
  const inherited=parentRow?checkpoint(p.projectId,parentRow.checkpoint_id).repairObservation:undefined;
  const observation=checked.repairObservation??old?.repairObservation??inherited;
  if(observation)must(observation.originRunId===r.runId||[old?.repairObservation,inherited].some(value=>value&&C.canonicalJson(value)===C.canonicalJson(observation)),'FACT_SCOPE_INVALID',p.projectId);
  if(observation)checked.repairObservation=structuredClone(observation);
  const cp:C.FactCheckpoint={...checked,checkpointId:old?.checkpointId??id(),projectId:p.projectId,sourceRunId:r.runId,snapshotVersion,contentHash:factFingerprint(p,p.factReview!),savedAt:clock(),reviewer:structuredClone(p.factReview!.reviewer??C.DEFAULT_FACT_REVIEWER),requestedModel:r.requestedModel??null};
  db.prepare('INSERT INTO fact_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(source_run_id) DO UPDATE SET payload=excluded.payload').run(cp.checkpointId,p.projectId,r.runId,JSON.stringify(cp),sourceFileSha256);return cp;
 };
 const saveRun=(r:C.Run)=>db.prepare('UPDATE runs SET status=?,payload=? WHERE id=?').run(r.status,JSON.stringify(r),r.runId);
 const get=(pid:string):C.ProjectSnapshot=>{const p=project(pid);const a=db.prepare("SELECT payload FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_for_user','cancel_requested')").get(pid) as Row|undefined;p.activeRun=a?JSON.parse(a.payload):null;const last=db.prepare('SELECT payload FROM runs WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(pid) as Row|undefined;p.lastRun=last?publicRun(JSON.parse(last.payload),p):null;p.allowedActions=p.question?.status==='open'&&!p.activeRun?['answer']:p.activeRun?['cancel',...(p.question?.status==='open'&&p.activeRun.status!=='cancel_requested'?['answer' as const]:[])]:p.status==='interrupted'||p.status==='error'||p.status==='canceled'?(p.lastRun&&!p.lastRun.retryAllowed?[]:['retry']):p.stage==='selection'?['select']:p.stage==='storyboard'?['approve_storyboard','revise']:p.stage==='review'?['approve_final','revise']:p.stage==='export'?['revise']:[];const settings=modelSettings(pid);p.claudeModel=settings.model;p.modelSettingsVersion=settings.version;p.factIssues=factIssues(p);if(p.result&&p.result.finalApprovedVersion!==p.result.version)p.result.factsCheck=checkStoredFacts(p,p.result);p.execution={worker:readWorkerState(options.dataDir,clock()),queue:null};const blocker=db.prepare("SELECT project_id,status FROM runs WHERE project_id<>? AND status IN ('running','waiting_for_user','cancel_requested') AND (owner IS NOT NULL OR status='waiting_for_user') ORDER BY rowid LIMIT 1").get(pid) as {project_id:string;status:'running'|'waiting_for_user'|'cancel_requested'}|undefined;if(blocker)p.execution.queue={blockingProjectId:blocker.project_id,reason:blocker.status};const cp=p.factReview?latestCheckpoint(pid,p.factReview.runId):undefined;if(cp&&p.lastRun){p.factRecovery=checkpointSummary(cp,p,p.lastRun,clock(),settings.model);p.factIssues.push(...cp.issues);}else delete p.factRecovery;p.allowedActions=recoveryActions(p);if(p.result&&p.result.factsCheck!=='passed'&&!C.canManuallyApprove(p))p.allowedActions=p.allowedActions.filter(a=>a!=='approve_final');return C.ProjectSnapshotSchema.parse(p);};
 const save=(p:C.ProjectSnapshot)=>{db.prepare('INSERT INTO project_model_settings VALUES(?,NULL,0,?) ON CONFLICT(project_id) DO UPDATE SET updated_at=excluded.updated_at').run(p.projectId,clock());p.activeRun=null;p.lastRun=null;p.allowedActions=[];delete p.factRecovery;db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),p.projectId);db.prepare('INSERT OR REPLACE INTO history VALUES(?,?,?)').run(p.projectId,p.projectVersion,JSON.stringify(p));};
 const receipt=(p:C.ProjectSnapshot,r:C.Run|null)=>({projectId:p.projectId,projectVersion:p.projectVersion,runId:r?.runId??null,status:r?.status??null,accepted:true as const});
 const enqueue=(p:C.ProjectSnapshot,kind:C.Run['kind'],revision:C.RevisionRequest|null=null,parent:C.Run|null=null)=>{const at=clock();const r:C.Run={runId:id(),projectId:p.projectId,kind,requestedModel:modelSettings(p.projectId).model,status:'queued',attempt:parent?parent.attempt+1:1,phase:parent?.phase??kind,createdAt:at,updatedAt:at,lastEventSeq:0,questionId:null,error:null,externalOutcome:'not_started',retryAllowed:false};db.prepare('INSERT INTO runs(id,project_id,status,payload,base_version,revision,parent_id) VALUES(?,?,?,?,?,?,?)').run(r.runId,p.projectId,r.status,JSON.stringify(r),p.projectVersion,revision?JSON.stringify(revision):null,parent?.runId??null);event(r,{type:'progress',phase:kind,message:'작업을 접수했습니다.',completed:null,total:null});return r;};
 const ledger=<T>(scope:string,rid:string,route:string,input:unknown,fn:()=>{status:number;body:C.Success<T>}):C.HttpReply<T>=>db.transaction(()=>{
  if(scope!=='@create'&&deletion(scope))return {status:409,body:{error:new DomainError('PROJECT_DELETING',scope).error},replayed:false};
  const canonical=C.canonicalJson(input),sha=createHash('sha256').update(canonical).digest('hex');const old=db.prepare('SELECT * FROM requests WHERE scope=? AND request_id=?').get(scope,rid) as {route:string;canonical:string;sha256:string;status:number;body:string}|undefined;
  if(old){if(old.route!==route||old.canonical!==canonical||old.sha256!==sha)return {status:409,body:{error:new DomainError('REQUEST_ID_CONFLICT',scope==='@create'?null:scope).error},replayed:false};return {status:old.status,body:JSON.parse(old.body),replayed:true};}
  let out:{status:number;body:C.Success<T>|C.Failure};db.exec('SAVEPOINT domain_change');try{out=fn();db.exec('RELEASE domain_change');}catch(e){db.exec('ROLLBACK TO domain_change');db.exec('RELEASE domain_change');if(!(e instanceof DomainError))throw e;e.error.details={...e.error.details,requestOutcome:'rejected'};if(e.error.code==='VALIDATION_ERROR')return {status:e.status,body:{error:e.error},replayed:false};out={status:e.status,body:{error:e.error}};}
  db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)').run(scope,rid,'POST',route,canonical,sha,out.status,JSON.stringify(out.body));return {...out,replayed:false};
 }).immediate();
 type LeaseRow={owner:string|null;lease_until:string|null;fence:number;base_version:number;revision:string|null};
 const check=(f:C.LeaseFence,allowCancel=false,allowAnswer=false)=>{writable(f.projectId);const r=run(f.runId),p=project(f.projectId);const row=db.prepare('SELECT * FROM runs WHERE id=?').get(f.runId) as LeaseRow;
  must(r.projectId===f.projectId&&r.attempt===f.attempt&&row.owner===f.ownerId&&row.fence===f.fencingToken&&row.lease_until!==null&&row.lease_until>clock()&&['running','waiting_for_user',...(allowCancel?['cancel_requested']:[])].includes(r.status),'VERSION_CONFLICT',f.projectId,p.projectVersion,'lease/fence');
  let valid=row.base_version===f.baseProjectVersion&&p.projectVersion===f.baseProjectVersion;
  if(!valid&&allowAnswer){
   if(r.status==='cancel_requested'&&row.base_version===p.projectVersion&&p.projectVersion===f.baseProjectVersion+1)valid=true;
   if(p.question?.status==='answered'&&p.question.questionId===r.questionId){const answer=db.prepare('SELECT base_before,base_after FROM answers WHERE project_id=? AND question_id=? AND version=?').get(p.projectId,p.question.questionId,p.question.version) as {base_before:number;base_after:number}|undefined;valid=valid||!!answer&&answer.base_before===f.baseProjectVersion&&((answer.base_after===p.projectVersion&&[answer.base_before,answer.base_after].includes(row.base_version))||(allowCancel&&r.status==='cancel_requested'&&answer.base_after+1===p.projectVersion&&row.base_version===p.projectVersion));}
  }
  must(valid,'VERSION_CONFLICT',f.projectId,p.projectVersion,'base version');return {r,p,row};};
 const advance=(f:C.LeaseFence,p:C.ProjectSnapshot)=>{p.projectVersion++;save(p);db.prepare('UPDATE runs SET base_version=? WHERE id=?').run(p.projectVersion,f.runId);return {...f,baseProjectVersion:p.projectVersion};};
 const event=(r:C.Run,draft:C.EventDraft)=>{const seq=(db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE project_id=?').get(r.projectId) as {seq:number}).seq;const e=C.EngineEventSchema.parse({...draft,seq,at:clock(),projectId:r.projectId,runId:r.runId,attempt:r.attempt});db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(r.projectId,seq,r.runId,JSON.stringify(e));r.lastEventSeq=seq;r.updatedAt=clock();if(e.type==='progress'){r.phase=e.phase;if(e.actualModel&&e.phase!=='semantic-review')r.actualModel=e.actualModel;}saveRun(r);return e;};
 const appQuestion=(kind:'period_expansion'|'output_size',runId:string|null,reason:string):C.Question=>({questionId:id(),version:1,runId,kind,status:'open',createdAt:clock(),items:[{itemId:kind,text:reason,header:kind==='output_size'?'출력 크기':'조사 기간',multiSelect:false,allowFreeText:false,recommendedOptionId:null,recommendationReason:null,options:(kind==='output_size'?[['1080x1080','정사각형'],['1080x1350','세로형']]:[['expand_30','30일로 확대'],['keep_current','현재 후보 유지']]).map(([optionId,label])=>({optionId:optionId!,label:label!,description:label!}))}]});
 const insertQuestion=(p:C.ProjectSnapshot,q:C.Question)=>{must(p.question?.status!=='open','STAGE_CONFLICT',p.projectId);p.question=q;db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,NULL)').run(p.projectId,q.questionId,q.version,q.status,JSON.stringify(q));};
 const recordTerminal=(r:C.Run)=>{if(!['succeeded','failed','canceled'].includes(r.status))return;const mark:C.InvocationMark={phase:'terminal_commit',state:'committed',cardId:null,expectedPath:null,sha256:null,at:clock()};db.prepare('INSERT INTO invocations VALUES(?,?,?)').run(r.runId,r.attempt,JSON.stringify(mark));};
 const checkRevisionFields=(old:C.CardRevision,next:C.CardRevision,scope:C.RevisionRequest['scope'])=>{
  const keys:(keyof C.CardRevision)[]=scope==='text'?['cardId','order','role','imagePlan','imageAssetId']:scope==='image'?['cardId','order','role','title','body','sourceIds']:['cardId','order','role','title','body','sourceIds','imagePlan','imageAssetId'];
  must(keys.every(k=>C.canonicalJson(old[k])===C.canonicalJson(next[k])),'STAGE_CONFLICT');
  if(scope!=='layout')must(C.canonicalJson(old.layout??null)===C.canonicalJson(next.layout??null),'STAGE_CONFLICT');
 };
 const store:C.Store={
  async saveFactCheckpoint(f,write){db.transaction(()=>{const {r,p}=check(f);must(r.kind==='factReview'&&p.factReview?.runId===r.runId&&p.factReview.state==='pending'&&p.factReview.contentHash===factFingerprint(p,p.factReview),'FACT_PROPOSAL_STALE',p.projectId);putCheckpoint(p,r,write,f.baseProjectVersion);}).immediate();},
  async getFactCheckpoint(pid,cid){writable(pid);project(pid);return structuredClone(checkpoint(pid,cid));},
  async importFactCheckpoint(pid,input){return db.transaction(()=>{
   writable(pid);must(C.IdSchema.safeParse(input.sourceRunId).success&&C.Sha256Schema.safeParse(input.sourceFileSha256).success&&Number.isSafeInteger(input.snapshotVersion),'FACT_SCOPE_INVALID',pid);
   const p=get(pid),r=run(input.sourceRunId);
   must(r.projectId===pid&&r.kind==='factReview'&&r.status==='failed'&&p.lastRun?.runId===r.runId&&p.factReview?.runId===r.runId&&!p.activeRun&&p.question?.status!=='open','FACT_PROPOSAL_STALE',pid);
   must(!['CANCEL_CLEANUP_FAILED','EXTERNAL_OUTCOME_UNKNOWN'].includes(r.error?.code??''),'FACT_PROPOSAL_STALE',pid);
   const historical=parse<C.ProjectSnapshot>(db.prepare('SELECT payload FROM history WHERE project_id=? AND version=?').get(pid,input.snapshotVersion) as Row|undefined);
   must(historical.factReview?.runId===r.runId&&historical.factReview.state==='pending'&&historical.factReview.contentHash===factFingerprint(p,p.factReview!)&&historical.factReview.contentHash===factFingerprint(historical,historical.factReview),'FACT_PROPOSAL_STALE',pid);
   const old=latestCheckpoint(pid,r.runId);if(old){const provenance=db.prepare('SELECT source_file_sha256 FROM fact_checkpoints WHERE checkpoint_id=?').get(old.checkpointId) as {source_file_sha256:string|null};must(old.snapshotVersion===input.snapshotVersion&&(!provenance.source_file_sha256||provenance.source_file_sha256===input.sourceFileSha256),'FACT_SCOPE_INVALID',pid);must(C.canonicalJson(old.draft)===C.canonicalJson(input.draft)&&C.canonicalJson(old.receipts)===C.canonicalJson(input.receipts),'FACT_SCOPE_INVALID',pid);return checkpointSummary(old,p,r,clock(),modelSettings(pid).model);}
   const cp=putCheckpoint(historical,r,prepareFactCheckpoint(input.draft,historical,input.receipts),input.snapshotVersion,input.sourceFileSha256);
   // Trusted operator establishes completed collector output; never changes the old failed verdict/content.
   r.externalOutcome='known';saveRun(r);return checkpointSummary(cp,{...p,lastRun:r},r,clock(),modelSettings(pid).model);
  }).immediate();},
  async deleteProject(pid,input){
   const v=DeleteProjectRequestSchema.parse(input);
   try{
    const complete=db.transaction(()=>{
     const old=db.prepare('SELECT * FROM project_deletions WHERE project_id=?').get(pid) as {request_id:string;version:number;state:string}|undefined;
     if(old){must(old.request_id===v.requestId&&old.version===v.version,'REQUEST_ID_CONFLICT',pid);return old.state==='complete';}
     must(!db.prepare('SELECT 1 FROM requests WHERE scope=? AND request_id=?').get(pid,v.requestId),'REQUEST_ID_CONFLICT',pid);
     const current=project(pid);
     must(current.projectVersion===v.version,'VERSION_CONFLICT',pid,current.projectVersion);
     must(!db.prepare("SELECT 1 FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_for_user','cancel_requested')").get(pid),'RUN_ACTIVE',pid);
     db.prepare("INSERT INTO project_deletions VALUES(?,?,?,'pending')").run(pid,v.requestId,v.version);
     return false;
    }).immediate();
    if(complete)return {status:200,body:{data:{projectId:pid,deleted:true}},replayed:true};
    await validateProjectDeletionPath(options.dataDir,pid);
    await (options.deleteProjectFiles??deleteProjectFiles)(options.dataDir,pid);
    await verifyProjectFilesAbsent(options.dataDir,pid);
    db.transaction(()=>{
     db.prepare("DELETE FROM requests WHERE scope=? OR (scope='@create' AND json_extract(body,'$.data.projectId')=?)").run(pid,pid);
     for(const table of ['answers','questions','events','sessions','exports','assets','history','project_model_settings']){
      db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(pid);
     }
     db.prepare('DELETE FROM invocations WHERE run_id IN (SELECT id FROM runs WHERE project_id=?)').run(pid);
     db.prepare('UPDATE runs SET parent_id=NULL WHERE project_id=?').run(pid);
     db.prepare('DELETE FROM runs WHERE project_id=?').run(pid);
     db.prepare('DELETE FROM projects WHERE id=?').run(pid);
     // Verify absence inside the same transaction: a trigger/partial delete cannot claim success.
     must(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(pid),'PROJECT_DELETE_FAILED',pid);
     for(const table of ['answers','questions','events','sessions','exports','assets','history','project_model_settings','runs']){
      must(!db.prepare(`SELECT 1 FROM ${table} WHERE project_id=?`).get(pid),'PROJECT_DELETE_FAILED',pid);
     }
     must(!db.prepare("SELECT 1 FROM requests WHERE scope=? OR (scope='@create' AND json_extract(body,'$.data.projectId')=?)").get(pid,pid),'PROJECT_DELETE_FAILED',pid);
     db.prepare("UPDATE project_deletions SET state='complete' WHERE project_id=?").run(pid);
     must(deletion(pid)?.state==='complete','PROJECT_DELETE_FAILED',pid);
    }).immediate();
    return {status:200,body:{data:{projectId:pid,deleted:true}},replayed:false};
   }catch(e){const error=e instanceof DomainError?e:new DomainError('PROJECT_DELETE_FAILED',pid);return {status:error.status,body:{error:error.error},replayed:false};}
  },
  async setProjectModel(pid,input,validateModel){const v=ModelSelectionRequestSchema.parse(input);project(pid);const {requestId,...payload}=v;return ledger(pid,requestId,`/api/projects/${pid}/model`,payload,()=>{validateModel?.(v.model);const old=modelSettings(pid);must(v.version===old.version,'VERSION_CONFLICT',pid,old.version);db.prepare('INSERT INTO project_model_settings VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET model=excluded.model,version=excluded.version,updated_at=excluded.updated_at').run(pid,v.model,old.version+1,clock());return {status:200,body:{data:{projectId:pid,model:v.model,version:old.version+1,appliesTo:'next_run' as const}}};});},
  async listProjects(){
   const projects=(db.prepare('SELECT id FROM projects').all() as {id:string}[]).map(({id})=>{
    const p=get(id);const times=[p.period.anchorAt,modelSettings(id).updated_at,...(db.prepare('SELECT payload FROM runs WHERE project_id=?').all(id) as Row[]).map(row=>(JSON.parse(row.payload) as C.Run).updatedAt)];
    const pending=deletion(id);
    return {projectVersion:p.projectVersion,deletionPending:pending?.state==='pending',...(pending?{deletionRequestId:pending.request_id}:{}),projectId:id,topic:p.topic,stage:p.stage,status:p.status,updatedAt:times.sort().at(-1)!,cardCount:p.result?.cards.length??p.storyboard?.cards.length??0,activeRunId:p.activeRun?.runId??null,claudeModel:p.claudeModel??null};
   });projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.projectId.localeCompare(b.projectId));return {projects};
  },
  async createProject(input,validateModel){const v=C.CreateProjectRequestSchema.parse(input);const {createRequestId,...payload}=v;return ledger('@create',createRequestId,'/api/projects',payload,()=>{validateModel?.(v.claudeModel??null);const at=clock();const p:C.ProjectSnapshot={projectId:id(),topic:v.topic,projectVersion:1,stage:'topic',status:'idle',period:{days:v.period,anchorAt:at,to:at,from:new Date(Date.parse(at)-v.period*86400000).toISOString()},researchVersion:0,candidates:[],sources:[],claims:[],selectedCandidateIds:[],question:null,storyboard:null,result:null,activeRun:null,lastRun:null,allowedActions:[],exports:[],dataMode:options.dataMode};db.prepare('INSERT INTO projects VALUES(?,?)').run(p.projectId,JSON.stringify(p));db.prepare('INSERT INTO project_model_settings VALUES(?,?,0,?)').run(p.projectId,v.claudeModel??null,at);return {status:201,body:{data:{projectId:p.projectId,projectVersion:1}}};});},
  async mutate(name,target,input){const v=C.RequestSchemas[name].parse(input);let pid=target.projectId;if(name==='cancel'||name==='retry'){const r=run(target.runId!);must(r.projectId===pid,'NOT_FOUND');}project(pid);const {requestId,...payload}=v;const route=name==='cancel'||name==='retry'?`/api/runs/${target.runId}/${name}`:name==='cardApprove'?`/api/projects/${pid}/cards/${target.cardId}/approve`:`/api/projects/${pid}/${name}`;
   return ledger<unknown>(pid,requestId,route,payload,()=>{
    const p=get(pid);
    if(name==='cancel'){
     const r=run(target.runId!);if(!['queued','running','waiting_for_user','cancel_requested'].includes(r.status))return {status:200,body:{data:receipt(p,r)}};
     if(r.status!=='cancel_requested'){r.status='cancel_requested';r.updatedAt=clock();saveRun(r);p.projectVersion++;save(p);db.prepare('UPDATE runs SET base_version=? WHERE id=?').run(p.projectVersion,r.runId);}return {status:202,body:{data:receipt(p,r)}};
    }
    if(name==='answers'){
     const input=v as C.AnswerRequest,q=p.question;must(p.activeRun?.status!=='cancel_requested','QUESTION_STALE',pid,q?.version??null);must(q&&q.status==='open'&&q.questionId===input.questionId&&q.version===input.version,'QUESTION_STALE',pid,q?.version??null);
     try{C.validateAnswer(q,input);}catch{throw new DomainError('VALIDATION_ERROR',pid);}
     must(q.runId===p.activeRun?.runId||(q.runId===null&&q.kind==='output_size'),'QUESTION_STALE',pid,q.version);
     const before=p.projectVersion;let r=p.activeRun;q.status='answered';
     if(q.kind==='editorial'){must(r&&r.status==='waiting_for_user','QUESTION_STALE',pid);r.status='running';p.status='working';saveRun(r);}
     else if(q.kind==='output_size'){const size=input.answer[0]?.optionIds[0];must(size==='1080x1080'||size==='1080x1350','VALIDATION_ERROR',pid);must(p.storyboard,'STAGE_CONFLICT',pid);p.storyboard.size=size;p.storyboard.version++;p.status='ready';r=null;}
     else {const option=input.answer[0]?.optionIds[0];must(option==='expand_30'||option==='keep_current','VALIDATION_ERROR',pid);must(r&&r.status==='waiting_for_user'&&r.kind==='research','QUESTION_STALE',pid);if(option==='expand_30'){must(p.period.days===7,'STAGE_CONFLICT',pid);p.period.days=30;p.period.from=new Date(Date.parse(p.period.anchorAt)-30*86400000).toISOString();r.status='queued';p.status='working';db.prepare('UPDATE runs SET owner=NULL,lease_until=NULL,fence=fence+1 WHERE id=?').run(r.runId);}else{r.status='succeeded';p.stage='selection';p.status='ready';}saveRun(r);}
     p.projectVersion++;db.prepare('UPDATE questions SET status=?,payload=? WHERE project_id=? AND id=? AND version=?').run(q.status,JSON.stringify(q),pid,q.questionId,q.version);
     db.prepare('INSERT INTO answers VALUES(?,?,?,?,?,?,NULL)').run(pid,q.questionId,q.version,JSON.stringify(input.answer),before,p.projectVersion);if(q.kind==='period_expansion'&&r)db.prepare('UPDATE runs SET base_version=? WHERE id=?').run(p.projectVersion,r.runId);save(p);return {status:202,body:{data:{...receipt(p,r),questionId:q.questionId,questionVersion:q.version}}};
    }
    if(p.activeRun)throw new DomainError('RUN_ACTIVE',pid,p.projectVersion,undefined,p.activeRun.runId);
    if(['research','selection','approve','revisions','retry','factReview','factApply','rebuildExports'].includes(name))must(readWorkerState(options.dataDir,clock()).state!=='unavailable','WORKER_UNAVAILABLE',pid,p.projectVersion);
    if(name==='retry'){
     const input=v as C.RetryRequest,old=run(target.runId!);must(input.version===p.projectVersion,'VERSION_CONFLICT',pid,p.projectVersion);must(p.lastRun?.runId===old.runId&&['failed','interrupted','canceled'].includes(old.status)&&old.retryAllowed,'STAGE_CONFLICT',pid);const policy=retryPolicy(old,p);must(!policy.blocked,'SESSION_RECOVERY_UNVERIFIED',pid,p.projectVersion,'SESSION_RECOVERY_UNSUPPORTED');must((old.externalOutcome!=='unknown'&&!policy?.unknown)||input.confirmUnknownOutcome===true,'EXTERNAL_OUTCOME_UNKNOWN',pid);
     if(p.question?.status==='open'){p.question.status='superseded';db.prepare('UPDATE questions SET status=?,payload=? WHERE project_id=? AND id=? AND version=?').run('superseded',JSON.stringify(p.question),pid,p.question.questionId,p.question.version);}
     const row=db.prepare('SELECT revision FROM runs WHERE id=?').get(old.runId) as {revision:string|null};const factTask=old.kind==='factReview'&&p.factReview?beginFactReview(p,{requestId:input.requestId,version:p.projectVersion,claimIndices:p.factReview.claimIndices,cardIds:p.factReview.cardIds},old.runId):null;p.projectVersion++;p.status=old.kind==='export'?'approved':'working';const r=enqueue(p,old.kind,row.revision?JSON.parse(row.revision):null,old);if(factTask){factTask.reviewer=structuredClone(p.factReview?.reviewer??C.DEFAULT_FACT_REVIEWER);factTask.runId=r.runId;p.factReview=factTask;}save(p);return {status:202,body:{data:receipt(p,r)}};
    }
    if(name==='selection'){
     const input=v as C.SelectionRequest;must(input.version===p.researchVersion,'VERSION_CONFLICT',pid,p.researchVersion);must(p.stage==='selection'&&p.status==='ready'&&p.question?.status!=='open','STAGE_CONFLICT',pid);must(input.candidateIds.every(cid=>p.candidates.some(c=>c.candidateId===cid)),'VALIDATION_ERROR',pid);
     p.selectedCandidateIds=input.candidateIds;p.projectVersion++;p.stage='editorial';p.status='working';const r=enqueue(p,'editorial');save(p);return {status:202,body:{data:{...receipt(p,r),selectedCandidateIds:p.selectedCandidateIds}}};
    }
    if(name==='factReview'){
     const input=v as C.FactReviewRequest;must(input.version===p.projectVersion,'VERSION_CONFLICT',pid,p.projectVersion);
     let cp:C.FactCheckpoint|undefined,parent:C.Run|null=null;
     if(input.checkpointId){
      cp=checkpoint(pid,input.checkpointId);parent=run(input.resumeFromRunId!);
      must(cp.sourceRunId===input.resumeFromRunId&&parent.projectId===pid&&parent.kind==='factReview'&&p.factRecovery?.checkpointId===cp.checkpointId&&p.factRecovery.available,'FACT_PROPOSAL_STALE',pid);
      const review=p.factReview!;must(C.canonicalJson(input.claimIndices)===C.canonicalJson(review.claimIndices)&&C.canonicalJson(input.cardIds)===C.canonicalJson(review.cardIds),'FACT_SCOPE_INVALID',pid);
      // 재개는 저장된 선택이 정본입니다. 생략값을 새 요청 기본값으로 덮지 않습니다.
      if(input.reviewer!==undefined)must(input.reviewer===cp.reviewer.provider,'FACT_SCOPE_INVALID',pid);
      if(input.reviewEffort!==undefined)must(cp.reviewer.provider==='agy'&&cp.reviewer.model===`gemini-3.8-flash-${input.reviewEffort}`,'FACT_SCOPE_INVALID',pid);
     }
     const task=beginFactReview(p,input,id());if(cp)task.reviewer=structuredClone(cp.reviewer);p.projectVersion++;p.status='working';const r=enqueue(p,'factReview',null,parent);task.runId=r.runId;p.factReview=task;
     if(cp)db.prepare('INSERT INTO fact_checkpoint_jobs VALUES(?,?)').run(r.runId,cp.checkpointId);
     save(p);return {status:202,body:{data:receipt(p,r)}};
    }
    if(name==='factApply'){
     const input=v as C.FactApplyRequest;const reviewRun=p.factReview?run(p.factReview.runId):null;must(reviewRun&&reviewRun.projectId===pid&&reviewRun.kind==='factReview'&&reviewRun.status==='succeeded','FACT_PROPOSAL_STALE',pid);applyFactProposal(p,input);const r=p.result?enqueue(p,'factApply'):null;save(p);return {status:r?202:200,body:{data:receipt(p,r)}};
    }
    if(name==='rebuildExports'){
     const input=v as C.VersionRequest;must(input.version===p.projectVersion,'VERSION_CONFLICT',pid,p.projectVersion);must(p.result&&p.result.finalApprovedVersion===p.result.version,'FINAL_NOT_APPROVED',pid);must(p.stage==='export'&&p.result.cards.length>0&&p.result.cards.every(c=>c.state==='ready'),'STAGE_CONFLICT',pid);p.projectVersion++;p.status='approved';const r=enqueue(p,'export');save(p);return {status:202,body:{data:receipt(p,r)}};
    }
    if(name==='research'){
     const input=v as C.VersionRequest;must(input.version===p.projectVersion,'VERSION_CONFLICT',pid,p.projectVersion);must(['topic','selection'].includes(p.stage)&&!p.storyboard&&!p.result,'STAGE_CONFLICT',pid);
     const at=clock();p.period={days:p.period.days,anchorAt:at,to:at,from:new Date(Date.parse(at)-p.period.days*86400000).toISOString()};p.projectVersion++;p.stage='research';p.status='working';const r=enqueue(p,'research');save(p);return {status:202,body:{data:receipt(p,r)}};
    }
    if(name==='approve'){
     const input=v as C.ApproveRequest;p.projectVersion++;
     if(input.stage==='storyboard'){must(p.storyboard&&input.version===p.storyboard.version,'VERSION_CONFLICT',pid,p.storyboard?.version??null);must(p.stage==='storyboard'&&p.status==='ready'&&p.storyboard.size&&p.storyboard.cards.length,'STAGE_CONFLICT',pid);p.storyboard.approvedVersion=p.storyboard.version;p.stage='production';p.status='working';const r=enqueue(p,'production');save(p);return {status:202,body:{data:receipt(p,r)}};}
     must(p.result&&input.version===p.result.version,'VERSION_CONFLICT',pid,p.result?.version??null);
     if(input.acknowledgeWarnings===true){
      must(C.canManuallyApprove(p),'STAGE_CONFLICT',pid);
      // 조회용 파생 검사로 저장된 기계 판정을 덮어쓰지 않습니다.
      p.result.factsCheck=project(pid).result!.factsCheck;
      p.result.manualApproval={resultVersion:p.result.version,approvedAt:clock(),contentHash:semanticInputHash(buildSemanticReviewInput(p)),warningsAcknowledged:true};
     }else must(p.stage==='review'&&p.status==='ready'&&p.result.cards.length&&p.result.cards.every(c=>c.state==='ready')&&checkStoredFacts(p,p.result)==='passed'&&p.result.visualCheck==='passed','STAGE_CONFLICT',pid);
     p.result.finalApprovedVersion=p.result.version;for(const c of p.result.cards)c.approvedRevision=c.revision;p.stage='export';p.status='approved';const r=enqueue(p,'export');save(p);return {status:202,body:{data:{...receipt(p,r),finalApprovedVersion:p.result.version}}};
    }
    if(name==='cardApprove'){
     const input=v as C.CardApproveRequest;must(p.result&&input.resultVersion===p.result.version,'VERSION_CONFLICT',pid,p.result?.version??null);const card=p.result.cards.find(c=>c.cardId===target.cardId);must(card,'NOT_FOUND');must(card.revision===input.version,'VERSION_CONFLICT',pid,card.revision);must(card.state==='ready'&&p.stage==='review','STAGE_CONFLICT',pid);card.approvedRevision=card.revision;p.projectVersion++;save(p);return {status:200,body:{data:{projectId:pid,projectVersion:p.projectVersion,cardId:card.cardId,approvedRevision:card.revision}}};
    }
    if(name==='revisions'){
     const input=v as C.RevisionRequest;
     if(input.scope==='storyboard'){must(p.storyboard&&input.version===p.storyboard.version,'VERSION_CONFLICT',pid,p.storyboard?.version??null);must(p.stage==='storyboard'&&!p.result&&p.storyboard.cards.some(c=>input.cardIds.includes(c.cardId))&&input.cardIds.every(cid=>p.storyboard!.cards.some(c=>c.cardId===cid)),'STAGE_CONFLICT',pid);p.storyboard.approvedVersion=null;p.status='working';}
     else{
      must(p.result&&input.version===p.result.version,'VERSION_CONFLICT',pid,p.result?.version??null);
      must((['review','export'].includes(p.stage)&&p.result.cards.every(c=>c.state==='ready'))||(p.stage==='production'&&p.status==='error'&&['text','layout'].includes(input.scope)&&input.cardIds.every(cid=>p.result!.cards.some(c=>c.cardId===cid&&c.state==='failed'))),'STAGE_CONFLICT',pid);
      must(input.cardIds.every(cid=>p.result!.cards.some(c=>c.cardId===cid)),'VALIDATION_ERROR',pid);
      if(input.renderOnly)must(input.cardIds.every(cid=>p.result!.cards.find(c=>c.cardId===cid)?.imageAssetId),'ASSET_INVALID',pid);
      p.result.version++;p.result.finalApprovedVersion=null;delete p.result.manualApproval;p.result.factsCheck='pending';p.result.visualCheck='pending';p.exports=[];for(const c of p.result.cards)if(input.cardIds.includes(c.cardId)){c.revision++;c.state='pending';c.approvedRevision=null;c.previewAssetId=null;if(input.scope==='image')c.imageAssetId=null;c.error=null;}p.stage='production';p.status='working';
     }
     p.projectVersion++;const r=enqueue(p,'revision',input);save(p);return {status:202,body:{data:receipt(p,r)}};
    }
    throw new DomainError('STAGE_CONFLICT',pid);
   }) as C.HttpReply<C.ResponseByMutation[typeof name]>;
  },
  async getProject(pid){return get(pid);},async getRun(rid){return publicRun(run(rid));},
  async getEvents(pid,after,limit=100){project(pid);must(Number.isSafeInteger(after)&&after>=0,'VALIDATION_ERROR');const rows=db.prepare('SELECT payload FROM events WHERE project_id=? AND seq>? ORDER BY seq LIMIT ?').all(pid,after,Math.min(100,limit)+1) as Row[];const events=rows.slice(0,Math.min(100,limit)).map(r=>JSON.parse(r.payload) as C.EngineEvent);return {events,nextSeq:events.at(-1)?.seq??after,hasMore:rows.length>events.length};},
  async getExports(pid){const p=get(pid);must(p.result&&p.result.finalApprovedVersion===p.result.version,'FINAL_NOT_APPROVED',pid);for(const e of p.exports)await store.getDownload(pid,e.exportId);const current=project(pid);must(current.result?.version===p.result.version&&current.result.finalApprovedVersion===p.result.version,'EXPORT_STALE',pid);return {resultVersion:p.result.version,entries:p.exports,exportRun:p.lastRun?.kind==='export'?p.lastRun:null};},
  async getAsset(pid,aid){project(pid);const a=parse<C.VerifiedAsset>(db.prepare('SELECT payload FROM assets WHERE project_id=? AND id=?').get(pid,aid) as Row|undefined);must(['image','preview'].includes(a.kind),'NOT_FOUND');const retained=(db.prepare('SELECT payload FROM history WHERE project_id=? UNION ALL SELECT payload FROM projects WHERE id=?').all(pid,pid) as Row[]).some(row=>(JSON.parse(row.payload) as C.ProjectSnapshot).result?.cards.some(c=>c.imageAssetId===aid||c.previewAssetId===aid));must(retained,'NOT_FOUND');return verifyAsset(resolve(options.dataDir,'projects',pid),a);},
  async getDownload(pid,eid){const p=get(pid);const row=db.prepare('SELECT * FROM exports WHERE project_id=? AND id=?').get(pid,eid) as {result_version:number;asset_id:string}|undefined;must(row,'NOT_FOUND');must(p.result&&p.result.version===row.result_version&&p.result.finalApprovedVersion===p.result.version,'EXPORT_STALE',pid);const a=parse<C.VerifiedAsset>(db.prepare('SELECT payload FROM assets WHERE project_id=? AND id=?').get(pid,row.asset_id) as Row|undefined);const verified=await verifyAsset(resolve(options.dataDir,'projects',pid),a);const current=project(pid);must(current.result?.version===row.result_version&&current.result.finalApprovedVersion===row.result_version,'EXPORT_STALE',pid);return verified;},
  async claimJob(input){must(input.dataMode===options.dataMode,'STAGE_CONFLICT');const claimed=db.transaction(()=>{
   if(db.prepare("SELECT id FROM runs WHERE status IN ('running','waiting_for_user','cancel_requested') AND owner IS NOT NULL LIMIT 1").get())return null;
   const row=db.prepare("SELECT * FROM runs WHERE (status='queued' OR (status='cancel_requested' AND owner IS NULL)) AND NOT EXISTS (SELECT 1 FROM project_deletions d WHERE d.project_id=runs.project_id) ORDER BY rowid LIMIT 1").get() as {id:string;fence:number;revision:string|null;parent_id:string|null}|undefined;if(!row)return null;
   const r=run(row.id),p=get(r.projectId);if(r.status!=='cancel_requested')r.status='running';r.updatedAt=input.now;saveRun(r);const leaseUntil=new Date(Date.parse(input.now)+input.leaseMs).toISOString();
   db.prepare('UPDATE runs SET owner=?,lease_until=?,fence=fence+1 WHERE id=?').run(input.ownerId,leaseUntil,r.runId);
   const fence:C.LeaseFence={projectId:r.projectId,runId:r.runId,ownerId:input.ownerId,attempt:r.attempt,fencingToken:row.fence+1,baseProjectVersion:p.projectVersion};
   const attemptDir=resolve(options.dataDir,'projects',p.projectId,'attempts',r.runId,String(r.attempt));
   // 읽기 전용 기획의 도구/결과 저장 실패 재시도는 새 turn이며 죽은 callback 복원이 아닙니다.
   // Retain parent/session/history for audit; all other retries keep the recovery gate.
   const parent=row.parent_id?run(row.parent_id):null;
   const readOnlyPlanning=r.kind==='editorial'||r.kind==='revision'&&row.revision!==null&&JSON.parse(row.revision).scope==='storyboard';
   const freshEditorialRetry=readOnlyPlanning&&parent?.projectId===r.projectId&&parent.kind===r.kind&&retryPolicy(parent,p).fresh;
   const freshResearchRetry=r.kind==='research'&&parent!==null&&researchRetry(parent,p).fresh;
   const resumeRow=db.prepare('SELECT checkpoint_id FROM fact_checkpoint_jobs WHERE run_id=?').get(r.runId) as {checkpoint_id:string}|undefined;
   const factCheckpoint=resumeRow?checkpoint(p.projectId,resumeRow.checkpoint_id):undefined;
   if(factCheckpoint)must(checkpointMatches(factCheckpoint,p),'FACT_PROPOSAL_STALE',p.projectId);
   const savedSession=factCheckpoint||freshEditorialRetry||freshResearchRetry?undefined:db.prepare('WITH RECURSIVE lineage(id,depth) AS (VALUES(?,0) UNION ALL SELECT r.parent_id,l.depth+1 FROM runs r JOIN lineage l ON r.id=l.id WHERE r.parent_id IS NOT NULL AND r.project_id=? AND l.depth<1000) SELECT s.session_id,s.cwd FROM lineage l JOIN sessions s ON s.run_id=l.id WHERE s.project_id=? ORDER BY l.depth LIMIT 1').get(r.runId,p.projectId,p.projectId) as {session_id:string;cwd:string}|undefined;
   const context:C.EngineContext|null=['research','editorial','revision','factReview'].includes(r.kind)?{projectId:p.projectId,runId:r.runId,attempt:r.attempt,engine:'claude-agent-sdk',engineSessionId:savedSession?.session_id??null,cwd:savedSession?.cwd??resolve(options.dataDir,'projects',p.projectId,'engine'),phase:r.kind as C.EngineContext['phase'],baseProjectVersion:p.projectVersion,requestedModel:r.requestedModel??null}:null;
   return {fence,leaseUntil,run:r,snapshot:get(p.projectId),context,...(factCheckpoint?{factCheckpoint}:{}),revision:row.revision?JSON.parse(row.revision):null,attemptDir};
  }).immediate();if(claimed){await mkdir(claimed.attemptDir,{recursive:true});if(claimed.context)await mkdir(claimed.context.cwd,{recursive:true});}return claimed;},async heartbeat(f,input){return db.transaction(()=>{try{check(f,true,true);}catch(e){if(e instanceof DomainError)return false;throw e;}db.prepare('UPDATE runs SET lease_until=? WHERE id=?').run(new Date(Date.parse(input.now)+input.leaseMs).toISOString(),f.runId);return true;}).immediate();},async isCancelRequested(f){try{return check(f,true,true).r.status==='cancel_requested';}catch{return true;}},async appendEvent(f,draft){return db.transaction(()=>{const {r}=check(f);return event(r,draft);}).immediate();},
  async saveQuestion(f,input,mapping){const q=C.QuestionSchema.parse(input);return db.transaction(()=>{const {r,p}=check(f);must(q.runId===r.runId&&q.status==='open'&&q.kind==='editorial'&&['editorial','revision'].includes(r.kind)&&p.question?.status!=='open','STAGE_CONFLICT',p.projectId);db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?)').run(p.projectId,q.questionId,q.version,q.status,JSON.stringify(q),mapping?JSON.stringify(mapping):null);p.question=q;p.status='waiting_for_user';r.status='waiting_for_user';r.questionId=q.questionId;saveRun(r);const fence=advance(f,p);return {fence,event:event(r,{type:'need_input',question:q})};}).immediate();},
  async readAnswer(f,qid,version){return db.transaction(()=>{const {r,p,row}=check(f,false,true);must(p.question?.questionId===qid&&p.question.version===version&&r.questionId===qid,'QUESTION_STALE',p.projectId);const a=db.prepare('SELECT * FROM answers WHERE project_id=? AND question_id=? AND version=?').get(p.projectId,qid,version) as {payload:string;base_before:number;base_after:number;delivered_attempt:number|null}|undefined;if(!a)return null;must((f.baseProjectVersion===a.base_before||f.baseProjectVersion===a.base_after)&&p.projectVersion===a.base_after&&(row.base_version===a.base_before||row.base_version===a.base_after),'VERSION_CONFLICT',p.projectId);if(a.delivered_attempt!==null)return null;db.prepare('UPDATE runs SET base_version=? WHERE id=?').run(a.base_after,r.runId);return {answer:JSON.parse(a.payload),fence:{...f,baseProjectVersion:a.base_after}};}).immediate();},
  async markAnswerDelivered(f,qid,version){return db.transaction(()=>{const {p,r}=check(f);must(r.questionId===qid&&p.question?.questionId===qid&&p.question.version===version&&p.question.status==='answered','QUESTION_STALE',f.projectId);const result=db.prepare('UPDATE answers SET delivered_attempt=? WHERE project_id=? AND question_id=? AND version=? AND delivered_attempt IS NULL').run(f.attempt,f.projectId,qid,version);must(result.changes===1,'QUESTION_STALE',f.projectId);return f;}).immediate();},async saveSession(f,sessionId,cwd){db.transaction(()=>{check(f);must(sessionId.length>0&&resolve(cwd)===resolve(options.dataDir,'projects',f.projectId,'engine'),'STAGE_CONFLICT',f.projectId);const old=db.prepare('SELECT * FROM sessions WHERE session_id=?').get(sessionId) as {project_id:string}|undefined;must(!old||old.project_id===f.projectId,'STAGE_CONFLICT',f.projectId);const existing=db.prepare('SELECT session_id FROM sessions WHERE run_id=?').get(f.runId) as {session_id:string}|undefined;must(!existing||existing.session_id===sessionId,'STAGE_CONFLICT',f.projectId);db.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?)').run(sessionId,f.projectId,f.runId,cwd);}).immediate();},
  async journal(f,mark){db.transaction(()=>{const {r}=check(f);must(mark.phase!=='terminal_commit','VALIDATION_ERROR');must(['prepared','started','output_observed','validated','committed'].includes(mark.state),'VALIDATION_ERROR');db.prepare('INSERT INTO invocations VALUES(?,?,?)').run(f.runId,f.attempt,JSON.stringify(mark));if(mark.state==='started'){r.externalOutcome='unknown';saveRun(r);}}).immediate();},async commit(f,result){
   const assets=result.type==='production'||result.type==='exports'?result.assets:[];
   for(const a of assets){must(a.projectId===f.projectId&&a.runId===f.runId&&a.attempt===f.attempt,'ASSET_INVALID',f.projectId);await verifyAsset(resolve(options.dataDir,'projects',f.projectId,'attempts',f.runId,String(f.attempt)),a);}
   return db.transaction(()=>{const {r,p,row}=check(f,result.type==='canceled'||result.type==='failure',result.type==='canceled'||result.type==='failure');
    if(result.type==='canceled'||result.type==='failure'){
     if(result.type==='canceled'){must(r.status==='cancel_requested'&&result.cleanupConfirmed,'STAGE_CONFLICT');r.status='canceled';r.retryAllowed=true;p.status='canceled';}
     else{r.error=C.AppErrorSchema.parse(result.error);r.externalOutcome=result.externalOutcome;r.retryAllowed=result.retryAllowed;r.status=r.status==='cancel_requested'&&result.error.code==='CANCEL_CLEANUP_FAILED'?'cancel_requested':'failed';p.status='error';}
     if(p.question?.status==='open'){p.question.status='canceled';db.prepare('UPDATE questions SET status=?,payload=? WHERE project_id=? AND id=? AND version=?').run('canceled',JSON.stringify(p.question),p.projectId,p.question.questionId,p.question.version);}saveRun(r);const fence=advance(f,p);recordTerminal(r);return {fence,event:result.type==='failure'?event(r,{type:'error',error:r.error!}):event(r,{type:'progress',phase:'canceled',message:'소유 실행 정리를 확인했습니다.',completed:null,total:null})};
    }
    const revision:C.RevisionRequest|null=row.revision?JSON.parse(row.revision):null;
    for(const a of assets)db.prepare('INSERT INTO assets VALUES(?,?,?,?)').run(a.assetId,a.projectId,a.absolutePath,JSON.stringify(a));
    let draft:C.EventDraft|null=null;
    if(result.type==='production'&&r.kind==='factApply')must(p.factReview?.state==='applied'&&p.result&&result.result.cards.every(c=>p.result!.cards.some(old=>old.cardId===c.cardId&&old.imageAssetId===c.imageAssetId)),'ASSET_INVALID',p.projectId);
    if(result.type==='content'){
     const content=result.content;
     if(content.kind==='factReview'){
      must(r.kind==='factReview','FACT_SCOPE_INVALID',p.projectId);saveFactProposal(p,r.runId,content);p.status=p.result&&p.result.finalApprovedVersion===p.result.version?'approved':'ready';draft={type:'result',kind:'factReview',version:p.projectVersion+1};
     }else if(content.kind==='candidates'){
      must(r.kind==='research'&&content.researchVersion===p.researchVersion+1,'STAGE_CONFLICT',p.projectId);p.researchVersion=content.researchVersion;p.candidates=content.candidates.map(c=>C.CandidateSchema.parse(c));p.sources=content.sources.map(s=>C.SourceSchema.parse(s));p.selectedCandidateIds=[];p.claims=[];p.stage='selection';p.status='ready';draft={type:'result',kind:'candidates',version:p.researchVersion};
     }else if(content.kind==='storyboard'){
      must(r.kind==='editorial'||(r.kind==='revision'&&revision?.scope==='storyboard'),'STAGE_CONFLICT',p.projectId);const board=C.StoryboardSchema.parse(content.storyboard);must(board.version===(p.storyboard?.version??0)+1&&board.approvedVersion===null,'VERSION_CONFLICT',p.projectId);if(revision){must(p.storyboard&&board.size===p.storyboard.size&&board.cards.length===p.storyboard.cards.length&&p.storyboard.cards.every(old=>{const next=board.cards.find(c=>c.cardId===old.cardId);return next&&(revision.cardIds.includes(old.cardId)||C.canonicalJson(old)===C.canonicalJson(next));}),'STAGE_CONFLICT',p.projectId);}
      // 기획은 선택 소식의 근거만 반환합니다. 미선택 조사 후보의 출처까지 지우면 snapshot 참조가 끊어집니다.
      const sources=new Map(p.sources.map(s=>[s.sourceId,s]));
      for(const raw of content.sources){const source=C.SourceSchema.parse(raw),old=sources.get(source.sourceId);must(!old||old.candidateId===source.candidateId,'STAGE_CONFLICT',p.projectId);sources.set(source.sourceId,source);}
      p.storyboard=board;p.sources=[...sources.values()];p.claims=content.claims.map(c=>C.ClaimSchema.parse(c));p.stage='storyboard';p.status='ready';draft={type:'result',kind:'storyboard',version:board.version};
     }else{must(r.kind==='revision'&&revision?.scope!=='storyboard'&&p.result,'STAGE_CONFLICT',p.projectId);const cards=content.cards.map(c=>C.CardRevisionSchema.parse(c));must(cards.every(c=>revision!.cardIds.includes(c.cardId))&&cards.length===revision!.cardIds.length,'STAGE_CONFLICT',p.projectId);for(const c of cards){const old=p.result.cards.find(x=>x.cardId===c.cardId)!;must(old&&c.revision===old.revision&&c.approvedRevision===null&&(revision!.scope==='image'||c.imageAssetId===old.imageAssetId),'VERSION_CONFLICT',p.projectId);p.result.cards[p.result.cards.indexOf(old)]={...c};checkRevisionFields(old,c,revision!.scope);if(revision!.scope==='layout')must(c.layout&&C.canonicalJson(c.layout)!==C.canonicalJson(old.layout??{fontScale:'normal',textAlign:'left',placement:'bottom'}),'STAGE_CONFLICT',p.projectId,p.projectVersion,'LAYOUT_CHANGE_REQUIRED');must(c.state===old.state&&c.imageAssetId===old.imageAssetId&&c.previewAssetId===old.previewAssetId,'STAGE_CONFLICT');}p.result.factsCheck=content.factsCheck;p.result.visualCheck=content.visualCheck;p.status='working';}
    }else if(result.type==='production'){
     must(r.kind==='production'||r.kind==='factApply'||(r.kind==='revision'&&revision?.scope!=='storyboard'),'STAGE_CONFLICT',p.projectId);const next=C.ResultVersionSchema.parse(result.result);must(p.storyboard&&p.storyboard.approvedVersion===p.storyboard.version&&next.storyboardVersion===p.storyboard.version&&next.size===p.storyboard.size&&next.finalApprovedVersion===null,'STAGE_CONFLICT',p.projectId);
     if(p.result){must(next.version===p.result.version&&next.cards.length===p.result.cards.length,'VERSION_CONFLICT',p.projectId);for(const old of p.result.cards){const c=next.cards.find(c=>c.cardId===old.cardId);must(c,'STAGE_CONFLICT');if(!(r.kind==='production'&&old.state!=='ready')&&!(r.kind==='factApply'&&p.factReview?.state==='applied'&&p.factReview.proposal?.cards.some(patch=>patch.cardId===old.cardId))&&!revision?.cardIds.includes(old.cardId))must(C.canonicalJson(old)===C.canonicalJson(c),'STAGE_CONFLICT',p.projectId);else {must(C.canonicalJson(c.layout??null)===C.canonicalJson(old.layout??null),'STAGE_CONFLICT',p.projectId);must(c.revision===old.revision&&c.approvedRevision===null&&(!revision||revision.scope==='image'||c.imageAssetId===old.imageAssetId),'STAGE_CONFLICT',p.projectId);if(revision)checkRevisionFields(old,c,revision.scope);else must(['cardId','order','role','title','body','sourceIds','imagePlan'].every(k=>C.canonicalJson(old[k as keyof C.CardRevision])===C.canonicalJson(c[k as keyof C.CardRevision])),'STAGE_CONFLICT',p.projectId);}}}
     else{must(next.version===1&&next.cards.length===p.storyboard.cards.length&&next.cards.every(c=>c.revision===1&&p.storyboard!.cards.some(plan=>plan.cardId===c.cardId&&C.canonicalJson(plan)===C.canonicalJson(Object.fromEntries(Object.entries(c).filter(([k])=>['cardId','order','role','title','body','sourceIds','imagePlan'].includes(k)))))),'STAGE_CONFLICT',p.projectId);}
     for(const c of next.cards){if(c.state==='ready')must(c.imageAssetId&&c.previewAssetId,'ASSET_INVALID',p.projectId);for(const [aid,kind]of [[c.imageAssetId,'image'],[c.previewAssetId,'preview']]){if(!aid)continue;const a=parse<C.VerifiedAsset>(db.prepare('SELECT payload FROM assets WHERE id=? AND project_id=?').get(aid,p.projectId) as Row|undefined);must(a.kind===kind,'ASSET_INVALID',p.projectId);if(kind==='preview')must(a.width===1080&&a.height===(next.size==='1080x1080'?1080:1350),'ASSET_INVALID',p.projectId);}}
     next.factsCheck=checkStoredFacts(p,next);p.result=next;p.stage=next.cards.every(c=>c.state==='ready')?'review':'production';p.status=p.stage==='review'?'ready':'working';draft={type:'result',kind:'cards',version:next.version};
    }else if(result.type==='exports'){
     must(r.kind==='export'&&p.result&&p.result.version===result.resultVersion&&p.result.finalApprovedVersion===p.result.version,'EXPORT_STALE',p.projectId);const entries=result.entries.map(e=>C.ExportEntrySchema.parse(e));must(entries.length===p.result.cards.length+4&&new Set(entries.map(e=>e.exportId)).size===entries.length&&new Set(entries.map(e=>e.filename)).size===entries.length&&entries.filter(e=>e.kind==='zip').length===1&&entries.filter(e=>e.kind==='records'&&e.mimeType==='application/json').length===2&&entries.filter(e=>e.kind==='records'&&e.mimeType==='text/plain').length===1&&p.result.cards.every(c=>entries.filter(e=>e.kind==='png'&&e.cardId===c.cardId&&e.cardRevision===c.revision).length===1),'ASSET_INVALID');
     for(const e of entries){must(e.projectId===p.projectId&&e.resultVersion===p.result.version&&safeFilename(e.filename)&&e.downloadUrl===`/api/projects/${p.projectId}/exports/${e.exportId}/download`,'ASSET_INVALID');let a:C.VerifiedAsset|undefined;
      if(e.kind==='png'){const card=p.result.cards.find(c=>c.cardId===e.cardId&&c.revision===e.cardRevision);must(card?.previewAssetId,'ASSET_INVALID');const original=parse<C.VerifiedAsset>(db.prepare('SELECT payload FROM assets WHERE id=? AND project_id=?').get(card.previewAssetId,p.projectId) as Row|undefined);must(original.sha256===e.sha256&&original.bytes===e.bytes,'ASSET_INVALID');}
      else must(e.cardId===null&&e.cardRevision===null&&(e.kind!=='zip'||e.mimeType==='application/zip'),'ASSET_INVALID');
      a=assets.find(a=>a.assetId===e.exportId)??assets.find(a=>a.sha256===e.sha256&&a.kind==='export');
      must(a&&a.kind==='export'&&a.sha256===e.sha256&&a.bytes===e.bytes&&a.mimeType===e.mimeType,'ASSET_INVALID');db.prepare('INSERT INTO exports VALUES(?,?,?,?,?)').run(e.exportId,p.projectId,p.result.version,a.assetId,JSON.stringify(e));}
     p.exports=entries;p.status='approved';draft={type:'result',kind:'exports',version:p.result.version};
    }else throw new DomainError('STAGE_CONFLICT',p.projectId);
    if(result.type==='content'&&result.content.kind==='candidates'&&result.content.shortageReason!==null&&p.period.days===7){const q=appQuestion('period_expansion',r.runId,result.content.shortageReason);insertQuestion(p,q);r.status='waiting_for_user';r.questionId=q.questionId;p.stage='research';p.status='waiting_for_user';db.prepare('UPDATE runs SET owner=NULL,lease_until=NULL,fence=fence+1 WHERE id=?').run(r.runId);}
    else{r.status=(result.type==='content'&&result.content.kind==='cards')||(result.type==='production'&&p.stage==='production')?'running':'succeeded';if(result.type==='content'&&result.content.kind==='cards')draft={type:'result',kind:'cards',version:p.result!.version};if(result.type==='content'&&result.content.kind==='storyboard'&&p.storyboard?.size===null){const q=appQuestion('output_size',null,'출력 크기를 선택해 주세요.');insertQuestion(p,q);p.status='waiting_for_user';}}
    r.externalOutcome='known';saveRun(r);const fence=advance(f,p);get(p.projectId);recordTerminal(r);const published=draft?event(r,draft):null;if(p.question?.status==='open'&&p.question.kind!=='editorial')event(r,{type:'need_input',question:p.question});return {fence,event:published};
   }).immediate();},async reconcile(input){return db.transaction(()=>{const interruptedRunIds:string[]=[];const rows=db.prepare("SELECT id FROM runs WHERE status IN ('running','waiting_for_user','cancel_requested') AND owner IS NOT NULL AND lease_until<=? AND NOT EXISTS (SELECT 1 FROM project_deletions d WHERE d.project_id=runs.project_id)").all(input.now) as {id:string}[];
    for(const row of rows){const r=run(row.id),p=project(r.projectId);r.status='interrupted';r.updatedAt=input.now;r.retryAllowed=true;const journals=db.prepare('SELECT payload FROM invocations WHERE run_id=?').all(r.runId) as Row[];if(journals.some(j=>JSON.parse(j.payload).state==='started')||r.questionId)r.externalOutcome='unknown';r.error=new DomainError(r.questionId?'SESSION_RECOVERY_UNVERIFIED':r.externalOutcome==='unknown'?'EXTERNAL_OUTCOME_UNKNOWN':'VERSION_CONFLICT',p.projectId,p.projectVersion,undefined,r.runId).error;saveRun(r);db.prepare('UPDATE runs SET fence=fence+1,owner=NULL,lease_until=NULL WHERE id=?').run(r.runId);p.status='interrupted';if(p.question?.status==='open'){p.question.status='superseded';db.prepare('UPDATE questions SET status=?,payload=? WHERE project_id=? AND id=? AND version=?').run('superseded',JSON.stringify(p.question),p.projectId,p.question.questionId,p.question.version);}p.projectVersion++;save(p);event(r,{type:'error',error:r.error});interruptedRunIds.push(r.runId);}
    const referenced=new Set<string>();for(const row of db.prepare('SELECT payload FROM history UNION ALL SELECT payload FROM projects').all() as Row[]){const snapshot=JSON.parse(row.payload) as C.ProjectSnapshot;for(const card of snapshot.result?.cards??[]){if(card.imageAssetId)referenced.add(card.imageAssetId);if(card.previewAssetId)referenced.add(card.previewAssetId);}}
    for(const e of db.prepare('SELECT asset_id FROM exports').all() as {asset_id:string}[])referenced.add(e.asset_id);
    const orphanAssetIds=(db.prepare('SELECT id FROM assets').all() as {id:string}[]).map(a=>a.id).filter(a=>!referenced.has(a));
    return {interruptedRunIds,orphanAssetIds};}).immediate();},async close(){db.close();}
 };return store;
};
