import {expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {Worker,WorkerOptions} from '../../src/shared/포트.js';
import {draft,reviewed} from '../backend/의미검수대역.js';
import {buildSemanticReviewInput,semanticInputHash} from '../../src/providers/검수내용.js';
export const fixture=createMockSnapshot('selection');
export async function setup(outputRoot='실행데이터/검수모델전환/저장실행/worker'){const dataDir=resolve(outputRoot,randomUUID());const store=await createStore({dataDir,dbPath:resolve(dataDir,'worker.sqlite'),dataMode:'mock'});const reply=await store.createProject({topic:'오프라인 작업자',createRequestId:randomUUID()});if(!('data'in reply.body))throw Error('create');return {store,dataDir,pid:reply.body.data.projectId};}
export const confirmed=(id:string)=>({runId:id,status:'confirmed' as const,verifiedAt:new Date().toISOString(),reason:'TEST_DOUBLE',children:[]});
export function options(s:Awaited<ReturnType<typeof setup>>):WorkerOptions{
 return {store:s.store,dataDir:s.dataDir,ownerId:randomUUID(),dataMode:'mock',claudeOptions:{livePermission:{inference:false,search:false,image:false}},
 createClaudeAdapter:({bridge})=>({async *start(c){yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[]}),
 agy:{generate:vi.fn(),cancel:async id=>confirmed(id),dispose:async()=>[]},renderCard:vi.fn(),buildExport:vi.fn(),font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),pollMs:5,heartbeatMs:10,leaseMs:1000};
}
export async function enqueueEditorial(s:Awaited<ReturnType<typeof setup>>){await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});const j=await s.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!j)throw Error('claim');await s.store.commit(j.fence,{type:'content',content:{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null}});await s.store.mutate('selection',{projectId:s.pid},{version:1,requestId:randomUUID(),candidateIds:[fixture.candidates[0].candidateId]});}
export async function enqueueProduction(s:Awaited<ReturnType<typeof setup>>,verifiedFixture=false){await enqueueEditorial(s);const j=await s.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!j)throw Error('claim');const board=createMockSnapshot('storyboard').storyboard!;board.cards.push({...board.cards[0],cardId:randomUUID(),order:2,role:'closing'});await s.store.commit(j.fence,{type:'content',content:{kind:'storyboard',storyboard:board,sources:[...fixture.sources,{...fixture.sources[0],sourceId:randomUUID(),url:'https://example.org/unused-source'}].map(source=>verifiedFixture?{...source,access:'opened' as const,accessedAt:new Date().toISOString(),evidence:'합성 검증 fixture, 실제 원문 접근 아님'}:source),claims:verifiedFixture?[{text:'합성 fixture 주장, 실제 뉴스 아님',sourceIds:fixture.sources.map(s=>s.sourceId),kind:'verified',availability:'unknown',conditions:[]}]:[]}});await s.store.mutate('approve',{projectId:s.pid},{version:1,stage:'storyboard',requestId:randomUUID()});}

/** 테스트 전용 합성 판정: 실제 LLM 판단/원문 접근이 아닙니다. 공개 요청과 trusted Store commit을 거칩니다. */
export async function applySyntheticSemanticReview(s:Awaited<ReturnType<typeof setup>>,worker:Worker){
 const target={projectId:s.pid};let p=await s.store.getProject(s.pid);
 expect(p.result!.factsCheck).toBe('pending');expect(p.factIssues?.map(i=>i.code)).toContain('SEMANTIC_REVIEW_REQUIRED');
 const denied=await s.store.mutate('approve',target,{stage:'final',version:p.result!.version,requestId:randomUUID()});
 expect(denied).toMatchObject({status:409,body:{error:{code:'STAGE_CONFLICT'}}});
 expect((await s.store.getProject(s.pid)).projectVersion).toBe(p.projectVersion);
 expect((await s.store.getProject(s.pid)).activeRun).toBeNull();
 expect((await s.store.getProject(s.pid)).result!.finalApprovedVersion).toBeNull();
 expect((await s.store.mutate('factReview',target,{version:p.projectVersion,requestId:randomUUID(),claimIndices:[0],cardIds:p.result!.cards.map(c=>c.cardId)})).status).toBe(202);
 const job=await s.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!job)throw Error('synthetic review claim');
 expect(job.run.kind).toBe('factReview');const raw=draft(job.snapshot);
 raw.sources[0].evidence='확인된 합성 수치 20 (테스트 전용, 실제 원문 접근/LLM 판단 아님)';
 raw.cards=job.snapshot.result!.cards.map(c=>({cardId:c.cardId,title:c.title,body:'확인된 합성 수치 20',sourceIds:[raw.sources[0].sourceId]}));
 raw.findings[0].cardIds=raw.cards.map(c=>c.cardId);const content=reviewed(job.snapshot,raw);
 await s.store.commit(job.fence,{type:'content',content});p=await s.store.getProject(s.pid);
 expect(p.factReview!.state).toBe('ready');expect(p.result!.finalApprovedVersion).toBeNull();
 expect((await s.store.mutate('factApply',target,{version:p.projectVersion,reviewRunId:job.run.runId,requestId:randomUUID()})).status).toBe(202);
 expect(await worker.tick()).toBe(true);p=await s.store.getProject(s.pid);
 expect(p.lastRun).toMatchObject({kind:'factApply',status:'succeeded'});
 expect(p.result!.semanticReview).toEqual(content.semanticReview);
 expect(p.result!.semanticReview!.inputHash).toBe(semanticInputHash(buildSemanticReviewInput(p)));
 expect(p.result!.factsCheck).toBe('passed');expect(p.result!.visualCheck).toBe('passed');return p;
}

