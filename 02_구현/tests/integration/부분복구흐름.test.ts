import {test,expect} from 'vitest';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startFactRecoveryFixture} from './fixtures/부분복구/호스트.js';

// 원본 데이터/제공자와 분리합니다. 수집 adapter·검증기·HTTP·Store·worker·UI는 실제 코드입니다.
for(const semanticFailures of [0,1])test(`수집 응답의 카드7 연결 누락을 보존하고 UI에서 부분 재개한다 · 의미 검수 실패 ${semanticFailures}`,async()=>{
 const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000}));
 expect(resource.freeKB).toBeGreaterThanOrEqual(3*1024*1024);expect(resource.browserProcesses).toBe(0);
 const h=await startFactRecoveryFixture(semanticFailures);let browser;
 const requests:Record<string,unknown>[]=[],errors:string[]=[];let repairOriginRunId:string|undefined;
 try{
  browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const get=async(path:string)=>{const r=await context.request.get(h.url+path,{headers:{Origin:h.url}});expect(r.ok()).toBe(true);return (await r.json()).data;};
  await get('/api/bootstrap');const dashboard=await get('/api/providers/status');
  await context.route('**/*',route=>{
   const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
   if(r.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});
   if(r.method()==='POST'&&u.pathname===`/api/projects/${h.id}/factReview`)requests.push(r.postDataJSON());
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(h.url+'/?project='+h.id);
  const disclosure=page.getByText('검수 상세·재검수(선택)',{exact:true});await disclosure.click();
  if(semanticFailures)await page.getByLabel('다음 요청 의미 검수자').selectOption('claude');
  await page.getByRole('button',{name:'모든 주장·카드 선택',exact:true}).click();
  await page.getByRole('button',{name:'선택한 주장·카드 사실 재검증',exact:true}).click();
  await expect.poll(async()=>(await h.store.getProject(h.id)).lastRun?.status,{timeout:15000}).toBe('failed');
  const failed=await h.store.getProject(h.id);expect(failed.lastRun?.error?.code).toBe('FACT_SCOPE_INVALID');
  expect(failed.factRecovery).toMatchObject({step:'links',available:true,issues:[{code:'FACT_CARD_LINK_MISSING',cardIds:[h.before.result!.cards[6]!.cardId]}]});
  expect(h.recoveryCalls).toEqual({collector:1,fetch:1,repair:0,semantic:0});
  const repair=page.getByRole('button',{name:'누락 부분 보완 후 계속',exact:true});await repair.waitFor();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.getByRole('region',{name:'저장된 재검증 부분 복구'}).evaluate(e=>e.scrollIntoView({block:'start'}));
   expect(await repair.isEnabled()).toBe(true);const size=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));expect(size.width).toBeLessThanOrEqual(size.viewport+1);
   await page.screenshot({path:resolve(h.data,`연결누락_${width}.png`)});
   await repair.evaluate(e=>e.scrollIntoView({block:'center'}));expect(await repair.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);})).toBe(true);
  }
  await page.reload();await disclosure.click();await repair.waitFor();expect(requests).toHaveLength(1);
  await repair.click();
  if(semanticFailures){
   await expect.poll(async()=>(await h.store.getProject(h.id)).factRecovery?.step,{timeout:15000}).toBe('semantic');
   await expect.poll(async()=>(await h.store.getProject(h.id)).lastRun?.status,{timeout:15000}).toBe('failed');
   expect(h.recoveryCalls).toEqual({collector:1,fetch:1,repair:1,semantic:1});
   repairOriginRunId=(await h.store.getProject(h.id)).lastRun!.runId;
   const retry=page.getByRole('button',{name:'내용 검수부터 다시 시도',exact:true});await retry.waitFor();await retry.click();
  }
  await expect.poll(async()=>(await h.store.getProject(h.id)).factReview?.state,{timeout:15000}).toBe('ready');
  const after=await h.store.getProject(h.id);expect(after.lastRun?.status).toBe('succeeded');expect(after.factReview!.proposal!.semanticReview?.verdict).toBe('unverifiable');
  expect(after.factReview!.reviewer?.provider).toBe(semanticFailures?'claude':'agy');
  const checkpoint=await h.store.getFactCheckpoint(h.id,after.factRecovery!.checkpointId);
  expect(checkpoint.repairObservation).toMatchObject({originRunId:repairOriginRunId??after.lastRun!.runId,actualModel:'claude-sonnet-5-5',decision:{status:'repaired'}});
  expect(after.factRecovery).not.toHaveProperty('repairObservation');
  expect(after.factReview!.proposal!.findings.some(f=>f.cardIds.includes(h.before.result!.cards[6]!.cardId))).toBe(true);
  expect(after.result).toEqual(h.before.result);expect(after.claims).toEqual(h.before.claims);expect(after.sources).toEqual(h.before.sources);
  expect(h.recoveryCalls).toEqual({collector:1,fetch:1,repair:1,semantic:semanticFailures+1});expect(h.calls).toEqual({model:0,image:0,render:0});
  expect(requests).toHaveLength(semanticFailures+2);expect(requests.slice(1).every(r=>r.resumeFromRunId&&r.checkpointId)).toBe(true);
  await page.reload();await disclosure.click();await page.getByText('적용 전 제안 LLM 의미 검수 의견',{exact:true}).waitFor();
  expect(requests).toHaveLength(semanticFailures+2);expect(errors).toEqual([]);
  await page.getByText('적용 전 제안 LLM 의미 검수 의견',{exact:true}).evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:resolve(h.data,'복구완료.png')});
  await writeFile(resolve(h.data,'부분복구결과.json'),JSON.stringify({passed:true,mode:'SYNTHETIC_SDK_TRANSPORT_REAL_COLLECTOR_VALIDATOR_HTTP_SQLITE_WORKER_UI',calls:h.recoveryCalls,forbidden:h.calls,requests:requests.length,proposalState:after.factReview?.state,verdict:after.factReview?.proposal?.semanticReview?.verdict,originalUnchanged:true,errors},null,2));
  console.log(JSON.stringify({passed:true,path:resolve(h.data,'부분복구결과.json'),calls:h.recoveryCalls}));await context.close();
 }finally{await browser?.close();await h.close();}
},60000);
