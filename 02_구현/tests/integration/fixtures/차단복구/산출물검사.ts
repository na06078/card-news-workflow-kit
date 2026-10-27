import {expect} from 'vitest';
import {PNG} from 'pngjs';
import {unzipSync} from 'fflate';
import {crc32} from 'node:zlib';
import type * as C from '../../../../src/shared/포트.js';
import {digest,type FactHost} from './호스트.js';
/** 생산 ZIP 검사기를 재사용하지 않는 독립 중앙/로컬 헤더·CRC 검사. */
export function inspectZip(bytes:Buffer){
 const end=bytes.length-22;expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
 const count=bytes.readUInt16LE(end+10),files=unzipSync(bytes);expect(Object.keys(files)).toHaveLength(count);
 let pos=bytes.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  expect(bytes.readUInt32LE(pos)).toBe(0x02014b50);
  const nl=bytes.readUInt16LE(pos+28),el=bytes.readUInt16LE(pos+30),cl=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42),name=bytes.subarray(pos+46,pos+46+nl).toString('utf8'),crc=bytes.readUInt32LE(pos+16),size=bytes.readUInt32LE(pos+24);
  expect(bytes.readUInt16LE(pos+10)).toBe(0);expect(crc32(files[name]!)).toBe(crc);expect(files[name]!.length).toBe(size);
  expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);expect(bytes.readUInt32LE(offset+14)).toBe(crc);
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);
  expect(bytes.subarray(start,start+size)).toEqual(Buffer.from(files[name]!));pos+=46+nl+el+cl;
 }
 expect(pos).toBe(end);return files;
}
export async function verifyDownloads(h:FactHost,a:Awaited<ReturnType<FactHost['api']>>,p:C.ProjectSnapshot){
 const list=await a.client.getExports(p.projectId);expect(list.entries).toHaveLength(6);
 const received=new Map<string,Buffer>();
 for(const e of list.entries){
  const r=await a.get(e.downloadUrl);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain(e.mimeType);
  const bytes=Buffer.from(await r.arrayBuffer());expect(bytes.length).toBe(e.bytes);expect(digest(bytes)).toBe(e.sha256);received.set(e.filename,bytes);
  if(e.kind==='png'){const png=PNG.sync.read(bytes,{checkCRC:true});expect([png.width,png.height]).toEqual([1080,1080]);const card=p.result!.cards.find(c=>c.cardId===e.cardId)!;expect(digest(bytes)).toBe((await h.store.getAsset(p.projectId,card.previewAssetId!)).sha256);}
 }
 const zipped=inspectZip(received.get('카드뉴스.zip')!);expect(Object.keys(zipped).sort()).toEqual(['01.png','02.png','출처기록.json','이미지기록.json','글꼴라이선스.txt'].sort());
 for(const [name,bytes] of Object.entries(zipped))expect(digest(bytes)).toBe(digest(received.get(name)!));
 const records=JSON.parse(Buffer.from(zipped['출처기록.json']!).toString('utf8'));
 expect(records.claims).toEqual(p.claims);expect(records.sources).toEqual(p.sources);expect(records.cards[0].body).toBe(p.result!.cards[0]!.body);
 const damaged=Buffer.from(received.get('카드뉴스.zip')!);damaged[damaged.readUInt32LE(damaged.length-6)+16]^=1;expect(()=>inspectZip(damaged)).toThrow();
 await h.save('다운로드검사.json',{entries:list.entries,zipNames:Object.keys(zipped),zipCrcAndHashVerified:true,corruptCrcRejected:true,independentSourceTruth:false});return list;
}
