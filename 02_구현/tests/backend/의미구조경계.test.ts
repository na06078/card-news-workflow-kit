import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import type {FactProposalDraft,ProjectSnapshot} from '../../src/shared/포트.js';
import {captureFetchReceipt,validateFactReview} from '../../src/providers/사실재검증.js';
import {buildSemanticReviewInput} from '../../src/providers/검수내용.js';
import {beginFactReview,saveFactProposal,applyFactProposal,validateFactScope,factIssues} from '../../src/backend/사실복구.js';
import {checkStoredFacts} from '../../src/worker/검수.js';
import {createStore} from '../../src/backend/저장소.js';
import {syntheticReport} from './의미검수대역.js';
const at='2026-10-26T00:00:00Z',id='11111111-1111-4111-8111-111111111111';
function fixture(projectId:string=I.project,text='알자지라가 전한 이탈리아의 열 명 집계다.'){
 const p=createMockSnapshot('review');p.projectId=projectId;p.claims=[{text:'기존 10',kind:'verified',sourceIds:[I.source],availability:'unknown',conditions:[]}];Object.assign(p.sources[0]!,{access:'opened',accessedAt:at,evidence:'기존 합성 근거'});
 p.factReview=beginFactReview(p,{requestId:I.run,version:p.projectVersion,claimIndices:[0],cardIds:[I.card]},I.run);
 const source={...p.sources[0]!,sourceId:id,publisher:'Al Jazeera (AFP)',access:'opened' as const,accessedAt:at,evidence:'In Italia dieci persone.'};
 const draft:FactProposalDraft={kind:'factReview',sources:[source],cards:[{cardId:I.card,title:'번역 후보',body:text,sourceIds:[id]}],findings:[{claimIndex:0,cardIds:[I.card],classification:'supported',reason:'명시 합성 후보, 의미 보증 아님',afterClaim:{...p.claims[0]!,text,sourceIds:[id],kind:'publisher_claim'},comparisons:[{sourceId:id,country:'Italy',event:null,period:null,population:null,metric:null,unit:'명',value:'10',aggregation:'unknown',provisional:null}]}]};
 const receipts=[captureFetchReceipt('fake-http',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,at)];
 const content=validateFactReview(draft,p,receipts);if(content.kind!=='factReview')throw Error('candidate');return {p,draft,receipts,content};
}
it('별칭·국가 번역 후보의 저장/명시 적용은 원형을 보존하고 report 없이는 저장하지 않는다',()=>{
 const {p,content}=fixture(),before=structuredClone(p);expect(()=>saveFactProposal(p,I.run,content)).toThrow('FACT_REVIEW_FAILED');expect(p).toEqual(before);
 const report=syntheticReport(buildSemanticReviewInput(p,content));saveFactProposal(p,I.run,{...content,semanticReview:report});expect(p.claims).toEqual(before.claims);expect(p.result).toEqual(before.result);expect(p.sources).toEqual(before.sources);p.projectVersion++;
 applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:I.run});expect(p.sources.at(-1)!.publisher).toBe('Al Jazeera (AFP)');expect(p.sources.at(-1)!.evidence).toBe('In Italia dieci persone.');expect(p.factReview!.proposal!.findings[0]!.comparisons[0]!.country).toBe('Italy');expect(p.result!.semanticReview).toEqual(report);expect(p.result!.finalApprovedVersion).toBeNull();
});
it.each(['quote','missing-receipt','403','zero-bytes','wrong-date','no-date','old-source','candidate','out-claim','out-card','missing-patch','unlinked','unverifiable-verified','duplicate-finding','duplicate-card','duplicate-comparison'] as const)('의미 위임 후에도 provenance/scope 구조는 양 경계에서 거절한다: %s',mode=>{
 const {p,draft,receipts,content}=fixture();const f=draft.findings[0]!,b=structuredClone(content);
 if(mode==='quote'){draft.sources[0]!.evidence='처리 결과에 없는 인용';b.sources[0]!.evidence=null;}
 if(mode==='missing-receipt'){receipts.length=0;b.observations=[];}
 if(mode==='403'){receipts[0]!.outcome='blocked';receipts[0]!.statusCode=403;b.observations[0]!.statusCode=403;}
 if(mode==='zero-bytes'){receipts[0]!.outcome='empty';receipts[0]!.bytes=0;b.observations[0]!.bytes=0;}
 if(mode==='wrong-date'){receipts[0]!.observedAt='not-a-date';b.sources[0]!.accessedAt='2026-10-25T00:00:00Z';}
 if(mode==='no-date'){receipts[0]!.observedAt='';b.sources[0]!.accessedAt=null;}
 if(mode==='old-source'){draft.sources[0]!.sourceId=I.source;b.sources[0]!.sourceId=I.source;}
 if(mode==='candidate'){draft.sources[0]!.candidateId=I.project;b.sources[0]!.candidateId=I.project;}
 if(mode==='out-claim'){f.claimIndex=99;b.findings[0]!.claimIndex=99;}
 if(mode==='out-card'){draft.cards[0]!.cardId=I.project;b.cards[0]!.cardId=I.project;}
 if(mode==='missing-patch'){draft.cards=[];b.cards=[];}
 if(mode==='unlinked'){draft.cards[0]!.sourceIds=[I.source];b.cards[0]!.sourceIds=[I.source];}
 // '다른 문장' 반례는 worker/부분복구의 별도 semantic transport에 보존합니다.
 if(mode==='unverifiable-verified'){f.classification='unverifiable';b.findings[0]!.classification='unverifiable';}
 if(mode==='duplicate-finding'){draft.findings.push(f);b.findings.push(b.findings[0]!);}
 if(mode==='duplicate-card'){draft.cards.push(draft.cards[0]!);b.cards.push(b.cards[0]!);}
 if(mode==='duplicate-comparison'){f.comparisons.push(f.comparisons[0]!);b.findings[0]!.comparisons.push(b.findings[0]!.comparisons[0]!);}
 const providerScope=['old-source','candidate','out-claim','out-card','unlinked'].includes(mode),backendScope=providerScope||['duplicate-finding','duplicate-card','duplicate-comparison'].includes(mode);
 expect(()=>validateFactReview(draft,p,receipts)).toThrow(expect.objectContaining({code:providerScope?'FACT_SCOPE_INVALID':'FACT_REVIEW_FAILED'}));
 // 완전한 fresh fake report도 구조 위반을 덮지 못해야 합니다(누락 report에 의한 오탐 방지).
 b.semanticReview=syntheticReport(buildSemanticReviewInput(p,b));const before=structuredClone(p);
 expect(()=>saveFactProposal(p,I.run,b)).toThrow(expect.objectContaining({error:expect.objectContaining({code:backendScope?'FACT_SCOPE_INVALID':'FACT_REVIEW_FAILED'})}));expect(p).toEqual(before);expect(p.factReview!.state).toBe('pending');expect(p.result!.finalApprovedVersion).toBeNull();
});
it.each(['stale-fingerprint','stale-version','wrong-run','before-card','before-claim','missing-report','stale-report','report-scope','selection'] as const)('적용의 CAS·snapshot·전체 report 결합은 유지한다: %s',mode=>{
 const {p,content}=fixture();saveFactProposal(p,I.run,{...content,semanticReview:syntheticReport(buildSemanticReviewInput(p,content))});p.projectVersion++;
 const proposal=p.factReview!.proposal!;
 if(mode==='stale-fingerprint')p.topic+=' 변경';if(mode==='stale-version')p.factReview!.readyVersion!--;if(mode==='before-card')proposal.beforeCards[0]!.body+=' 변조';if(mode==='before-claim')proposal.beforeClaims[0]!.claim.text+=' 변조';if(mode==='missing-report')delete proposal.semanticReview;if(mode==='stale-report')proposal.semanticReview!.inputHash='0'.repeat(64);if(mode==='report-scope')proposal.semanticReview!.reviewedCardIds=[];if(mode==='selection')proposal.semanticReview!.reviewer={provider:'agy',model:'gemini-3.8-flash-low'};
 const before=structuredClone(p);expect(()=>applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:mode==='wrong-run'?I.project:I.run})).toThrow(/FACT_PROPOSAL_STALE|FACT_REVIEW_FAILED/);expect(p).toEqual(before);
});
it.each(['supported','missing','unsupported','unverifiable','stale'] as const)('명시 합성 report 정책: 원문10→원고999 후보의 저장/적용과 실제 최종승인 admission을 구별한다: %s',async mode=>{
 // 이 테스트의 report는 fake 정책 대역입니다. 실제 모델이 999를 검출했다고 주장하지 않습니다.
 const dataDir=resolve('실행데이터/실사용검수복구/의미경계',randomUUID()),dbPath=resolve(dataDir,'검사.sqlite');const store=await createStore({dataDir,dbPath,dataMode:'mock'});
 try{
  const created=await store.createProject({topic:'합성 최종승인 경계',createRequestId:randomUUID()});if(!('data'in created.body))throw Error('create');const projectId=created.body.data.projectId;
  const {p,content}=fixture(projectId,'Al Jazeera의 수치는 999명이다.');const verdict=mode==='unsupported'?'unsupported':mode==='unverifiable'?'unverifiable':'supported';const fake=syntheticReport(buildSemanticReviewInput(p,content),undefined,verdict);
  saveFactProposal(p,I.run,{...content,semanticReview:fake});p.projectVersion++;applyFactProposal(p,{requestId:randomUUID(),version:p.projectVersion,reviewRunId:I.run});
  expect(p.result!.semanticReview!.verdict).toBe(verdict);expect(checkStoredFacts(p,p.result!)).toBe(verdict==='supported'?'passed':verdict==='unsupported'?'failed':'pending');
  // 실제 렌더 아님: 승인 직전 ready 상태만 명시 합성 조립하며 파일/제공자는 호출하지 않습니다.
  p.stage='review';p.status='ready';p.result!.factsCheck='passed';p.result!.visualCheck='passed';for(const c of p.result!.cards){c.state='ready';c.previewAssetId=I.preview;}
  if(mode==='missing')delete p.result!.semanticReview;if(mode==='stale')p.result!.cards[0]!.body+=' 변경';
  const db=new Database(dbPath);try{db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),projectId);}finally{db.close();}
  const before=await store.getProject(projectId);const out=await store.mutate('approve',{projectId},{requestId:randomUUID(),version:before.result!.version,stage:'final'});const after=await store.getProject(projectId);
  if(mode==='supported'){expect(out.status).toBe(202);expect(after.result!.finalApprovedVersion).toBe(after.result!.version);}
  // 명시 ACK 없는 엄격 승인은 거절되지만, 사용자 직접 확인 경로의 행동은 노출합니다.
  else{expect(out.status).toBe(409);expect('error'in out.body&&out.body.error.code).toBe('STAGE_CONFLICT');expect(after.projectVersion).toBe(before.projectVersion);expect(after.result!.finalApprovedVersion).toBeNull();expect(after.activeRun).toBeNull();expect(after.allowedActions).toContain('approve_final');expect(factIssues(after).some(i=>i.code.startsWith('SEMANTIC_REVIEW_'))).toBe(true);}
 }finally{await store.close();}
});
