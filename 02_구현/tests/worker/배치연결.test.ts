import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,enqueueProduction,confirmed} from './도움.js';
import {fakeImage,fakeRender} from './합성자산.js';
import type {CardLayout,ProjectSnapshot,RevisionRequest,CardRevision} from '../../src/shared/포트.js';
import {renderCard} from '../../src/render/렌더러.js';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const layout:CardLayout={fontScale:'small',textAlign:'center',placement:'top'};
test('layout instruction은 공급자→실제 B1→renderer로 전달되고 image/비대상 승인은 보존된다',async()=>{
 const s=await setup(),o=options(s);o.agy.generate=vi.fn(fakeImage);o.renderCard=vi.fn(renderCard);const calls:string[]=[];
 o.createClaudeAdapter=({bridge})=>({async *start(c,raw){const {snapshot,request}=raw as {snapshot:ProjectSnapshot;request:RevisionRequest};calls.push(request.instruction);yield await bridge.publishResult(c,{kind:'cards',cards:snapshot.result!.cards.filter(x=>request.cardIds.includes(x.cardId)).map(x=>({...x,layout})),factsCheck:'pending',visualCheck:'pending'});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[]});
 const w=createWorker(o);try{await enqueueProduction(s);await w.tick();let p=await s.store.getProject(s.pid);const before=structuredClone(p.result!.cards);await s.store.mutate('cardApprove',{projectId:s.pid,cardId:before[1].cardId},{version:1,resultVersion:1,requestId:randomUUID()});const other=(await s.store.getProject(s.pid)).result!.cards[1];await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:1,scope:'layout',instruction:'작게, 가운데, 위 배치',cardIds:[before[0].cardId]});await w.tick();p=await s.store.getProject(s.pid);expect(calls).toEqual(['작게, 가운데, 위 배치']);expect(p.lastRun?.status).toBe('succeeded');const target=p.result!.cards[0];expect(target.layout).toEqual(layout);for(const key of ['title','body','sourceIds','imagePlan','imageAssetId'] as const)expect(target[key]).toEqual(before[0][key]);expect(p.result!.cards[1]).toEqual(other);expect(vi.mocked(o.agy.generate).mock.calls).toHaveLength(2);expect(vi.mocked(o.renderCard).mock.calls.at(-1)![0].card.layout).toEqual(layout);
 const oldPreview=await s.store.getAsset(s.pid,before[0].previewAssetId!),newPreview=await s.store.getAsset(s.pid,target.previewAssetId!),original=await s.store.getAsset(s.pid,target.imageAssetId!);expect(newPreview.sha256).not.toBe(oldPreview.sha256);expect(createHash('sha256').update(await readFile(original.absolutePath)).digest('hex')).toBe(original.sha256);await writeFile(resolve(s.dataDir,'실제DB-렌더증거.json'),JSON.stringify({before,after:p.result,oldPreview,newPreview,original},null,2));
 }finally{await w.dispose();await s.store.close();}
},30000);
test('text/image 후속 수정은 이미 저장된 layout을 그대로 보존한다',async()=>{
 const s=await setup(),o=options(s);o.agy.generate=fakeImage;o.renderCard=fakeRender;
 o.createClaudeAdapter=({bridge})=>({async *start(c,raw){const {snapshot,request}=raw as {snapshot:ProjectSnapshot;request:RevisionRequest};yield await bridge.publishResult(c,{kind:'cards',cards:snapshot.result!.cards.filter(x=>request.cardIds.includes(x.cardId)).map(x=>request.scope==='layout'?{...x,layout}:{...x,title:x.title+' 수정'}),factsCheck:'pending',visualCheck:'pending'});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[]});const w=createWorker(o);
 try{await enqueueProduction(s);await w.tick();for(const scope of ['layout','text','image'] as const){const p=await s.store.getProject(s.pid);await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:p.result!.version,scope,instruction:'명시 범위 수정',cardIds:[p.result!.cards[0].cardId]});await w.tick();const next=await s.store.getProject(s.pid);expect(next.lastRun?.status).toBe('succeeded');expect(next.result!.cards[0].layout).toEqual(layout);}}finally{await w.dispose();await s.store.close();}
});
for(const scope of ['text','image','layout'] as const)test(`B1 ${scope} 범위 밖 layout/내용 변경은 롤백한다`,async()=>{
 const s=await setup(),o=options(s);o.agy.generate=fakeImage;o.renderCard=fakeRender;const w=createWorker(o);
 try{await enqueueProduction(s);await w.tick();let p=await s.store.getProject(s.pid);const card=p.result!.cards[0];await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:1,scope,cardIds:[card.cardId],instruction:'범위 검사'});const j=(await s.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'}))!;const before=await s.store.getProject(s.pid),target=before.result!.cards[0];const bad:CardRevision=scope==='layout'?{...target,title:'금지 변경',layout}:{...target,layout};await expect(s.store.commit(j.fence,{type:'content',content:{kind:'cards',cards:[bad],factsCheck:'pending',visualCheck:'pending'}})).rejects.toMatchObject({error:{code:'STAGE_CONFLICT'}});expect(await s.store.getProject(s.pid)).toEqual(before);
 if(scope==='layout')await expect(s.store.commit(j.fence,{type:'content',content:{kind:'cards',cards:[target],factsCheck:'pending',visualCheck:'pending'}})).rejects.toMatchObject({error:{code:'STAGE_CONFLICT'}});
 }finally{await w.dispose();await s.store.close();}
});
