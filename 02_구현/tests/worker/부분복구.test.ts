import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createStore} from '../../src/backend/저장소.js';
import {createWorker} from '../../src/worker/작업자.js';
import {createOfflineClaudeFactLinkRepairer} from '../../src/providers/클로드검수.js';
import {makeReviewer} from '../../src/providers/의미검수.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../src/providers/클로드.js';
import {options,confirmed} from './도움.js';
import {prepared,fail} from '../backend/부분복구도움.js';
import {prepareFactCheckpoint} from '../../src/providers/사실재검증.js';
import {syntheticReport} from '../backend/의미검수대역.js';
import type * as C from '../../src/shared/포트.js';
test('실제 collector 경계 실패→SQLite→연결만 보완→의미 실패→의미만 재개하며 수집/이미지/렌더를 반복하지 않는다',async()=>{
 const state=await prepared(false),{s,target,job,draft,receipts}=state;
 draft.findings[0].afterClaim.kind='publisher_claim';draft.cards.forEach(c=>{c.body='확인된 발표를 간추린 요약입니다.';});
 // Return the preclaimed initial task to queued without starting a provider: isolated fixture only.
 await s.commit(job.fence,{type:'failure',error:{code:'FACT_REVIEW_FAILED',message:'fixture',retryable:true,nextActions:['retry'],projectId:target.projectId,runId:job.run.runId,currentVersion:null,details:{}},externalOutcome:'not_started',retryAllowed:true});
 let p=await s.getProject(target.projectId);await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.storyboard!.cards.map(c=>c.cardId),reviewer:'claude'});
 let collects=0,repairs=0,reviews=0,rid='',repairDisposed=false;
 const query:QueryFactory=({options:opts,prompt})=>Object.assign((async function*(){collects++;if(typeof prompt!=='string')for await(const _ of prompt){}const sid=randomUUID();yield {type:'system',subtype:'init',session_id:sid,cwd:opts!.cwd,tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'} as any;const r=receipts[0];yield {type:'assistant',session_id:sid,message:{content:[{type:'tool_use',id:r.toolUseId,name:'WebFetch',input:{url:r.url}}]}} as any;yield {type:'user',session_id:sid,message:{content:[{type:'tool_result',tool_use_id:r.toolUseId,content:'fixture'}]},tool_use_result:{url:r.url,code:200,codeText:'OK',bytes:r.bytes,result:r.result,durationMs:1}} as any;yield {type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:draft} as any;})(),{close(){}});
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId});
 o.createClaudeAdapter=opts=>createOfflineClaudeAdapter(opts,query);
 o.createFactLinkRepairer=opts=>({repair:async(c,input)=>{rid=c.runId;repairs++;await opts.onProgress?.({provider:'claude',status:'failed',actualModel:'unsafe model\nsecret'});expect(input.draft).toEqual(draft);return {decision:{status:'repaired',reason:'기존 주장에 연결',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}]},actualModel:'test'};},cancel:async id=>confirmed(id),dispose:async()=>{repairDisposed=true;return [confirmed(rid)];}});
 o.createSemanticReviewer=({selection})=>({review:async(c,input)=>{rid=c.runId;expect(repairDisposed).toBe(true);reviews++;if(reviews===1)throw Error('합성 의미 검수 transport 실패');return syntheticReport(input,selection,'unverifiable');},cancel:async id=>confirmed(id),dispose:async()=>[confirmed(rid)]});
 const w=createWorker(o);
 const resume=async()=>{p=await s.getProject(target.projectId);expect(p.factRecovery!.available).toBe(true);const input={requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,reviewer:'claude' as const,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId};expect((await s.mutate('factReview',target,input)).status).toBe(202);expect((await s.mutate('factReview',target,input)).replayed).toBe(true);await w.tick();};
 try{
 await w.tick();p=await s.getProject(target.projectId);expect(p.lastRun!.error?.code).toBe('FACT_SCOPE_INVALID');expect(p.factRecovery).toMatchObject({step:'links',available:true});expect(collects).toBe(1);
 const oldRun=p.lastRun!.runId;await resume();p=await s.getProject(target.projectId);expect(p.lastRun!.status).toBe('failed');expect(p.factRecovery).toMatchObject({step:'semantic',available:true});expect(repairs).toBe(1);
 const repairRun=p.lastRun!.runId,observation=(await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId)).repairObservation;expect(observation).toMatchObject({originRunId:repairRun,actualModel:'test'});
 await resume();p=await s.getProject(target.projectId);expect(p.lastRun!.status).toBe('succeeded');expect(p.factReview!.state).toBe('ready');expect((await s.getFactCheckpoint(target.projectId,p.factRecovery!.checkpointId)).repairObservation).toEqual(observation);expect(p.factRecovery!.reason).toBe('이미 검토 제안이 저장되어 재개할 필요가 없습니다.');expect(p.factReview!.proposal!.semanticReview!.verdict).toBe('unverifiable');expect(p.storyboard).toEqual(state.p.storyboard);expect(p.claims).toEqual(state.p.claims);expect((await s.getRun(oldRun)).status).toBe('failed');expect([collects,repairs,reviews]).toEqual([1,1,2]);const events=(await s.getEvents(target.projectId,0)).events;expect(JSON.stringify(events)).not.toContain('unsafe model');expect(events.some(e=>e.type==='progress'&&e.phase==='fact-link-repair'&&e.activity?.status==='failed'&&e.message==='연결 보완 응답을 확인하지 못했습니다')).toBe(true);expect(o.agy.generate).not.toHaveBeenCalled();expect(o.renderCard).not.toHaveBeenCalled();expect(o.buildExport).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.close();}
});

