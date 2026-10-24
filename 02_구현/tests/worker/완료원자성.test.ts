import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,fixture} from './도움.js';
import type {InvocationMark,WorkerCommit,EngineContent} from '../../src/shared/포트.js';
async function claimed(){const s=await setup();await s.store.mutate('research',{projectId:s.pid},{requestId:randomUUID(),version:1});const j=(await s.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'}))!;const db=new Database(resolve(s.dataDir,'worker.sqlite'));return {...s,j,db};}
const content:WorkerCommit={type:'content',content:{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null}};
test('terminal_commit 예약 phase는 실행 중 journal로 선기록할 수 없다',async()=>{
 const s=await claimed();try{await expect(s.store.journal(s.j.fence,{phase:'terminal_commit',state:'committed',cardId:null,expectedPath:null,sha256:null,at:new Date().toISOString()})).rejects.toMatchObject({error:{code:'VALIDATION_ERROR'}});expect(marks(s.db)).toEqual([]);expect((await s.store.getRun(s.j.run.runId)).status).toBe('running');}finally{s.db.close();await s.store.close();}
});
function marks(db:Database.Database){return (db.prepare('SELECT payload FROM invocations').all() as {payload:string}[]).map(r=>JSON.parse(r.payload) as InvocationMark);}
test('terminal result/state/event와 committed journal은 정확히 한 트랜잭션에 저장되고 중복/stale는 거절한다',async()=>{
 const s=await claimed();try{await s.store.commit(s.j.fence,content);expect((await s.store.getRun(s.j.run.runId)).status).toBe('succeeded');expect(marks(s.db)).toEqual([{phase:'terminal_commit',state:'committed',cardId:null,expectedPath:null,sha256:null,at:expect.any(String)}]);expect(s.db.prepare('SELECT run_id,attempt FROM invocations').get()).toEqual({run_id:s.j.run.runId,attempt:1});expect((await s.store.getEvents(s.pid,0)).events.filter(e=>e.type==='result')).toHaveLength(1);await expect(s.store.commit(s.j.fence,content)).rejects.toMatchObject({error:{code:'VERSION_CONFLICT'}});await expect(s.store.journal(s.j.fence,marks(s.db)[0])).rejects.toMatchObject({error:{code:'VERSION_CONFLICT'}});expect(marks(s.db)).toHaveLength(1);}finally{s.db.close();await s.store.close();}
});
for(const table of ['invocations','events'])test(`${table} insert 실패시 terminal state/result/history/journal/event가 모두 롤백된다`,async()=>{
 const s=await claimed();try{const before=await s.store.getProject(s.pid),events=await s.store.getEvents(s.pid,0),history=s.db.prepare('SELECT COUNT(*) AS n FROM history').get();s.db.exec(`CREATE TRIGGER fail_terminal BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'W1_INJECTED'); END`);await expect(s.store.commit(s.j.fence,content)).rejects.toThrow('W1_INJECTED');expect(await s.store.getProject(s.pid)).toEqual(before);expect(await s.store.getEvents(s.pid,0)).toEqual(events);expect(s.db.prepare('SELECT COUNT(*) AS n FROM history').get()).toEqual(history);expect(marks(s.db)).toEqual([]);s.db.exec('DROP TRIGGER fail_terminal');await s.store.commit(s.j.fence,content);expect(marks(s.db)).toHaveLength(1);}finally{s.db.close();await s.store.close();}
});
for(const kind of ['failure','canceled','cleanup_failed','waiting'] as const)test(`${kind}는 실제 terminal일 때만 완료 기록을 저장한다`,async()=>{
 const s=await claimed();try{let commit:WorkerCommit=content;if(kind==='canceled'||kind==='cleanup_failed')await s.store.mutate('cancel',{projectId:s.pid,runId:s.j.run.runId},{requestId:randomUUID()});if(kind==='canceled')commit={type:'canceled',cleanupConfirmed:true};else if(kind==='waiting')commit={type:'content',content:{...(content.content as Extract<EngineContent,{kind:'candidates'}>),shortageReason:'오프라인 부족'}};else commit={type:'failure',error:{code:kind==='cleanup_failed'?'CANCEL_CLEANUP_FAILED':'RESEARCH_FAILED',message:'TEST',retryable:false,nextActions:['contact_user'],projectId:s.pid,runId:s.j.run.runId,currentVersion:null,details:{}},externalOutcome:'unknown',retryAllowed:false};await s.store.commit(s.j.fence,commit);expect(marks(s.db).length).toBe(kind==='waiting'||kind==='cleanup_failed'?0:1);}finally{s.db.close();await s.store.close();}
});
