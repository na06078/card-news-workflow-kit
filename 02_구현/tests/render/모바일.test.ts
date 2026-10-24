import {test,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {cardHtml} from '../../src/render/카드템플릿.js';
import {renderCard} from '../../src/render/렌더러.js';
import {fixture,data} from './자료.js';
test('375px 축소 참조의 본문·출처 크기를 재고 실제 PNG를 축소해 연다',async()=>{
 const i=await fixture('TEST-모바일원본');const out=await renderCard(i);
 const browser=await chromium.launch({headless:true,executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe')});
 try{
  const context=await browser.newContext({viewport:{width:375,height:375},offline:true,serviceWorkers:'block'});await context.route('**/*',r=>r.abort());
  const page=await context.newPage();const css=await readFile(resolve('src/render/카드스타일.css'),'utf8');
  await page.setContent(cardHtml(i,css,await readFile(i.image.absolutePath),await readFile(i.font.absolutePath)));await page.evaluate(()=>document.fonts.ready);
  const sizes=await page.evaluate(()=>Object.fromEntries(['h1','p','.sources','.meta'].map(s=>[s,parseFloat(getComputedStyle(document.querySelector(s)!).fontSize)*375/1080])));
  expect(sizes.p).toBeGreaterThanOrEqual(13);expect(sizes['.sources']).toBeGreaterThanOrEqual(12);expect(sizes['.meta']).toBeGreaterThanOrEqual(12);
  const bytes=await readFile(out.path);
  await page.setContent(`<html><head><style>html,body{margin:0}img{display:block;width:375px;height:375px}</style></head><body><img src="data:image/png;base64,${bytes.toString('base64')}"></body></html>`);
  await page.locator('img').evaluate((e:HTMLImageElement)=>e.decode());
  const shot=await page.screenshot({type:'png'});await writeFile(resolve(data,'TEST-375px-참조.png'),shot);const p=PNG.sync.read(shot,{checkCRC:true});expect([p.width,p.height]).toEqual([375,375]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
  await writeFile(resolve(data,'모바일-측정.json'),JSON.stringify({browser:browser.version(),viewport:375,fontEquivalentPx:sizes,readability:'NOT_VERIFIED: 기계적 크기 참조이며 실제 사람/vision 가독성 판정 아님'},null,2));
 }finally{await browser.close();}
},30000);
