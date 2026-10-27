import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,enqueueProduction,applySyntheticSemanticReview} from './도움.js';
import {fakeImage,fakeRender} from './합성자산.js';
import {RevisionRequestSchema,type ProjectSnapshot} from '../../src/shared/포트.js';
const content=(p:ProjectSnapshot)=>({claims:p.claims,sources:p.sources,storyboard:p.storyboard,cards:p.result!.cards.map(c=>({id:c.cardId,title:c.title,body:c.body,sourceIds:c.sourceIds,imagePlan:c.imagePlan,imageAssetId:c.imageAssetId}))});
test('명시 renderOnly layout은 현재 원고/그림을 보존한 새 버전을 모델 호출 없이 재합성한다',async()=>{
 const s=await setup('실행데이터/가독성개선/연결'),o=options(s);o.agy.generate=vi.fn(fakeImage);o.renderCard=vi.fn(fakeRender);o.createClaudeAdapter=vi.fn(()=>{throw Error('UNEXPECTED_PROVIDER_CALL');});const w=createWorker(o);
 try{
  await enqueueProduction(s,true);await w.tick();const before=await applySyntheticSemanticReview(s,w);const imageCalls=vi.mocked(o.agy.generate).mock.calls.length,renderCalls=vi.mocked(o.renderCard).mock.calls.length;
  const accepted=await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:before.result!.version,scope:'layout',renderOnly:true,cardIds:before.result!.cards.map(c=>c.cardId),instruction:'표시 규칙만 새 버전 재합성'} as any);expect(accepted.status).toBe(202);
  expect(await w.tick()).toBe(true);const after=await s.store.getProject(s.pid);expect(after.lastRun?.status).toBe('succeeded');expect(after.result!.version).toBe(before.result!.version+1);expect(content(after)).toEqual(content(before));expect(after.result!.semanticReview).toEqual(before.result!.semanticReview);expect(after.result!.factsCheck).toBe('passed');expect(after.result!.finalApprovedVersion).toBeNull();expect(after.result!.cards.every(c=>c.state==='ready')).toBe(true);
  expect(o.createClaudeAdapter).not.toHaveBeenCalled();expect(vi.mocked(o.agy.generate).mock.calls.length).toBe(imageCalls);expect(vi.mocked(o.renderCard).mock.calls.length-renderCalls).toBe(before.result!.cards.length);
  for(const [input] of vi.mocked(o.renderCard).mock.calls.slice(renderCalls)){expect(input.templateVersion).toBe('cn-basic-2');for(const label of input.sourceLabels){const source=before.sources.find(s=>s.sourceId===label.sourceId)!;expect(label.label).toBe(source.publisher??new URL(source.url).hostname);expect(label.url).toBe(source.url);}}
  for(const c of after.result!.cards){const old=before.result!.cards.find(x=>x.cardId===c.cardId)!;expect(c.revision).toBe(old.revision+1);expect(c.previewAssetId).not.toBe(old.previewAssetId);expect((await s.store.getAsset(s.pid,old.previewAssetId!)).assetId).toBe(old.previewAssetId);}
 }finally{await w.dispose();await s.store.close();}
});
test('재사용 배경이 없는 renderOnly는 버전/실행을 만들기 전에 거절한다',async()=>{
 const s=await setup('실행데이터/가독성개선/연결'),o=options(s);o.agy.generate=vi.fn(async()=>{throw Error('SYNTHETIC_IMAGE_FAILURE');});o.renderCard=vi.fn(fakeRender);const w=createWorker(o);
 try{await enqueueProduction(s,true);await w.tick();const before=await s.store.getProject(s.pid);expect(before.lastRun?.status).toBe('failed');const card=before.result!.cards.find(c=>c.imageAssetId===null)!;expect(card).toBeDefined();
  const out=await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:before.result!.version,scope:'layout',renderOnly:true,cardIds:[card.cardId],instruction:'없는 그림 재사용 금지'});
  expect(out).toMatchObject({body:{error:{code:'ASSET_INVALID'}}});const after=await s.store.getProject(s.pid);expect(after.projectVersion).toBe(before.projectVersion);expect(after.result).toEqual(before.result);expect(after.activeRun).toBeNull();expect(o.renderCard).not.toHaveBeenCalled();
 }finally{await w.dispose();await s.store.close();}
});
