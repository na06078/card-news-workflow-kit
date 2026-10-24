import {test,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import type {RenderOutput} from '../../src/shared/포트.js';
import {fixture,data,hash} from './자료.js';
let square:RenderOutput;
test('한국어 TEST fixture를 실제 1080 PNG로 렌더하고 픽셀을 연다',async()=>{
 expect(existsSync(resolve('src/render/렌더러.ts'))).toBe(true);
 const {renderCard}=await import('../../src/render/렌더러.js');const input=await fixture();const before=JSON.stringify(input);await writeFile(resolve(data,'TEST-정사각-입력.json'),JSON.stringify(input,null,2));
 square=await renderCard(input);const b=await readFile(square.path);const p=PNG.sync.read(b,{checkCRC:true});
 expect([p.width,p.height]).toEqual([1080,1080]);expect(square.checks).toEqual({fontLoaded:true,imageDecoded:true,overflow:false});
 expect(square.sha256).toBe(hash(b));expect(square.cardRevision).toBe(1);expect(JSON.stringify(input)).toBe(before);
 expect(new Set(p.data).size).toBeGreaterThan(100);expect(p.data[(80*1080+80)*4+3]).toBe(255);
 await writeFile(resolve(data,'정사각-측정.json'),JSON.stringify(square,null,2));
},30000);
