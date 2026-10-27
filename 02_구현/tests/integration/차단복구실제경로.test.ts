import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {rename} from 'node:fs/promises';
import {startFacts,prepareFacts,submitReview,afterText,digest,type ReceiptMode} from './fixtures/차단복구/호스트.js';
import {verifyDownloads} from './fixtures/차단복구/산출물검사.js';
import {verifyBrowser} from './fixtures/차단복구/브라우저.js';
import type * as C from '../../src/shared/포트.js';
const content=(p:C.ProjectSnapshot)=>({storyboard:p.storyboard,result:p.result,claims:p.claims,sources:p.sources,exports:p.exports});

test('실제 HTTP→worker→SDK 관측 제안→명시 적용→부분 Chromium 렌더→승인→ZIP/PNG',async()=>{
 const h=await startFacts();try{
  const {a,id,p:initial}=await prepareFacts(h);expect(initial.lastRun?.status).toBe('succeeded');expect(initial.result?.cards.every(c=>c.state==='ready')).toBe(true);expect(h.calls.syntheticImage).toBe(2);expect(h.counters.adapter).toBe(0);
  expect(initial.result?.factsCheck).toBe('failed');expect((await a.post(`/api/projects/${id}/approve`,{stage:'final',version:initial.result!.version,requestId:randomUUID()})).status).toBe(409);
  const healthy=initial.result!.cards[1]!;
  await a.client.mutate('cardApprove',{projectId:id,cardId:healthy.cardId},{version:healthy.revision,resultVersion:initial.result!.version,requestId:randomUUID()});
  const before=await a.client.getProject(id),retained=structuredClone(before.result!.cards[1]!);
  const retainedImage=await h.store.getAsset(id,retained.imageAssetId!),retainedPreview=await h.store.getAsset(id,retained.previewAssetId!);
  const hashes={content:digest(JSON.stringify(retained)),image:await h.hash(retainedImage.absolutePath),preview:await h.hash(retainedPreview.absolutePath),approval:retained.approvedRevision};await h.save('보존기준.json',{before,retained,hashes});
  const {input,response}=await submitReview(h,a,before);const replay=await a.post(`/api/projects/${id}/factReview`,input);expect(replay.body).toEqual(response.body);expect(replay.replayed).toBe(true);
  await h.worker.tick();const ready=await a.client.getProject(id);await h.save('제안준비.json',ready);
  expect(ready.lastRun?.status).toBe('succeeded');expect(ready.factReview?.state).toBe('ready');expect(ready.factReview?.readyVersion).toBe(ready.projectVersion);expect(content(ready)).toEqual(content(before));
  const proposal=ready.factReview!.proposal!;expect(proposal.observations).toEqual([expect.objectContaining({toolUseId:'observed-fetch',statusCode:200,outcome:'opened',bytes:Buffer.byteLength(afterText),evidenceSha256:digest(afterText)})]);expect(proposal.beforeClaims[0]?.claim).toEqual(before.claims[0]);expect(proposal.cards[0]?.body).toContain(proposal.findings[0]!.afterClaim.text);
  expect((await a.post(`/api/projects/${id}/approve`,{stage:'final',version:ready.result!.version,requestId:randomUUID()})).status).toBe(409);
  const reviewRunId=ready.factReview!.runId;
  expect((await a.post(`/api/projects/${id}/factApply`,{version:before.projectVersion,reviewRunId,requestId:randomUUID()})).status).toBe(409);
  expect((await a.post(`/api/projects/${id}/factApply`,{version:ready.projectVersion,reviewRunId:randomUUID(),requestId:randomUUID()})).status).toBe(409);
  const foreign=await a.client.createProject({topic:'합성 독립 범위',createRequestId:randomUUID()});expect((await a.post(`/api/projects/${foreign.projectId}/factApply`,{version:1,reviewRunId,requestId:randomUUID()})).status).toBe(409);
  expect(content(await a.client.getProject(id))).toEqual(content(before));
  const counts={...h.counters,image:h.calls.syntheticImage};const apply={version:ready.projectVersion,reviewRunId,requestId:randomUUID()};const accepted=await a.post(`/api/projects/${id}/factApply`,apply);expect(accepted.status).toBe(202);expect((await a.post(`/api/projects/${id}/factApply`,apply)).body).toEqual(accepted.body);
  let p=await a.client.getProject(id);expect(p.result!.version).toBe(before.result!.version+1);expect(p.result!.finalApprovedVersion).toBeNull();expect(p.exports).toEqual([]);expect(p.result!.cards[0]!.approvedRevision).toBeNull();expect(p.result!.cards[1]).toEqual(retained);expect(p.claims[1]).toEqual(before.claims[1]);expect(p.sources.slice(0,before.sources.length)).toEqual(before.sources);expect(p.sources).toHaveLength(before.sources.length+1);expect((await a.get(`/api/projects/${id}/exports`)).status).toBe(409);
  await h.worker.tick();p=await a.client.getProject(id);await h.save('적용렌더후.json',p);expect(p.lastRun?.status).toBe('succeeded');expect(p.result!.factsCheck).toBe('passed');expect(p.result!.visualCheck).toBe('passed');expect(p.factIssues).toEqual([]);expect(p.result!.cards[0]!.body).toBe(afterText);expect(p.result!.cards[0]!.imageAssetId).toBe(before.result!.cards[0]!.imageAssetId);expect(p.result!.cards[0]!.previewAssetId).not.toBe(before.result!.cards[0]!.previewAssetId);
  expect(p.result!.cards[1]).toEqual(retained);expect(await h.hash(retainedImage.absolutePath)).toBe(hashes.image);expect(await h.hash(retainedPreview.absolutePath)).toBe(hashes.preview);expect(digest(JSON.stringify(p.result!.cards[1]))).toBe(hashes.content);expect({...h.counters,image:h.calls.syntheticImage}).toEqual(counts);
  await a.client.mutate('approve',{projectId:id},{stage:'final',version:p.result!.version,requestId:randomUUID()});await h.worker.tick();p=await a.client.getProject(id);const first=await verifyDownloads(h,a,p);
  // 이번 격리 실행에서 생성한 ZIP만 이동하여 실제 파일 조회 오류를 발생시킵니다.
  const zip=first.entries.find(e=>e.kind==='zip')!,asset=await h.store.getDownload(id,zip.exportId);await rename(asset.absolutePath,asset.absolutePath+'.보존');
  expect((await a.get(zip.downloadUrl)).status).not.toBe(200);await expect(a.client.getExports(id)).rejects.toBeTruthy();
  const approved=structuredClone(p.result);await a.client.mutate('rebuildExports',{projectId:id},{version:p.projectVersion,requestId:randomUUID()});await h.worker.tick();p=await a.client.getProject(id);expect(p.result).toEqual(approved);await verifyDownloads(h,a,p);expect(p.exports.find(e=>e.kind==='zip')!.exportId).not.toBe(zip.exportId);expect({...h.counters,image:h.calls.syntheticImage}).toEqual(counts);
  // 최종 승인·실제 파일이 존재하는 상태에서도 제안은 보존하고 적용만 무효화해야 합니다.
  const exported=await a.client.getProject(id),oldZip=exported.exports.find(e=>e.kind==='zip')!;
  await submitReview(h,a,exported);await h.worker.tick();const secondReady=await a.client.getProject(id);expect(content(secondReady)).toEqual(content(exported));expect(secondReady.result!.finalApprovedVersion).toBe(secondReady.result!.version);
  const localCounts={...h.counters,image:h.calls.syntheticImage};await a.client.mutate('factApply',{projectId:id},{version:secondReady.projectVersion,reviewRunId:secondReady.factReview!.runId,requestId:randomUUID()});
  const invalidated=await a.client.getProject(id);expect(invalidated.result!.finalApprovedVersion).toBeNull();expect(invalidated.exports).toEqual([]);expect((await a.get(oldZip.downloadUrl)).status).toBe(409);await h.worker.tick();expect({...h.counters,image:h.calls.syntheticImage}).toEqual(localCounts);
  await h.save('승인산출물무효화.json',{oldZip,invalidated,afterLocalRender:await a.client.getProject(id)});
  const recovered=await a.client.getProject(id);await a.client.mutate('approve',{projectId:id},{stage:'final',version:recovered.result!.version,requestId:randomUUID()});await h.worker.tick();await verifyDownloads(h,a,await a.client.getProject(id));expect({...h.counters,image:h.calls.syntheticImage}).toEqual(localCounts);
  await h.save('최종판정.json',{status:'passed',counters:h.counters,fakeImages:h.calls.syntheticImage,actualAIOrSourceTruth:false});
 }catch(error){await h.save('차단원인.json',{message:String(error),counters:h.counters});throw error;}finally{await h.close();}
},120000);

