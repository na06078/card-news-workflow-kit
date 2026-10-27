import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {review} from './도움.js';
import {buildSemanticReviewInput,semanticInputHash} from '../../src/providers/검수내용.js';
import {syntheticReport} from './의미검수대역.js';
import type * as C from '../../src/shared/포트.js';
import {applyFactProposal,beginFactReview,saveFactProposal} from '../../src/backend/사실복구.js';
import {draft,reviewed} from './의미검수대역.js';
import {createWorkerHealth} from '../../src/backend/실행상태.js';

function edit(path:string,pid:string,fn:(p:C.ProjectSnapshot)=>void){const db=new Database(path);try{const p=JSON.parse((db.prepare('SELECT payload FROM projects WHERE id=?').get(pid) as {payload:string}).payload);fn(p);db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),pid);}finally{db.close();}}
test.each(['failed','pending','missing','stale','unsupported'] as const)('명시 확인 %s: 판정 보존·현재 해시·단일 export',async mode=>{
 const {s,target,options}=await review();try{
  edit(options.dbPath,target.projectId,p=>{p.result!.factsCheck=mode==='pending'?'pending':'failed';if(mode!=='missing'){p.result!.semanticReview=syntheticReport(buildSemanticReviewInput(p),undefined,'unsupported');if(mode==='stale')p.result!.semanticReview.inputHash='0'.repeat(64);}});
  const before=await s.getProject(target.projectId);const db=new Database(options.dbPath);const stored=JSON.parse((db.prepare('SELECT payload FROM projects WHERE id=?').get(target.projectId) as {payload:string}).payload) as C.ProjectSnapshot;db.close();
  const input={requestId:randomUUID(),stage:'final' as const,version:before.result!.version,acknowledgeWarnings:true as const};
  const out=await s.mutate('approve',target,input);expect(out.status).toBe(202);
  const after=await s.getProject(target.projectId);expect(after.result!.factsCheck).toBe(stored.result!.factsCheck);expect(after.result!.semanticReview).toEqual(stored.result!.semanticReview);expect(after.sources).toEqual(before.sources);expect(after.claims).toEqual(before.claims);
  expect(before.allowedActions).toContain('approve_final');expect(after.result!.manualApproval).toEqual({resultVersion:before.result!.version,approvedAt:expect.stringMatching(/Z$/),contentHash:semanticInputHash(buildSemanticReviewInput(before)),warningsAcknowledged:true});
  expect(after.result!.finalApprovedVersion).toBe(before.result!.version);expect(after.activeRun!.kind).toBe('export');expect(after.result!.cards.every(c=>c.approvedRevision===c.revision)).toBe(true);
  expect((await s.mutate('approve',target,input)).replayed).toBe(true);expect((await s.getProject(target.projectId)).activeRun!.runId).toBe(after.activeRun!.runId);
 }finally{await s.close();}
});
test.each(['no_ack','stale','active','failed_card','visual','question','worker'] as const)('직접 확인도 %s 경계를 우회하지 않는다',async mode=>{
 const {s,target,options}=await review();try{
  if(mode==='active'){const p=await s.getProject(target.projectId);expect((await s.mutate('revisions',target,{requestId:randomUUID(),version:p.result!.version,scope:'layout',cardIds:[p.result!.cards[0].cardId],instruction:'합성 배치 수정',renderOnly:true})).status).toBe(202);}
  if(mode==='failed_card'||mode==='visual'||mode==='question')edit(options.dbPath,target.projectId,p=>{if(mode==='failed_card')p.result!.cards[0].state='failed';if(mode==='visual')p.result!.visualCheck='pending';if(mode==='question')p.question={questionId:randomUUID(),version:1,runId:null,kind:'output_size',status:'open',createdAt:new Date().toISOString(),items:[{itemId:'size',text:'크기',header:'크기',multiSelect:false,allowFreeText:false,recommendedOptionId:null,recommendationReason:null,options:[{optionId:'1080x1080',label:'정사각형',description:'정사각형'},{optionId:'1080x1350',label:'세로형',description:'세로형'}]}]};});
  if(mode==='worker')expect(createWorkerHealth(options.dataDir,randomUUID(),()=>new Date().toISOString()).update('unavailable','WORKER_UNAVAILABLE')).toBe(true);
  const before=await s.getProject(target.projectId);const out=await s.mutate('approve',target,{requestId:randomUUID(),stage:'final',version:mode==='stale'?99:before.result!.version,...(mode==='no_ack'?{}:{acknowledgeWarnings:true})});
  expect(out.status).toBe(mode==='worker'?503:409);expect('error'in out.body&&out.body.error.code).toBe(mode==='active'?'RUN_ACTIVE':mode==='stale'?'VERSION_CONFLICT':mode==='worker'?'WORKER_UNAVAILABLE':'STAGE_CONFLICT');const after=await s.getProject(target.projectId);expect(after.projectVersion).toBe(before.projectVersion);expect(after.result).toEqual(before.result);expect(after.activeRun).toEqual(before.activeRun);
 }finally{await s.close();}
});
test('수정 접수는 proof 제거·과거 승인 이력 보존',async()=>{
 const {s,target,claim,options}=await review();try{
  let p=await s.getProject(target.projectId);await s.mutate('approve',target,{requestId:randomUUID(),stage:'final',version:p.result!.version,acknowledgeWarnings:true});p=await s.getProject(target.projectId);const approvedVersion=p.projectVersion,proof=p.result!.manualApproval;
  const fail=async()=>{const job=await claim();await s.commit(job.fence,{type:'failure',error:{code:'EXPORT_FAILED',message:'합성 내보내기 실패',retryable:true,nextActions:[],projectId:p.projectId,runId:job.run.runId,currentVersion:null,details:{}},externalOutcome:'not_started',retryAllowed:true});};
  await fail();p=await s.getProject(target.projectId);expect((await s.mutate('rebuildExports',target,{requestId:randomUUID(),version:p.projectVersion})).status).toBe(202);expect((await s.getProject(target.projectId)).result!.manualApproval).toEqual(proof);
  await fail();p=await s.getProject(target.projectId);expect((await s.mutate('revisions',target,{requestId:randomUUID(),version:p.result!.version,scope:'layout',cardIds:[p.result!.cards[0].cardId],instruction:'배치 수정',renderOnly:true})).status).toBe(202);
  const after=await s.getProject(target.projectId);expect(after.result!.manualApproval).toBeUndefined();expect(after.result!.finalApprovedVersion).toBeNull();
  const db=new Database(options.dbPath);try{const old=JSON.parse((db.prepare('SELECT payload FROM history WHERE project_id=? AND version=?').get(target.projectId,approvedVersion) as {payload:string}).payload);expect(old.result.manualApproval).toEqual(proof);}finally{db.close();}
 }finally{await s.close();}
});
test('사실 제안만 저장하면 proof 보존, 사용자 적용 시 제거',async()=>{
 const {s,target}=await review();try{
  let p=await s.getProject(target.projectId);await s.mutate('approve',target,{requestId:randomUUID(),stage:'final',version:p.result!.version,acknowledgeWarnings:true});p=await s.getProject(target.projectId);p.activeRun=null;p.claims=[{text:'합성 원고',kind:'uncertain',sourceIds:[p.sources[0].sourceId],availability:'unknown',conditions:[]}];
  const runId=randomUUID();p.factReview=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.result!.cards[0].cardId]},runId);const proof=structuredClone(p.result!.manualApproval);
  saveFactProposal(p,runId,reviewed(p,draft(p)));expect(p.result!.manualApproval).toEqual(proof);p.projectVersion++;
  applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:runId});expect(p.result!.manualApproval).toBeUndefined();expect(p.result!.finalApprovedVersion).toBeNull();
 }finally{await s.close();}
});