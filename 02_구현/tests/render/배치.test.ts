import {test,expect} from 'vitest';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {chromium} from 'playwright';
import {singleBrowser} from './단일브라우저.js';
import {renderCard} from '../../src/render/렌더러.js';
import {cardHtml} from '../../src/render/카드템플릿.js';
import type {RenderInput,CardLayout} from '../../src/shared/포트.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
for(const role of ['cover','body','closing'] as const)for(const size of ['1080x1080','1080x1350'] as const)test(`${role}/${size}: 동일 그림·문구에서 실제 글자 크기/정렬/상단 배치와 PNG가 바뀐다`,async()=>{
 const monitor=singleBrowser();
 const dir=resolve(process.env.CARDNEWS_RENDER_TEST_DIR??'실행데이터/W1',`배치렌더-${role}-${size}-${randomUUID()}`);await mkdir(dir,{recursive:true});const png=new PNG({width:32,height:32});png.data.fill(150);for(let i=3;i<png.data.length;i+=4)png.data[i]=255;const image=PNG.sync.write(png);const imagePath=resolve(dir,'image.png');await writeFile(imagePath,image);const aid=randomUUID();
 const base:RenderInput={projectId:randomUUID(),runId:randomUUID(),attempt:1,resultVersion:1,card:{cardId:randomUUID(),revision:1,order:1,role,title:'안전한 배치',body:'같은 문구와 같은 원본 그림',sourceIds:[],imagePlan:'TEST',imageAssetId:aid,previewAssetId:null,state:'rendering',approvedRevision:null,error:null},size,image:{assetId:aid,absolutePath:imagePath,sha256:hash(image)},researchAt:'2026-10-23T00:00:00.000Z',sourceLabels:[],font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},templateVersion:'cn-basic-1',outputPath:resolve(dir,'default.png')};
 const layout:CardLayout={fontScale:'small',textAlign:'center',placement:'top'},changed:RenderInput={...base,card:{...base.card,layout},outputPath:resolve(dir,'changed.png')};
 const css=await readFile(resolve('src/render/카드스타일.css'),'utf8'),font=await readFile(base.font.absolutePath);const browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 try{const context=await browser.newContext({offline:true,viewport:{width:1080,height:size==='1080x1080'?1080:1350},serviceWorkers:'block'});await context.route('**/*',r=>r.abort());const page=await context.newPage();
 const measure=async(input:RenderInput)=>{await page.setContent(cardHtml(input,css,image,font));await page.evaluate(()=>document.fonts.ready);return page.evaluate(()=>{const h=document.querySelector('h1')!,p=document.querySelector('p')!,m=document.querySelector('.main')!,f=document.querySelector('footer')!;return {font:parseFloat(getComputedStyle(h).fontSize),bodyFont:parseFloat(getComputedStyle(p).fontSize),align:getComputedStyle(h).textAlign,top:m.getBoundingClientRect().top,bottom:m.getBoundingClientRect().bottom,footer:f.getBoundingClientRect().top,title:h.textContent,body:p.textContent};});};
 const a=await measure(base),b=await measure(changed);expect(b.font).toBeLessThan(a.font);expect(b.bodyFont).toBeLessThan(a.bodyFont);expect(a.align).toBe('left');expect(b.align).toBe('center');expect(b.top).toBeLessThan(a.top);expect(b.bottom).toBeLessThan(b.footer);expect([b.title,b.body]).toEqual([a.title,a.body]);
 const normal=await measure({...base,card:{...base.card,layout:{fontScale:'normal',textAlign:'left',placement:'bottom'}}});expect(normal).toEqual(a);
 const large=await measure({...base,card:{...base.card,layout:{fontScale:'large',textAlign:'left',placement:'bottom'}}});expect(large.font).toBeGreaterThan(a.font);
 await browser.close();
 const first=await renderCard(base),second=await renderCard(changed);expect(first.sha256).not.toBe(second.sha256);expect(first.checks).toEqual(second.checks);expect(hash(await readFile(imagePath))).toBe(base.image.sha256);const decoded=PNG.sync.read(await readFile(second.path));expect([decoded.width,decoded.height]).toEqual([1080,size==='1080x1080'?1080:1350]);await writeFile(resolve(dir,'측정.json'),JSON.stringify({base:a,changed:b,normal,large,first,second,imageSha256:base.image.sha256},null,2));
 }finally{await browser.close();monitor.restore();}
},30000);
