import {expect} from 'vitest';
import {chromium,type Page,type Locator} from 'playwright';
import {resolve} from 'node:path';
import {rename} from 'node:fs/promises';
import {afterText,beforeText,type FactHost,type prepareFacts} from './호스트.js';
import {verifyDownloads} from './산출물검사.js';
async function hit(button:Locator){
 await button.scrollIntoViewIfNeeded();
 const result=await button.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:r.width,height:r.height,hit:!!top&&(top===el||el.contains(top))};});
 expect(result.width).toBeGreaterThanOrEqual(44);expect(result.height).toBeGreaterThanOrEqual(44);expect(result.hit).toBe(true);return result;
}
export async function verifyBrowser(h:FactHost,{a,id,p}:Awaited<ReturnType<typeof prepareFacts>>){
 const browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
 const blocked:string[]=[],errors:string[]=[],network:unknown[]=[],layouts:unknown[]=[];
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());return ['127.0.0.1','localhost','[::1]'].includes(u.hostname)?route.continue():(blocked.push(u.href),route.abort());
 });
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/'))network.push({url:r.url(),method:r.request().method(),status:r.status()});});
 async function capture(name:string){await page.screenshot({path:resolve(h.data,name+'.png'),fullPage:true});await h.save(name+'-DOM.json',{text:await page.locator('body').innerText(),errors,blocked});}
 async function open(){await page.goto(h.url+'/?project='+id);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();}
 async function measure(width:number,phase='initial'){
  await page.setViewportSize({width,height:950});const button=page.getByRole('button',{name:'선택한 주장·카드 사실 재검증',exact:true});await button.scrollIntoViewIfNeeded();
  const measurement=await page.evaluate(()=>{const main=document.querySelector('main')!,history=document.querySelector('.event-history ol');return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,mainWidth:main.getBoundingClientRect().width,mainScroll:main.scrollTop,historyScroll:history?.scrollTop??0,y:scrollY};});
  layouts.push({phase,width,...measurement,button:await hit(button)});expect(measurement.documentWidth).toBeLessThanOrEqual(width+1);expect(measurement.mainWidth).toBeLessThanOrEqual(1100);expect(measurement.mainScroll).toBe(0);expect(measurement.historyScroll).toBe(0);
  await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(Math.min(width-30,500),500);await page.mouse.wheel(0,650);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
 }
 try{
  expect(p.lastRun?.status).toBe('succeeded');await open();
  const recovery=page.getByRole('region',{name:'사실 문제와 복구'});await recovery.waitFor();expect(await recovery.innerText()).toContain('CLAIM_CONFLICTING');expect(await recovery.innerText()).toContain(beforeText);
  expect(await page.locator('.approval').innerText()).toMatch(/사실|출처/);expect(await page.locator('.approval button').last().isDisabled()).toBe(true);
  for(const width of [1440,390]){await measure(width);await capture('초기차단-'+width);}
  await page.setViewportSize({width:1440,height:1000});
  const reviewerSelect=recovery.getByLabel('다음 요청 의미 검수자'),effortSelect=recovery.getByLabel('Gemini 검수 노력');
  expect(await reviewerSelect.inputValue()).toBe('agy');expect(await effortSelect.inputValue()).toBe('high');
  await effortSelect.selectOption('low');expect(await effortSelect.inputValue()).toBe('low');await effortSelect.selectOption('medium');
  await reviewerSelect.selectOption('claude');expect(await recovery.innerText()).toContain('작성 모델 설정은 변경하지 않습니다.');await reviewerSelect.selectOption('agy');expect(await effortSelect.inputValue()).toBe('medium');
  await recovery.getByRole('checkbox',{name:/문제 주장 1 선택/}).check();await recovery.getByRole('checkbox',{name:'영향 카드 1 선택',exact:true}).check();
  expect(await recovery.getByRole('checkbox',{name:/문제 주장 2 선택/}).isChecked()).toBe(false);expect(await recovery.getByRole('checkbox',{name:'영향 카드 2 선택',exact:true}).isChecked()).toBe(false);
  const live=await a.client.getProject(id),selectedButton=recovery.getByRole('button',{name:'선택한 주장·카드 사실 재검증',exact:true});
  await h.save('브라우저선택범위.json',{allowedActions:live.allowedActions,selectedClaim:await recovery.getByRole('checkbox',{name:/문제 주장 1 선택/}).isChecked(),selectedCard:await recovery.getByRole('checkbox',{name:'영향 카드 1 선택',exact:true}).isChecked(),enabled:await selectedButton.isEnabled()});
  if(!await selectedButton.isEnabled())throw Error('BROWSER_FACT_REVIEW_ELIGIBILITY_NOT_READY: selected claim0/card0 but button disabled; allowedActions='+JSON.stringify(live.allowedActions));
  const [request,received]=await Promise.all([
   page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/factReview')),
   page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/factReview')),
   selectedButton.click()
  ]);
  const sent=request.postDataJSON();expect(sent.claimIndices).toEqual([0]);expect(sent.cardIds).toEqual([p.result!.cards[0]!.cardId]);expect(sent.reviewer).toBe('agy');expect(sent.reviewEffort).toBe('medium');
  await h.save('브라우저재검증접수.json',{sent,status:received.status(),body:await received.json()});
  if(received.status()!==202)throw Error('BROWSER_FACT_REVIEW_HTTP_NOT_READY: '+received.status());
  await h.worker.tick();await open();
  const compare=page.getByRole('region',{name:'사실 문제와 복구'});expect(await compare.innerText()).toContain('변경 전: '+beforeText);expect(await compare.innerText()).toContain('제안: '+afterText);expect(await compare.innerText()).toContain('HTTP 200 · opened');
  expect(await compare.innerText()).toContain('gemini-3.8-flash-medium');expect(await compare.innerText()).toContain('LLM 판정');expect(h.reviewRequests.at(-1)?.selection).toEqual({provider:'agy',model:'gemini-3.8-flash-medium'});
  expect((await a.client.getProject(id)).result).toEqual(p.result);await capture('제안전후-1440');await measure(390,'proposal');await capture('제안전후-390');
  const apply=page.getByRole('button',{name:'사실 수정안 전체 적용',exact:true});await hit(apply);const applied=page.waitForResponse(r=>r.url().endsWith('/factApply')&&r.request().method()==='POST');await apply.click();expect((await applied).status()).toBe(202);
  const count={...h.counters,images:h.calls.syntheticImage};await h.worker.tick();expect({...h.counters,images:h.calls.syntheticImage}).toEqual(count);await open();
  expect(await page.getByLabel('카드 1 본문',{exact:true}).inputValue()).toBe(afterText);await page.getByRole('checkbox',{name:'사실·출처와 시각적 가독성을 직접 확인했습니다',exact:true}).check();
  const final=page.getByRole('button',{name:/최종 승인/,exact:false}).last();await hit(final);await final.click();await expect.poll(async()=>(await a.client.getProject(id)).activeRun?.kind).toBe('export');await h.worker.tick();await page.reload();await page.getByRole('heading',{name:'내려받기',exact:true}).waitFor();
  const approved=await a.client.getProject(id),list=await verifyDownloads(h,a,approved),zip=list.entries.find(e=>e.kind==='zip')!;
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'ZIP 내려받기',exact:true}).click();await (await download).saveAs(resolve(h.data,'브라우저다운로드.zip'));
  const file=await h.store.getDownload(id,zip.exportId);await rename(file.absolutePath,file.absolutePath+'.보존');await page.getByRole('button',{name:'파일 상태 다시 확인',exact:true}).click();await expect.poll(()=>page.locator('.downloads [role="alert"]').count()).toBeGreaterThan(0);await capture('다운로드실패');
  const rebuild=page.getByRole('button',{name:'승인 유지 · 파일만 다시 생성',exact:true});expect(await rebuild.isEnabled()).toBe(true);await hit(rebuild);await rebuild.click();await expect.poll(async()=>(await a.client.getProject(id)).activeRun?.kind).toBe('export');await h.worker.tick();await page.reload();await page.getByRole('button',{name:'ZIP 내려받기',exact:true}).waitFor();expect((await a.client.getProject(id)).result).toEqual(approved.result);await capture('파일복구');
  expect(errors).toEqual([]);expect(blocked).toEqual([]);
 }catch(error){await h.save('브라우저차단원인.json',{message:String(error)});throw error;}finally{
  await capture('최종관측').catch(()=>{});await h.save('브라우저검증.json',{errors,blocked,network,layouts,counters:h.counters,realProviderCalls:0});await context.close();await browser.close();
 }
}
