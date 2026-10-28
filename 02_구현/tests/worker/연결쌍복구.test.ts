import {test,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {createWorker} from '../../src/worker/작업자.js';
import {createStore} from '../../src/backend/저장소.js';
import {prepareFactCheckpoint} from '../../src/providers/사실재검증.js';
import {prepared,fail} from '../backend/부분복구도움.js';
import {options,confirmed} from './도움.js';
import {syntheticReport} from '../backend/의미검수대역.js';
import type * as C from '../../src/shared/포트.js';
test.each([false,true])('저장 연결 재사용은 수집0·보완0·의미만 호출하고 origin과 선택을 보존한다 · 의미실패=%s',async failure=>{
 const state=await prepared(false,{reviewer:'agy',reviewEffort:'low'}),{s,target,job,draft,receipts}=state;
 const observation:C.FactRepairObservation={decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'private 원본 보완'},actualModel:'original-model',observedAt:'2026-10-28T00:00:00Z',originRunId:job.run.runId};
 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:observation});await fail(s,job);
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId}),collector=vi.fn(()=>{throw Error('수집 금지');}),repair=vi.fn(()=>{throw Error('보완 금지');});o.createClaudeAdapter=collector;o.createFactLinkRepairer=repair;
 let calls=0,rid='';o.createSemanticReviewer=({selection})=>({review:async(c,input)=>{rid=c.runId;calls++;expect(selection).toEqual(job.snapshot.factReview!.reviewer);expect(input.cards).toEqual(draft.cards);if(failure&&calls===1)throw Error('/private/raw transport error');return syntheticReport(input,selection,'unsupported');},cancel:async id=>confirmed(id),dispose:async()=>[confirmed(rid)]});
 const w=createWorker(o);
 const resume=async()=>{const p=await s.getProject(target.projectId);expect(p.factRecovery!.available).toBe(true);return s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});};
 try{
 await w.tick();expect((await resume()).status).toBe(202);await w.tick();let p=await s.getProject(target.projectId);
 expect(calls).toBe(1);expect(collector).not.toHaveBeenCalled();expect(repair).not.toHaveBeenCalled();
 let cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId);expect(cp.step).toBe('semantic');expect(cp.repairObservation).toEqual(observation);expect(p.lastRun!.actualModel).toBeUndefined();
 const events=(await s.getEvents(target.projectId,0)).events.filter(e=>e.runId===p.lastRun!.runId);expect(events.some(e=>e.type==='progress'&&e.phase==='fact-link-repair'&&!e.activity&&!e.actualModel&&e.message.includes('재사용'))).toBe(true);
 const db=new Database(state.options.dbPath);try{const marks=db.prepare('SELECT payload FROM invocations WHERE run_id=?').all(p.lastRun!.runId) as {payload:string}[];expect(marks.map(x=>JSON.parse(x.payload)).some(m=>m.phase==='fact-link-repair'&&['started','output_observed'].includes(m.state))).toBe(false);}finally{db.close();}
 if(failure){expect(p.lastRun).toMatchObject({status:'failed',externalOutcome:'known'});expect(p.factRecovery).toMatchObject({step:'semantic',available:true});expect(p.factReview!.proposal).toBeNull();expect(JSON.stringify(p)).not.toContain('/private/raw');expect((await resume()).status).toBe(202);await w.tick();p=await s.getProject(target.projectId);expect(calls).toBe(2);cp=await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId);expect(cp.repairObservation).toEqual(observation);}
 expect(p.lastRun!.status).toBe('succeeded');expect(p.factReview!.proposal!.semanticReview!.verdict).toBe('unsupported');expect(p.storyboard).toEqual(state.p.storyboard);expect(p.claims).toEqual(state.p.claims);expect(p.sources).toEqual(state.p.sources);expect(p.exports).toEqual(state.p.exports);expect(repair).not.toHaveBeenCalled();expect(o.agy.generate).not.toHaveBeenCalled();expect(o.renderCard).not.toHaveBeenCalled();expect(o.buildExport).not.toHaveBeenCalled();
 await w.dispose();await s.close();const reopened=await createStore(state.options);try{const again=await reopened.getProject(target.projectId);expect(again.factReview!.proposal).toEqual(p.factReview!.proposal);expect((await reopened.getFactCheckpoint(target.projectId,again.factRecovery!.checkpointId)).repairObservation).toEqual(observation);}finally{await reopened.close();}
 }finally{await w.dispose();await s.close();}
});
test('접수 뒤 저장 연결이 바뀌어도 fresh 보완으로 fallback하지 않는다',async()=>{
 const state=await prepared(false),{s,target,job,draft,receipts}=state;
 await s.saveFactCheckpoint(job.fence,{...prepareFactCheckpoint(draft,job.snapshot,receipts),repairObservation:{decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'private 저장응답'},actualModel:'test',observedAt:new Date().toISOString(),originRunId:job.run.runId}});await fail(s,job);
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId});o.createClaudeAdapter=vi.fn(()=>{throw Error('수집 금지');});o.createFactLinkRepairer=vi.fn(()=>{throw Error('보완 금지');});o.createSemanticReviewer=vi.fn(()=>{throw Error('의미 금지');});const w=createWorker(o);
 try{await w.tick();const p=await s.getProject(target.projectId),cp=p.factRecovery!;expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,resumeFromRunId:cp.sourceRunId,checkpointId:cp.checkpointId})).status).toBe(202);
 const db=new Database(state.options.dbPath);try{const row=db.prepare('SELECT payload FROM fact_checkpoints WHERE checkpoint_id=?').get(cp.checkpointId) as {payload:string};const saved=JSON.parse(row.payload);saved.repairObservation.decision.links[0].cardIds=[randomUUID()];db.prepare('UPDATE fact_checkpoints SET payload=? WHERE checkpoint_id=?').run(JSON.stringify(saved),cp.checkpointId);}finally{db.close();}
 await w.tick();const after=await s.getProject(target.projectId);expect(after.lastRun!.error).toMatchObject({code:'FACT_SCOPE_INVALID',details:{reason:'FACT_LINK_TARGET_INVALID'}});expect(after.lastRun!.error!.message).toContain('연결 대상');expect(after.factRecovery!.available).toBe(false);expect(after.factReview!.proposal).toBeNull();expect(o.createClaudeAdapter).not.toHaveBeenCalled();expect(o.createFactLinkRepairer).not.toHaveBeenCalled();expect(o.createSemanticReviewer).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.close();}
});
