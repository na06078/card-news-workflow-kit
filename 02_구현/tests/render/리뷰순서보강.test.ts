import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {strFromU8} from 'fflate';
import {review} from '../backend/도움.js';
import {buildExport} from '../../src/render/내보내기.js';
import {verifyZip} from '../../src/render/압축검사.js';
import type {ExportInput,ImageProvenance} from '../../src/shared/포트.js';

async function approvedInput():Promise<ExportInput>{
 const {s,target,assets}=await review('실행데이터/리뷰보강/내보내기');
 try{
  const before=await s.getProject(target.projectId);
  const response=await s.mutate('approve',target,{requestId:randomUUID(),version:before.result!.version,stage:'final',acknowledgeWarnings:true});
  expect(response.status).toBe(202);
  const p=await s.getProject(target.projectId);
  return {projectId:p.projectId,runId:p.activeRun!.runId,attempt:1,result:p.result!,period:p.period,sources:p.sources,claims:p.claims,
   manifest:p.result!.cards.map(c=>({cardId:c.cardId,revision:c.revision,order:c.order,asset:assets.find(a=>a.assetId===c.previewAssetId)!})),
   imageRecords:p.result!.cards.map(c=>{const image=assets.find(a=>a.assetId===c.imageAssetId)!;return {cardId:c.cardId,cardRevision:c.revision,image,provenance:image.provenance as ImageProvenance};}),
   fontLicensePath:resolve('assets/render/OFL.txt'),outputDir:resolve('실행데이터/리뷰보강/내보내기',randomUUID())};
 }finally{await s.close();}
}

test('접수 가능한 비정렬 카드 배열도 순서대로 실제 PNG와 ZIP을 만들며 입력 승인은 변경하지 않는다',async()=>{
 const input=await approvedInput();
 input.result.cards.reverse();input.manifest=[...input.manifest].reverse();
 const before=JSON.stringify(input),ordered=[...input.result.cards].sort((a,b)=>a.order-b.order);
 const out=await buildExport(input);
 const zip=await readFile(out.assets.find(a=>a.mimeType==='application/zip')!.absolutePath);
 const contents=verifyZip(zip,['01.png','02.png','출처기록.json','이미지기록.json','글꼴라이선스.txt']);
 const record=JSON.parse(strFromU8(contents['출처기록.json']));
 expect(record.cards.map((c:{cardId:string})=>c.cardId)).toEqual(ordered.map(c=>c.cardId));
 expect(record.manifest.map((m:{cardId:string})=>m.cardId)).toEqual(ordered.map(c=>c.cardId));
 for(const [i,card] of ordered.entries()){
  const name=String(i+1).padStart(2,'0')+'.png',asset=input.manifest.find(m=>m.cardId===card.cardId)!.asset;
  expect(Buffer.from(contents[name]!)).toEqual(await readFile(asset.absolutePath));
  expect(out.entries.find(e=>e.filename===name)!.cardId).toBe(card.cardId);
 }
 expect(record.review.manualApproval).toEqual(input.result.manualApproval);
 expect(JSON.stringify(input)).toBe(before);
});

test('manifest 배열만 다르게 정렬돼도 ID·개정·순서 검사를 유지하고 정확한 카드를 연결한다',async()=>{
 const input=await approvedInput();input.manifest=[...input.manifest].reverse();
 const out=await buildExport(input);
 expect(out.entries.filter(e=>e.kind==='png').map(e=>e.cardId)).toEqual(input.result.cards.map(c=>c.cardId));
});

test('정렬은 중복 순서와 서로 다른 카드·개정·자산 연결을 정상화해 숨기지 않는다',async()=>{
 const input=await approvedInput();
 for(const mode of ['duplicate','card','revision','order','asset'] as const){
  const bad=structuredClone(input);
  if(mode==='duplicate')bad.manifest[1]!.order=bad.manifest[0]!.order;
  if(mode==='card')bad.manifest[0]!.cardId=randomUUID();
  if(mode==='revision')bad.manifest[0]!.revision++;
  if(mode==='order')bad.manifest[0]!.order=100;
  if(mode==='asset')bad.manifest[0]!.asset.assetId=randomUUID();
  await expect(buildExport(bad)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
 }
});
