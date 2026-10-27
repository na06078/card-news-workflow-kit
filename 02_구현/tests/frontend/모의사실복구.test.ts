import {expect,it} from 'vitest';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
import {buildSemanticReviewInput,semanticInputHash} from '../../src/providers/검수내용.js';

it('명시 모의 직접 승인도 AI 사실을 보존하고 현재 해시 증명만 기록하며 실제 파일은 만들지 않는다',async()=>{
 const p=createMockSnapshot('review');p.result!.factsCheck='failed';p.factIssues=[{code:'FACT_UNCERTAIN',message:'미확인',claimIndex:null,cardIds:[],sourceIds:[]}];const client=createMockClient(p),target={projectId:p.projectId};
 await expect(client.mutate('approve',target,{requestId:id(),version:p.result!.version,stage:'final'})).rejects.toMatchObject({error:{code:'STAGE_CONFLICT'}});
 const req={requestId:id(),version:p.result!.version,stage:'final' as const,acknowledgeWarnings:true as const};await client.mutate('approve',target,req);const after=await client.getProject(p.projectId);
 expect(after.stage).toBe('export');expect(after.dataMode).toBe('mock');expect(after.result!.factsCheck).toBe('failed');expect(after.factIssues).toEqual(p.factIssues);expect(after.result!.manualApproval).toMatchObject({resultVersion:p.result!.version,warningsAcknowledged:true,contentHash:semanticInputHash(buildSemanticReviewInput(p))});expect(after.exports).toEqual([]);
 await client.mutate('approve',target,req);expect((await client.getProject(p.projectId)).projectVersion).toBe(after.projectVersion);
 await client.mutate('revisions',target,{requestId:id(),version:after.result!.version,scope:'text',cardIds:[after.result!.cards[0]!.cardId],instruction:JSON.stringify({title:'새 원고',body:'수정 본문'})});expect((await client.getProject(p.projectId)).result!.manualApproval).toBeUndefined();
});
it('선택 모의 재검수의 확인 불가도 구조가 준비된 결과의 직접 승인 행동은 유지한다',async()=>{
 const p=createMockSnapshot('review');p.allowedActions.push('reverify_facts');p.claims=[{text:'합성 확인 불가',kind:'uncertain',availability:'unknown',conditions:[],sourceIds:[]}];const client=createMockClient(p);
 await client.mutate('factReview',{projectId:p.projectId},{requestId:id(),version:p.projectVersion,claimIndices:[0],cardIds:p.result!.cards.map(c=>c.cardId)});
 const after=await client.getProject(p.projectId);expect(after.factIssues).not.toHaveLength(0);expect(after.allowedActions).toContain('approve_final');
});
const id=()=>crypto.randomUUID();
function facts(){const p=createMockSnapshot('storyboard');p.allowedActions.push('reverify_facts');p.claims=[{text:'확인 불가 주장',sourceIds:p.sources.map(s=>s.sourceId),kind:'uncertain',availability:'unknown',conditions:[]}];return p;}
it('모의 재검증은 실제 관측을 꾸미지 않고 확인 불가 제안과 차단을 남긴다',async()=>{const p=facts(),client=createMockClient(p);const request={requestId:id(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0]!.cardId]};await client.mutate('factReview',{projectId:p.projectId},request);const after=await client.getProject(p.projectId);expect(after.factReview?.state).toBe('ready');expect(after.factReview?.proposal?.observations).toEqual([]);expect(after.factReview?.proposal?.cards).toEqual([]);expect(after.factReview?.proposal?.findings[0]?.classification).toBe('unverifiable');expect(after.factIssues?.length).toBeGreaterThan(0);expect(after.storyboard).toEqual(p.storyboard);await expect(client.mutate('factApply',{projectId:p.projectId},{requestId:id(),version:after.projectVersion,reviewRunId:after.factReview!.runId})).rejects.toMatchObject({error:{code:'FACT_SCOPE_INVALID'}});});
it('모의 파일 재생성은 실제 ZIP 성공으로 속이지 않고 명시 거절한다',async()=>{const p=createMockSnapshot('review');p.result!.finalApprovedVersion=p.result!.version;p.result!.cards.forEach(c=>c.approvedRevision=c.revision);p.allowedActions=['rebuild_exports'];const client=createMockClient(p);await expect(client.mutate('rebuildExports',{projectId:p.projectId},{requestId:id(),version:p.projectVersion})).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});expect((await client.getProject(p.projectId)).result!.finalApprovedVersion).toBe(p.result!.version);});
it('모의 고정 질문도 legacy 자유 텍스트를 저장하지 않는다',async()=>{const p=createMockSnapshot('question');p.question!.kind='period_expansion';p.question!.items[0]!.allowFreeText=true;const client=createMockClient(p);await expect(client.mutate('answers',{projectId:p.projectId},{requestId:id(),version:p.question!.version,questionId:p.question!.questionId,answer:p.question!.items.map(i=>({itemId:i.itemId,optionIds:[],text:'기간 임의 변경'}))})).rejects.toBeDefined();expect((await client.getProject(p.projectId)).question!.status).toBe('open');});

it('제작 실패 중에는 실패 카드 text/layout 외 수정과 사실 차단 우회 승인을 거절한다',async()=>{
 const p=createMockSnapshot('review');p.stage='production';p.status='error';p.result!.cards[0]!.state='failed';p.allowedActions=['revise'];const client=createMockClient(p);
 await expect(client.mutate('revisions',{projectId:p.projectId},{requestId:id(),version:p.result!.version,scope:'image',cardIds:[p.result!.cards[0]!.cardId],instruction:'새 그림'})).rejects.toMatchObject({error:{code:'STAGE_CONFLICT'}});
 const f=facts();f.result=createMockSnapshot('review').result;f.factIssues=[{code:'FACT_UNCERTAIN',message:'미확인',claimIndex:0,cardIds:[f.result!.cards[0]!.cardId],sourceIds:[]}];f.allowedActions=[];const blocked=createMockClient(f);
 await expect(blocked.mutate('approve',{projectId:f.projectId},{requestId:id(),version:f.result!.version,stage:'final'})).rejects.toMatchObject({error:{code:'STAGE_CONFLICT'}});
});