for(const mode of ['403','empty','model-tag-only'] as ReceiptMode[])test(`실제 adapter 음성 영수증 ${mode}: 모델 verified 태그로 미해소 주장 통과 금지`,async()=>{
 const h=await startFacts(mode);try{const {a,p,id}=await prepareFacts(h,false);await submitReview(h,a,p);await h.worker.tick();const failed=await a.client.getProject(id);await h.save('음성영수증판정.json',failed);expect(failed.lastRun?.status).toBe('failed');expect(failed.lastRun?.error?.code).toBe('FACT_REVIEW_FAILED');expect(failed.factReview?.state).not.toBe('ready');expect(failed.claims).toEqual(p.claims);expect(failed.sources).toEqual(p.sources);expect(failed.factIssues?.some(i=>i.claimIndex===0)).toBe(true);expect(h.calls.syntheticImage).toBe(0);expect(h.counters.fakeSdk).toBe(1);expect((await a.post(`/api/projects/${id}/factApply`,{version:failed.projectVersion,reviewRunId:failed.factReview!.runId,requestId:randomUUID()})).status).toBe(409);}finally{await h.close();}
},30000);

test('격리 실제 Vite/Chromium: 주장·카드 선택/관측 전후/명시 적용/다운로드 오류·재생성',async()=>{
 const h=await startFacts();try{const scenario=await prepareFacts(h);await verifyBrowser(h,scenario);}finally{await h.close();}
},120000);
