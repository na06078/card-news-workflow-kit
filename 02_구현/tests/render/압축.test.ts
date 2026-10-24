import {test,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {zipSync,unzipSync,strFromU8} from 'fflate';
import {crc32} from 'node:zlib';
import {buildExport} from '../../src/render/내보내기.js';
import {verifyZip} from '../../src/render/압축검사.js';
import {PNG} from 'pngjs';
import {renderCard} from '../../src/render/렌더러.js';
import type {ExportInput,VerifiedAsset,ImageProvenance} from '../../src/shared/포트.js';
import {fixture,data} from './자료.js';
export async function exportFixture():Promise<ExportInput>{
 const input=await fixture('TEST-출력원본');input.card.role='body';
 const out=await renderCard(input);const previewId=randomUUID();
 const provenance:ImageProvenance={tool:'agy',toolVersion:'TEST fixture ONLY — agy 실행 아님',generatedAt:input.researchAt,prompt:'TEST 직접 작성 기하학 이미지, 실제 생성 호출 없음',illustrative:true,usageConditions:'TEST 작성물 검증 전용',usageConditionsVerified:true,conversationId:null};
 const asset:VerifiedAsset={assetId:previewId,projectId:input.projectId,runId:input.runId,attempt:1,kind:'preview',absolutePath:out.path,mimeType:'image/png',bytes:out.bytes,sha256:out.sha256,width:out.width,height:out.height,provenance:null};
 const imgBytes=await readFile(input.image.absolutePath);
 return {projectId:input.projectId,runId:input.runId,attempt:1,result:{version:1,storyboardVersion:1,size:input.size,cards:[{...input.card,previewAssetId:previewId,state:'ready',approvedRevision:1}],factsCheck:'passed',visualCheck:'passed',finalApprovedVersion:1},manifest:[{cardId:input.card.cardId,revision:1,order:1,asset}],period:{days:7,anchorAt:input.researchAt,from:'2026-10-16T00:00:00.000Z',to:input.researchAt},sources:[],claims:[],imageRecords:[{cardId:input.card.cardId,cardRevision:1,image:{...asset,assetId:input.image.assetId,kind:'image',absolutePath:input.image.absolutePath,sha256:input.image.sha256,bytes:imgBytes.length,width:1080,height:1350,provenance},provenance}],fontLicensePath:resolve('assets/render/OFL.txt'),outputDir:resolve(data,'TEST-내보내기')};
}
test('현재 승인 manifest를 실제 ZIP으로 열고 PNG·출처·TEST 생성기록·OFL을 보존한다',async()=>{
 expect(existsSync(resolve('src/render/내보내기.ts'))).toBe(true);
 const {buildExport}=await import('../../src/render/내보내기.js');
 const input=await exportFixture();const before=JSON.stringify(input);const out=await buildExport(input);
 const zipAsset=out.assets.find(a=>a.mimeType==='application/zip')!;const bytes=await readFile(zipAsset.absolutePath);const contents=unzipSync(bytes);
 expect(Object.keys(contents)).toEqual(['01.png','출처기록.json','이미지기록.json','글꼴라이선스.txt']);
 expect(PNG.sync.read(Buffer.from(contents['01.png']),{checkCRC:true}).width).toBe(1080);
 expect(JSON.parse(strFromU8(contents['출처기록.json'])).period).toEqual(input.period);
 expect(JSON.parse(strFromU8(contents['이미지기록.json'])).imageRecords[0].provenance).toEqual(input.imageRecords[0].provenance);
 expect(strFromU8(contents['글꼴라이선스.txt'])).toContain('SIL OPEN FONT LICENSE');expect(JSON.stringify(input)).toBe(before);
 expect(out.entries).toHaveLength(5);
 await writeFile(resolve(data,'내보내기-측정.json'),JSON.stringify(out,null,2));await writeFile(resolve(data,'TEST-카드묶음.zip'),bytes);
},30000);

test('최종 미승인·stale 개정·교차 project manifest를 포트 경계에서 거절한다',async()=>{
 const i=await exportFixture();const unapproved=structuredClone(i);unapproved.result.finalApprovedVersion=null;
 await expect(buildExport(unapproved)).rejects.toMatchObject({error:{code:'FINAL_NOT_APPROVED'}});
 const stale=structuredClone(i);stale.manifest[0].revision=2;await expect(buildExport(stale)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
 const cross=structuredClone(i);cross.manifest[0].asset.projectId=randomUUID();await expect(buildExport(cross)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
 const missing=structuredClone(i);missing.manifest=[];await expect(buildExport(missing)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
},30000);

test('원본·미리보기·사용조건·출처 참조 변조와 output escape를 거절한다',async()=>{
 const i=await exportFixture();
 const tampered=structuredClone(i);tampered.manifest[0].asset.sha256='0'.repeat(64);await expect(buildExport(tampered)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const badSize=structuredClone(i);badSize.manifest[0].asset.width=42;await expect(buildExport(badSize)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const unknown=structuredClone(i);unknown.imageRecords[0].provenance.usageConditionsVerified=false;await expect(buildExport(unknown)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const changed=structuredClone(i);changed.imageRecords[0].image.sha256='0'.repeat(64);await expect(buildExport(changed)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const outside=structuredClone(i);outside.outputDir=resolve('../TEST-outside');await expect(buildExport(outside)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const orphan=structuredClone(i);orphan.claims=[{text:'TEST',sourceIds:[randomUUID()],kind:'uncertain',availability:'unknown',conditions:[]}];await expect(buildExport(orphan)).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
 const c=new AbortController();c.abort();await expect(buildExport(i,{signal:c.signal})).rejects.toMatchObject({error:{code:'EXPORT_FAILED'}});
},30000);

test('2장 manifest 순서·수량 및 원문과 claims 기록을 실제 ZIP에서 대조한다',async()=>{
 const i=await exportFixture();const second=structuredClone(i.result.cards[0]);second.cardId=randomUUID();second.order=2;second.previewAssetId=randomUUID();
 i.result.cards.push(second);i.manifest=[...i.manifest,{cardId:second.cardId,revision:1,order:2,asset:{...i.manifest[0].asset,assetId:second.previewAssetId}}];i.imageRecords.push({...i.imageRecords[0],cardId:second.cardId});
 const sid=randomUUID();i.sources=[{sourceId:sid,candidateId:randomUUID(),url:'https://example.org/test-source',title:'TEST 예시 · 실제 원문 확인 아님',publisher:'TEST',publishedDate:null,eventDate:null,accessedAt:null,primary:false,access:'not_opened',evidence:null,limitations:['로컬 fixture']}];i.claims=[{text:'TEST 검증 보류',sourceIds:[sid],kind:'uncertain',availability:'unknown',conditions:['TEST']}];i.result.cards[0].sourceIds=[sid];
 const out=await buildExport(i);const zip=await readFile(out.assets.find(a=>a.mimeType==='application/zip')!.absolutePath);
 const reopened=verifyZip(zip,['01.png','02.png','출처기록.json','이미지기록.json','글꼴라이선스.txt']);expect(Object.keys(reopened)).toHaveLength(5);
 const records=JSON.parse(strFromU8(reopened['출처기록.json']));expect(records.sources).toEqual(i.sources);expect(records.claims).toEqual(i.claims);expect(records.manifest.map((m:{cardId:string})=>m.cardId)).toEqual(i.result.cards.map(c=>c.cardId));
 const reversed=structuredClone(i);reversed.manifest=[...reversed.manifest].reverse();await expect(buildExport(reversed)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
 const reversedBoth=structuredClone(i);reversedBoth.manifest=[...reversedBoth.manifest].reverse();reversedBoth.result.cards.reverse();await expect(buildExport(reversedBoth)).rejects.toMatchObject({error:{code:'EXPORT_STALE'}});
 await writeFile(resolve(data,'ZIP-검사.json'),JSON.stringify({names:Object.keys(reopened),pngs:['01.png','02.png'].map(n=>{const p=PNG.sync.read(Buffer.from(reopened[n]),{checkCRC:true});return {name:n,width:p.width,height:p.height,crc32:crc32(reopened[n])};}),period:records.period},null,2));
},30000);

test('실제 CRC32 알려진 벡터와 ZIP payload/CRC/순서/수량 변조를 검출한다',()=>{
 expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
 const zip=Buffer.from(zipSync({'a.txt':Buffer.from('123456789')},{level:0}));expect(strFromU8(verifyZip(zip,['a.txt'])['a.txt'])).toBe('123456789');
 const corrupted=Buffer.from(zip);corrupted[35]^=1;expect(()=>verifyZip(corrupted,['a.txt'])).toThrow();
 const header=Buffer.from(zip);header[14]^=1;expect(()=>verifyZip(header,['a.txt'])).toThrow();
 expect(()=>verifyZip(zip,[])).toThrow();expect(()=>verifyZip(zip,['wrong.txt'])).toThrow();expect(()=>verifyZip(zip.subarray(0,-1),['a.txt'])).toThrow();
});