test.each(['unresolvable','unknown-link','source-subset'])('typed 보완 %s 응답은 병합 실패 전에 저장되어 재기동 후에도 private 진단으로 남는다',async mode=>{
 const state=await prepared(false),{s,target,job,draft,receipts}=state;
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId});let rid='';
 const decision:C.FactLinkRepairDecision=mode==='unresolvable'?{status:'unresolvable',links:[],reason:'연결할 수 없음'}:{status:'repaired',links:[{claimIndex:0,cardIds:[mode==='unknown-link'?randomUUID():draft.cards[1].cardId]}],reason:'보완 원본 응답'};
 // A known source, but not the finding source: strict merge must still reject the subset.
 if(mode==='source-subset'){
  const extra={...draft.sources[0],sourceId:randomUUID()};draft.sources.push(extra);draft.cards[1].sourceIds=[extra.sourceId];
  await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));
 }
 await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);
 const semantic=vi.fn(()=>{throw Error('semantic forbidden');});o.createSemanticReviewer=semantic;
 o.createFactLinkRepairer=opts=>createOfflineClaudeFactLinkRepairer({...opts,livePermission:{inference:true,approvalReference:'explicit offline fake only'}},({prompt,options})=>{
  const account={apiProvider:'firstParty',apiKeySource:'none',tokenSource:'oauth',subscriptionType:'Claude Team'};
  return Object.assign((async function*(){if(typeof prompt!=='string')for await(const _ of prompt){}const sid=randomUUID();rid=(await s.getProject(target.projectId)).activeRun!.runId;expect(options!.tools).toEqual([]);expect(options!.persistSession).toBe(false);
   yield {type:'system',subtype:'init',session_id:sid,cwd:options!.cwd,tools:['StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:'claude-test'} as any;
   yield {type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:decision} as any;
  })(),{close(){},initializationResult:async()=>({account}),accountInfo:async()=>account}) as never;
 });
 const w=createWorker(o);let reopened:C.Store|undefined,restarted:C.Worker|undefined;
 try{
  await w.tick();const p=await s.getProject(target.projectId);
  await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});
  const before=new Date().toISOString();await w.tick();const after=await s.getProject(target.projectId),cp=await s.getFactCheckpoint(target.projectId,after.factRecovery!.checkpointId);
  expect(after.lastRun!.error?.code).toBe(mode==='source-subset'?'FACT_REVIEW_FAILED':'FACT_SCOPE_INVALID');expect(after.factRecovery!.step).toBe('links');expect(after.factReview!.proposal).toBeNull();
  const obs=(cp as any).repairObservation;
  expect(obs).toMatchObject({decision,actualModel:'claude-test',originRunId:rid});expect(obs.observedAt>=before&&obs.observedAt<=new Date().toISOString()).toBe(true);
  const events=(await s.getEvents(target.projectId,0)).events;expect(events.some(e=>e.type==='progress'&&e.phase==='fact-link-repair'&&e.actualModel==='claude-test')).toBe(true);
  expect(after.lastRun!.error!.message).toContain(mode==='unresolvable'?'연결을 확정하지 못했습니다':mode==='unknown-link'?'연결 대상':'연결 보완의 참조·출처 검증에 실패했습니다');
  expect(JSON.stringify(after)).not.toContain('repairObservation');expect(JSON.stringify(after)).not.toContain(decision.reason);
  expect(semantic).not.toHaveBeenCalled();expect(o.agy.generate).not.toHaveBeenCalled();expect(o.renderCard).not.toHaveBeenCalled();expect(o.buildExport).not.toHaveBeenCalled();
  await w.dispose();await s.close();reopened=await createStore(state.options);
  expect((await reopened.getFactCheckpoint(target.projectId,cp.checkpointId)) as any).toMatchObject({repairObservation:obs});
  restarted=createWorker({...o,store:reopened,ownerId:randomUUID()});expect(await restarted.tick()).toBe(false);expect(semantic).not.toHaveBeenCalled();expect((await reopened.getFactCheckpoint(target.projectId,cp.checkpointId)).repairObservation).toEqual(obs);
 }finally{await restarted?.dispose();await w.dispose();await (reopened??s).close();}
});


