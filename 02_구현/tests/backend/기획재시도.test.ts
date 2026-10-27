import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createStore} from '../../src/backend/저장소.js';
import {DomainError} from '../../src/backend/도메인.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {assertRecoverySupported} from '../../src/worker/복구.js';

const at='2026-10-23T00:00:00.000Z';
async function setup(kind:'research'|'editorial'|'plan_revision'='editorial'){
 const dataDir=await mkdtemp(resolve(process.env.TMPDIR??resolve(process.env.LOCALAPPDATA!,'hermes/cache/scratch'),'기획재시도-'));
 const options={dataDir,dbPath:resolve(dataDir,'검사.sqlite'),dataMode:'mock' as const,clock:()=>at};
 let s=await createStore(options);
 const c=await s.createProject({topic:'격리된 기획 재시도',createRequestId:randomUUID()});
 if(!('data' in c.body))throw Error('create');
 const target={projectId:c.body.data.projectId};
 const claim=async()=>{const j=await s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'});if(!j)throw Error('claim');return j;};
 await s.mutate('research',target,{version:1,requestId:randomUUID()});
 const fixture=createMockSnapshot('selection');
 if(kind!=='research'){
 const research=await claim();
 await s.commit(research.fence,{type:'content',content:{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null}});
 await s.mutate('selection',target,{version:1,requestId:randomUUID(),candidateIds:[fixture.candidates[0]!.candidateId]});
 }
 let j=await claim();
 if(kind==='plan_revision'){
  const board={...createMockSnapshot('storyboard').storyboard!,size:'1080x1080' as const};
  await s.commit(j.fence,{type:'content',content:{kind:'storyboard',storyboard:board,sources:fixture.sources,claims:[]}});
  await s.mutate('revisions',target,{version:board.version,scope:'storyboard',cardIds:[board.cards[0].cardId],instruction:'격리된 계획 수정',requestId:randomUUID()});
  j=await claim();
 }
 await s.saveSession(j.fence,'과거-검증안된-세션',j.context!.cwd);
 return {get s(){return s;},options,target,j,claim,restart:async()=>{await s.close();s=await createStore(options);},close:async()=>{await s.close();await rm(dataDir,{recursive:true,force:true});}};
}

test.each(['TOOL_PERMISSION_DENIED','PROVIDER_PROTOCOL_ERROR'] as const)('저장된 질문 없는 기획 %s 실패의 명시 재시도는 세션 없이 같은 선택 자료로 시도 2를 시작한다',async code=>{
 const f=await setup();try{
  await f.s.commit(f.j.fence,{type:'failure',error:new DomainError(code,f.target.projectId,null,'읽기 전용 기획 실패',f.j.run.runId).error,externalOutcome:'unknown',retryAllowed:true});
  const old=await f.s.getRun(f.j.run.runId),before=await f.s.getProject(f.target.projectId),events=await f.s.getEvents(f.target.projectId,0);
  expect(old).toMatchObject({status:'failed',kind:'editorial',questionId:null,retryAllowed:true,externalOutcome:'unknown'});
  await f.restart();
  const target={...f.target,runId:old.runId};
  const stale=await f.s.mutate('retry',target,{requestId:randomUUID(),version:before.projectVersion-1,confirmUnknownOutcome:true});
  expect(stale).toMatchObject({status:409,body:{error:{code:'VERSION_CONFLICT'}}});
  const unchecked=await f.s.mutate('retry',target,{requestId:randomUUID(),version:before.projectVersion});
  expect(unchecked).toMatchObject({status:409,body:{error:{code:'EXTERNAL_OUTCOME_UNKNOWN'}}});
  const input={requestId:randomUUID(),version:before.projectVersion,confirmUnknownOutcome:true};
  const accepted=await f.s.mutate('retry',target,input);expect(accepted.status).toBe(202);
  const replay=await f.s.mutate('retry',target,input);expect(replay.replayed).toBe(true);expect(replay.body).toEqual(accepted.body);
  const next=await f.claim();
  expect(next.run).toMatchObject({attempt:2,kind:'editorial',status:'running',questionId:null});expect(next.run.runId).not.toBe(old.runId);
  expect(next.snapshot.selectedCandidateIds).toEqual(before.selectedCandidateIds);
  for(const key of ['topic','period','researchVersion','candidates','sources','claims','storyboard'] as const)expect(next.snapshot[key]).toEqual(before[key]);
  expect(next.context).toMatchObject({engineSessionId:null,cwd:resolve(f.options.dataDir,'projects',f.target.projectId,'engine'),baseProjectVersion:before.projectVersion+1});
  expect(()=>assertRecoverySupported(next.context!,next.fence)).not.toThrow();
  expect(await f.s.getRun(old.runId)).toEqual(old);
  expect((await f.s.getEvents(f.target.projectId,0)).events.slice(0,events.events.length)).toEqual(events.events);
  const db=new Database(f.options.dbPath,{readonly:true});try{
   expect(db.prepare('SELECT parent_id FROM runs WHERE id=?').get(next.run.runId)).toEqual({parent_id:old.runId});
   expect(db.prepare('SELECT session_id,run_id,cwd FROM sessions').all()).toEqual([{session_id:'과거-검증안된-세션',run_id:old.runId,cwd:f.j.context!.cwd}]);
   const history=db.prepare('SELECT payload FROM history WHERE project_id=? AND version=?').get(f.target.projectId,before.projectVersion) as {payload:string};
   expect(JSON.parse(history.payload)).toMatchObject({status:'error',selectedCandidateIds:before.selectedCandidateIds,sources:before.sources});
   expect(db.prepare('SELECT COUNT(*) AS n FROM runs WHERE parent_id=?').get(old.runId)).toEqual({n:1});
  }finally{db.close();}
 }finally{await f.close();}
});


test('질문 없는 계획 수정의 검증 실패도 원래 수정 요청을 보존해 새 SDK turn으로 명시 재시도한다',async()=>{
 const f=await setup('plan_revision');try{
  await f.s.commit(f.j.fence,{type:'failure',error:new DomainError('RESEARCH_FAILED').error,externalOutcome:'unknown',retryAllowed:true});
  const before=await f.s.getProject(f.target.projectId);
  expect((await f.s.mutate('retry',{...f.target,runId:f.j.run.runId},{requestId:randomUUID(),version:before.projectVersion,confirmUnknownOutcome:true})).status).toBe(202);
  const next=await f.claim();expect(next.run).toMatchObject({kind:'revision',attempt:2});expect(next.revision).toEqual(f.j.revision);expect(next.context?.engineSessionId).toBeNull();expect(next.snapshot.selectedCandidateIds).toEqual(before.selectedCandidateIds);
  expect(()=>assertRecoverySupported(next.context!,next.fence)).not.toThrow();
 }finally{await f.close();}
});
test.each([
 {name:'인증 경로 오류',code:'AUTH_PATH_FORBIDDEN' as const,question:false,interrupted:false,kind:'editorial' as const},
 {name:'질문 있는 권한 실패',code:'TOOL_PERMISSION_DENIED' as const,question:true,interrupted:false,kind:'editorial' as const},
 {name:'질문 중단',code:'TOOL_PERMISSION_DENIED' as const,question:true,interrupted:true,kind:'editorial' as const},
 {name:'질문 없는 중단',code:'TOOL_PERMISSION_DENIED' as const,question:false,interrupted:true,kind:'editorial' as const},
 {name:'조사 권한 실패',code:'TOOL_PERMISSION_DENIED' as const,question:false,interrupted:false,kind:'research' as const},
])('$name 재시도는 과거 세션을 유지하여 미검증 복구 차단을 통과하지 못한다',async scenario=>{
 const f=await setup(scenario.kind);try{
  let fence=f.j.fence;
  if(scenario.question){const q={...createMockSnapshot('question').question!,questionId:randomUUID(),runId:f.j.run.runId};fence=(await f.s.saveQuestion(fence,q,null)).fence;}
  if(scenario.interrupted)await f.s.reconcile({now:'2026-10-23T00:01:00.000Z'});
  else await f.s.commit(fence,{type:'failure',error:new DomainError(scenario.code,f.target.projectId).error,externalOutcome:'unknown',retryAllowed:true});
  const before=await f.s.getProject(f.target.projectId);
  const reply=await f.s.mutate('retry',{...f.target,runId:f.j.run.runId},{requestId:randomUUID(),version:before.projectVersion,confirmUnknownOutcome:true});
  if(scenario.kind==='research'){expect(reply.status).toBe(409);expect(before.lastRun?.retryAllowed).toBe(false);expect(before.allowedActions).not.toContain('retry');expect(await f.s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'})).toBeNull();return;}
  expect(reply).toMatchObject({status:409,body:{error:{code:'SESSION_RECOVERY_UNVERIFIED'}}});
  expect(before.lastRun?.retryAllowed).toBe(false);expect(before.allowedActions).not.toContain('retry');
  expect(await f.s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'})).toBeNull();
 }finally{await f.close();}
});

test('retryAllowed=false인 권한 실패는 새 실행을 허용하지 않는다',async()=>{
 const f=await setup();try{
  await f.s.commit(f.j.fence,{type:'failure',error:new DomainError('TOOL_PERMISSION_DENIED').error,externalOutcome:'unknown',retryAllowed:false});
  const p=await f.s.getProject(f.target.projectId);
  expect(await f.s.mutate('retry',{...f.target,runId:f.j.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).toMatchObject({status:409,body:{error:{code:'STAGE_CONFLICT'}}});
  expect(await f.s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'})).toBeNull();
 }finally{await f.close();}
});

test('권한 실패가 조상에만 있으면 직접 부모의 다른 오류 복구 규칙을 유지한다',async()=>{
 const f=await setup();try{
  await f.s.commit(f.j.fence,{type:'failure',error:new DomainError('TOOL_PERMISSION_DENIED').error,externalOutcome:'unknown',retryAllowed:true});
  let p=await f.s.getProject(f.target.projectId);
  await f.s.mutate('retry',{...f.target,runId:f.j.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true});
  const second=await f.claim();expect(second.context?.engineSessionId).toBeNull();
  await f.s.commit(second.fence,{type:'failure',error:new DomainError('AUTH_PATH_FORBIDDEN').error,externalOutcome:'unknown',retryAllowed:true});
  p=await f.s.getProject(f.target.projectId);
  expect(await f.s.mutate('retry',{...f.target,runId:second.run.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).toMatchObject({status:409,body:{error:{code:'SESSION_RECOVERY_UNVERIFIED'}}});
  expect(await f.s.claimJob({ownerId:randomUUID(),now:at,leaseMs:30000,dataMode:'mock'})).toBeNull();
 }finally{await f.close();}
});
