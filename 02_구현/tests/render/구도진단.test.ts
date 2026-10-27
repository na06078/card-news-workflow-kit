import {test,expect} from 'vitest';

import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture,hash} from './자료.js';
import {singleBrowser} from './단일브라우저.js';
import {renderCard} from '../../src/render/렌더러.js';
const lengths=[[21,84],[21,109],[20,235],[20,254],[15,98],[21,119],[15,164]];
for(const size of ['1080x1080','1080x1350'] as const)for(const [n,[titleLength,bodyLength]] of lengths.entries())test(`${size}: 길이${bodyLength} 전체 원고·그림 영역 보존`,async()=>{
 const monitor=singleBrowser();
 try{
  const i=await fixture(`TEST-길이-${size}-${n+1}`);i.size=size;i.card.role=n===0?'cover':n===6?'closing':'body';i.card.title='근거와원문을확인합니다'.repeat(3).slice(0,titleLength);i.card.body='원문과그림을보존하면서내용을잘라내지않고조건을함께확인합니다. '.repeat(10).slice(0,bodyLength);
  expect(hash(await readFile(i.image.absolutePath))).toBe(i.image.sha256);
  const out=await renderCard(i);expect(out.checks.overflow).toBe(false);
  const m=monitor.measurements[0];
  expect([m.image.x,m.image.y,m.image.width,m.image.height]).toEqual([0,0,1080,size==='1080x1350'?1350:1080]);expect(m.artwork.centerYRatio).toBeCloseTo(.3,6);expect(m.footerBackground).toBe('rgba(0, 0, 0, 0)');expect(m.main.bottom).toBeLessThan(m.footer.top);expect(parseFloat(m.bodyFont)).toBeGreaterThanOrEqual(36);expect([m.title,m.body]).toEqual([i.card.title,i.card.body]);
  expect(hash(await readFile(i.image.absolutePath))).toBe(i.image.sha256);
  await writeFile(resolve(i.outputPath,`../구도-${size}-${bodyLength}.json`),JSON.stringify(m,null,2));
 }finally{monitor.restore();}
},60000);