test.each(['다른 주장','다른 문장','모호한 정정'])('이전 literal 반례 %s는 전체 발행 의미 transport로 이동하고 unsupported를 자동 승인하지 않는다',async body=>{
 const state=await prepared(false),{s,target,job,draft,receipts}=state;draft.findings[0].afterClaim.kind='publisher_claim';draft.cards[1].body=body;
 await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId});let rid='',semanticCalls=0;
 o.createFactLinkRepairer=()=>({repair:async c=>{rid=c.runId;return {decision:{status:'repaired',links:[{claimIndex:0,cardIds:[draft.cards[1].cardId]}],reason:'합성 연결 후보'},actualModel:'claude-test'};},cancel:async id=>confirmed(id),dispose:async()=>[confirmed(rid)]});
 o.createSemanticReviewer=opts=>makeReviewer({...opts,livePermission:{inference:true,approvalReference:'explicit offline fake only'}},true,async(c,input)=>{
  semanticCalls++;expect(input.cards).toHaveLength(job.snapshot.storyboard!.cards.length);expect(input.cards.find(x=>x.cardId===draft.cards[1].cardId)!.body).toBe(body);expect(input.claims[0].claim.text).toBe(draft.findings[0].afterClaim.text);expect(input.sources.some(x=>x.evidence===draft.sources[0].evidence)).toBe(true);
  const decision={verdict:'unsupported',reviewedCardIds:input.cards.map(x=>x.cardId),reviewedClaimIndices:input.claims.map(x=>x.claimIndex),issues:[{cardId:draft.cards[1].cardId,claimIndex:0,sourceIds:[draft.sources[0].sourceId],message:'합성 판정: 발행 문장 미지지',suggestion:null}]};
  return {execute:async()=>({decision,actualModel:'claude-test'}),cleanup:async()=>confirmed(c.runId)};
 });
 const w=createWorker(o);try{
  await w.tick();const p=await s.getProject(target.projectId);await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});await w.tick();
  const after=await s.getProject(target.projectId);expect(semanticCalls).toBe(1);expect(after.lastRun!.status).toBe('succeeded');expect(after.factReview!.state).toBe('ready');expect(after.factReview!.proposal!.semanticReview!.verdict).toBe('unsupported');expect(after.storyboard).toEqual(state.p.storyboard);expect(after.claims).toEqual(state.p.claims);expect(after.sources).toEqual(state.p.sources);expect(after.exports).toEqual(state.p.exports);expect(o.agy.generate).not.toHaveBeenCalled();expect(o.renderCard).not.toHaveBeenCalled();expect(o.buildExport).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.close();}
});

test.each(['unresolvable','unknown-link','cleanup-unknown'])('보완 %s는 성공으로 위장하지 않으며 의미 검수를 시작하지 않는다',async mode=>{
 const state=await prepared(false),{s,target,job,draft,receipts}=state;await s.saveFactCheckpoint(job.fence,prepareFactCheckpoint(draft,job.snapshot,receipts));await fail(s,job);
 const o=options({store:s,dataDir:state.options.dataDir,pid:target.projectId}),collector=vi.fn(()=>{throw Error('collector forbidden');}),semantic=vi.fn(()=>{throw Error('semantic forbidden');});o.createClaudeAdapter=collector;o.createSemanticReviewer=semantic;let rid='';
 o.createFactLinkRepairer=()=>({repair:async(c)=>{rid=c.runId;return {decision:mode==='unresolvable'?{status:'unresolvable',links:[],reason:'기존 주장을 연결할 수 없음'}:{status:'repaired',links:[{claimIndex:0,cardIds:[mode==='unknown-link'?randomUUID():draft.cards[1].cardId]}],reason:'후보 연결'},actualModel:'test'};},cancel:async id=>confirmed(id),dispose:async()=>[{...confirmed(rid),status:mode==='cleanup-unknown'?'unknown':'confirmed'}]});
 const w=createWorker(o);try{
  await w.tick();const p=await s.getProject(target.projectId);expect(p.factRecovery!.available).toBe(true);
  expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:p.factReview!.cardIds,reviewer:'claude',resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId})).status).toBe(202);
  if(mode==='cleanup-unknown')await expect(w.tick()).rejects.toMatchObject({code:'CANCEL_CLEANUP_FAILED'});else await w.tick();
  const after=await s.getProject(target.projectId);expect(after.lastRun!.error?.code).toBe(mode==='cleanup-unknown'?'CANCEL_CLEANUP_FAILED':'FACT_SCOPE_INVALID');expect(after.factReview!.proposal).toBeNull();expect(after.factRecovery!.step).toBe(mode==='cleanup-unknown'?'semantic':'links');expect(after.factRecovery!.available).toBe(false);expect(collector).not.toHaveBeenCalled();expect(semantic).not.toHaveBeenCalled();expect(o.agy.generate).not.toHaveBeenCalled();expect(o.renderCard).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.close();}
});

