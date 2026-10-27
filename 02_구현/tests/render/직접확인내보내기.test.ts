import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {strFromU8} from 'fflate';
import {PNG} from 'pngjs';
import {review} from '../backend/도움.js';
import {syntheticReport} from '../backend/의미검수대역.js';
import {buildSemanticReviewInput} from '../../src/providers/검수내용.js';
import {buildExport} from '../../src/render/내보내기.js';
import {verifyZip} from '../../src/render/압축검사.js';
import type {ExportInput,ImageProvenance} from '../../src/shared/포트.js';

async function fixture(){
 const state=await review();const {s,target,assets}=state;
 try{
  let p=await s.getProject(target.projectId);expect((await s.mutate('approve',target,{requestId:randomUUID(),version:p.result!.version,stage:'final',acknowledgeWarnings:true})).status).toBe(202);p=await s.getProject(target.projectId);
  p.result!.factsCheck='failed';p.result!.semanticReview=syntheticReport(buildSemanticReviewInput(p),undefined,'unsupported');
  const input:ExportInput={projectId:p.projectId,runId:p.activeRun!.runId,attempt:1,result:p.result!,period:p.period,sources:p.sources,claims:p.claims,manifest:p.result!.cards.map(c=>({cardId:c.cardId,revision:c.revision,order:c.order,asset:assets.find(a=>a.assetId===c.previewAssetId)!})),imageRecords:p.result!.cards.map(c=>{const image=assets.find(a=>a.assetId===c.imageAssetId)!;return {cardId:c.cardId,cardRevision:c.revision,image,provenance:image.provenance as ImageProvenance};}),fontLicensePath:resolve('assets/render/OFL.txt'),outputDir:resolve('실행데이터/검수간소화/export',randomUUID())};
  return input;
 }finally{await s.close();}
}
test('실제 ZIP·출처기록은 AI 실패와 직접 확인을 서로 구별하여 보존한다',async()=>{
 const input=await fixture(),before=JSON.stringify(input);const out=await buildExport(input);const zip=await readFile(out.assets.find(a=>a.mimeType==='application/zip')!.absolutePath);const names=['01.png','02.png','출처기록.json','이미지기록.json','글꼴라이선스.txt'];const contents=verifyZip(zip,names);
 const records=JSON.parse(strFromU8(contents['출처기록.json']));expect(records.review).toEqual({factsCheck:'failed',visualCheck:'passed',semanticReview:input.result.semanticReview,manualApproval:input.result.manualApproval});expect(records.sources).toEqual(input.sources);expect(records.claims).toEqual(input.claims);
 expect(PNG.sync.read(Buffer.from(contents['01.png']),{checkCRC:true}).width).toBe(1080);expect(strFromU8(contents['글꼴라이선스.txt'])).toContain('SIL OPEN FONT LICENSE');expect(JSON.stringify(input)).toBe(before);expect(out.entries).toHaveLength(6);
 const standalone=out.assets.find(a=>a.absolutePath.endsWith('출처기록.json'))!;expect(JSON.parse(await readFile(standalone.absolutePath,'utf8'))).toEqual(records);
});
test('직접 확인은 파일 해시·참조·사용조건·버전 보호를 해제하지 않는다',async()=>{
 const input=await fixture();
 for(const mode of ['hash','reference','conditions','manifest','proof'] as const){const bad=structuredClone(input);if(mode==='hash')bad.manifest[0].asset.sha256='0'.repeat(64);if(mode==='reference')bad.result.cards[0].sourceIds=[randomUUID()];if(mode==='conditions')bad.imageRecords[0].provenance.usageConditionsVerified=false;if(mode==='manifest')bad.manifest[0].revision++;if(mode==='proof')bad.result.manualApproval!.resultVersion++;await expect(buildExport(bad)).rejects.toMatchObject({error:{code:mode==='manifest'?'EXPORT_STALE':mode==='reference'?'EXPORT_STALE':'EXPORT_FAILED'}});}
 const missing=structuredClone(input);missing.result.finalApprovedVersion=null;await expect(buildExport(missing)).rejects.toMatchObject({error:{code:'FINAL_NOT_APPROVED'}});
});