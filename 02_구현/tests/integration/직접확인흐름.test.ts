import {test,expect} from 'vitest';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {startManualReviewFixture} from './fixtures/직접확인/호스트.js';
import {verifyZip} from '../../src/render/압축검사.js';
import {buildSemanticReviewInput,semanticInputHash} from '../../src/providers/검수내용.js';

// 이 테스트만 실제 Chromium 한 개를 사용합니다. 모델/뉴스/이미지 생성과 사용자 DB 승인은 없습니다.
test('AI 확인 불가도 새 사용자 체크 한 번으로 실제 파일 준비·ZIP 다운로드까지 진행한다',async()=>{
 const ps='$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress';
 const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:15000}));
 expect(resource.freeKB).toBeGreaterThanOrEqual(3*1024*1024);expect(resource.browserProcesses).toBe(0);
 const h=await startManualReviewFixture();let browser;
 const approvals:{version:number;stage:string;acknowledgeWarnings:boolean}[]=[],errors:string[]=[];
 try{
  browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
  const get=async(path:string)=>{const r=await context.request.get(h.url+path,{headers:{Origin:h.url}});expect(r.ok()).toBe(true);return (await r.json()).data;};
  await get('/api/bootstrap');const dashboard=await get('/api/providers/status');
  await context.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url());
   if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   // 인증/모델 추론이 아니라, 명시 시험 metadata만 제공합니다.
   if(r.method()==='POST'&&url.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});
   if(r.method()==='POST'&&url.pathname===`/api/projects/${h.id}/approve`){const v=r.postDataJSON();approvals.push({version:v.version,stage:v.stage,acknowledgeWarnings:v.acknowledgeWarnings});}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
  await page.goto(h.url+'/?project='+h.id);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();
  const summary=page.getByRole('region',{name:'검수 요약',exact:true});
  const detailSummary=page.getByText('검수 상세·재검수(선택)',{exact:true});
  const details=detailSummary.locator('xpath=ancestor::details[1]');
  const checkbox=page.getByRole('checkbox',{name:'카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.',exact:true});
  const layouts=[];
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   expect([...await summary.innerText()].length).toBeLessThanOrEqual(240);
   expect(await details.getAttribute('open')).toBeNull();
   expect(await checkbox.isEnabled()).toBe(true);expect(await checkbox.isChecked()).toBe(false);
   const dims=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));expect(dims.documentWidth).toBeLessThanOrEqual(width+1);layouts.push(dims);
  }
  await page.waitForTimeout(250);expect(approvals).toHaveLength(0);
  expect(await page.locator('body').innerText()).not.toContain('CLAIM_CONFLICTING');
  await detailSummary.click();const reviewer=page.getByLabel('다음 요청 의미 검수자');await reviewer.waitFor();await reviewer.selectOption('claude');
  await detailSummary.click();await detailSummary.click();expect(await reviewer.inputValue()).toBe('claude');await detailSummary.click();expect(approvals).toHaveLength(0);
  await page.reload();await checkbox.waitFor();expect(await checkbox.isChecked()).toBe(false);expect(approvals).toHaveLength(0);
  const before=await h.store.getProject(h.id);expect(before.result!.finalApprovedVersion).toBeNull();expect(before.result!.factsCheck).toBe('failed');
  await page.setViewportSize({width:1440,height:1000});await summary.screenshot({path:resolve(h.data,'검수요약_체크전.png')});
  await checkbox.evaluate(e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:resolve(h.data,'직접확인_체크전.png')});
  await checkbox.check();await page.getByRole('heading',{name:'내려받기',exact:true}).waitFor({timeout:15000});
  let after=await h.store.getProject(h.id);const deadline=Date.now()+20000;
  while((after.activeRun||!after.exports.length)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));after=await h.store.getProject(h.id);}
  expect(approvals).toEqual([{version:before.result!.version,stage:'final',acknowledgeWarnings:true}]);
  expect(after.lastRun?.status).toBe('succeeded');expect(after.result!.finalApprovedVersion).toBe(after.result!.version);
  expect(after.result!.factsCheck).toBe(before.result!.factsCheck);expect(after.result!.semanticReview).toEqual(before.result!.semanticReview);
  expect(after.result!.manualApproval).toMatchObject({resultVersion:after.result!.version,warningsAcknowledged:true,contentHash:semanticInputHash(buildSemanticReviewInput(before))});
  expect(after.result!.cards.map(c=>[c.title,c.body,c.imageAssetId,c.previewAssetId])).toEqual(before.result!.cards.map(c=>[c.title,c.body,c.imageAssetId,c.previewAssetId]));
  const zipEntry=after.exports.find(e=>e.kind==='zip')!;expect(zipEntry).toBeDefined();
  const zipButton=page.getByRole('button',{name:'ZIP 내려받기',exact:true});await zipButton.waitFor({timeout:10000});
  const downloadEvent=page.waitForEvent('download');await zipButton.click();const download=await downloadEvent;const downloaded=resolve(h.data,'실제다운로드.zip');await download.saveAs(downloaded);
  const bytes=await readFile(downloaded);expect(createHash('sha256').update(bytes).digest('hex')).toBe(zipEntry.sha256);
  const names=[...Array.from({length:after.result!.cards.length},(_,i)=>String(i+1).padStart(2,'0')+'.png'),'출처기록.json','이미지기록.json','글꼴라이선스.txt'];
  const contents=verifyZip(bytes,names),sourceRecord=JSON.parse(Buffer.from(contents['출처기록.json']!).toString('utf8'));
  expect(sourceRecord.review.manualApproval).toEqual(after.result!.manualApproval);expect(sourceRecord.review.factsCheck).toBe('failed');expect(sourceRecord.review.semanticReview.verdict).toBe('unverifiable');
  await page.reload();await page.getByRole('heading',{name:'내려받기',exact:true}).waitFor();expect(approvals).toHaveLength(1);
  const db=new Database(h.dbPath,{readonly:true});let exportRuns:number;try{exportRuns=(db.prepare("SELECT count(*) n FROM runs WHERE project_id=? AND json_extract(payload,'$.kind')='export'").get(h.id) as {n:number}).n;}finally{db.close();}
  expect(exportRuns).toBe(1);expect(h.calls).toEqual({model:0,image:0,render:0});expect(errors).toEqual([]);
  await zipButton.waitFor();await zipButton.evaluate(e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:resolve(h.data,'파일준비_완료.png')});
  await writeFile(resolve(h.data,'직접확인결과.json'),JSON.stringify({passed:true,mode:'SYNTHETIC_CONTENT_REAL_HTTP_SQLITE_WORKER_UI_EXPORT_DOWNLOAD',layouts,approvalRequests:approvals.length,exportRuns,zipSha256:zipEntry.sha256,zipEntries:names,manualApproval:after.result!.manualApproval,factsCheck:after.result!.factsCheck,semanticVerdict:after.result!.semanticReview?.verdict,calls:h.calls,errors},null,2));
  console.log(JSON.stringify({passed:true,path:resolve(h.data,'직접확인결과.json'),approvalRequests:approvals.length,exportRuns}));
  await context.close();
 }finally{await browser?.close();await h.close();}
},60000);
