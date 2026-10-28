import {test,expect} from 'vitest';
import {chromium,type Page} from 'playwright';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {startManualReviewFixture} from './fixtures/직접확인/호스트.js';
import {startFactRecoveryFixture} from './fixtures/부분복구/호스트.js';
import {factFingerprint} from '../../src/backend/사실복구.js';
import {verifyZip} from '../../src/render/압축검사.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';

type Host=Awaited<ReturnType<typeof startManualReviewFixture>>;
const evidence=resolve('실행데이터/리뷰보강/실제경로');
async function browserFor(h:Host){
 const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000}));
 expect(resource.freeKB).toBeGreaterThanOrEqual(3*1024*1024);expect(resource.browserProcesses).toBe(0);
 await mkdir(evidence,{recursive:true});
 const browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
 const bootstrap=await context.request.get(h.url+'/api/bootstrap',{headers:{Origin:h.url}});expect(bootstrap.ok()).toBe(true);
 const response=await context.request.get(h.url+'/api/providers/status',{headers:{Origin:h.url}});expect(response.ok()).toBe(true);const dashboard=(await response.json()).data;
 const posts:{path:string;body:Record<string,unknown>}[]=[],errors:string[]=[];
 await context.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());if(u.origin!==h.url)return route.abort();
  if(r.method()==='POST')posts.push({path:u.pathname,body:r.postDataJSON()});
  // 테스트 metadata만 반환합니다. 실제 인증 조회·검색·추론은 호출하지 않습니다.
  if(r.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
 return {browser,context,page,posts,errors,resource};
 }catch(error){await browser.close();throw error;}
}
function seed(h:Host,p:ProjectSnapshot){
 // 격리 TEST DB에 준비 상태만 넣습니다. 사용자 실행 DB에는 접근하지 않습니다.
 const db=new Database(h.dbPath);try{db.transaction(()=>{db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),h.id);db.prepare('INSERT OR REPLACE INTO history VALUES(?,?,?)').run(h.id,p.projectVersion,JSON.stringify(p));})();}finally{db.close();}
}
async function capture(page:Page,name:string){
 await page.evaluate(()=>{const e=document.activeElement;if(e instanceof HTMLElement)e.blur();});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width+1);
 await page.screenshot({path:resolve(evidence,name+'.png')});
}
async function result(name:string,data:Record<string,unknown>){await writeFile(resolve(evidence,name+'.json'),JSON.stringify({passed:true,...data},null,2));}

test('실제 기획 화면의 AI 경고는 제작 승인을 막지 않으며 초안·사용자 확인 보호는 유지한다',async()=>{
 const h=await startManualReviewFixture();let b:Awaited<ReturnType<typeof browserFor>>|undefined;
 try{
  // 승인 접수까지만 확인합니다. 새 이미지 생성은 미승인이므로 이 TEST worker의 production claim만 보류합니다.
  const claim=h.store.claimJob.bind(h.store);h.store.claimJob=async input=>(await h.store.getProject(h.id)).activeRun?.kind==='production'?null:claim(input);
  const p=structuredClone(h.before);p.result=null;p.stage='storyboard';p.status='ready';p.storyboard!.approvedVersion=null;seed(h,p);
  b=await browserFor(h);const {page,posts}=b;await page.goto(h.url+'/?project='+h.id);await page.getByRole('heading',{name:'스토리보드',exact:true}).waitFor();
  const button=page.getByRole('button',{name:'스토리보드 승인 · 제작 시작',exact:true}),check=page.getByRole('checkbox',{name:'계획과 크기를 확인했습니다',exact:true});
  expect(await button.isDisabled()).toBe(true);await check.check();expect(await button.isEnabled()).toBe(true);
  const snapshot=await h.store.getProject(h.id);expect(snapshot.factIssues!.some(i=>i.code==='SEMANTIC_REVIEW_REQUIRED')).toBe(true);
  await page.getByLabel('선택한 카드의 계획 변경 요청',{exact:true}).fill('미제출 계획 편집');expect(await button.isDisabled()).toBe(true);
  await page.getByRole('button',{name:'계획 초안 버리기',exact:true}).click();expect(await button.isEnabled()).toBe(true);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await button.scrollIntoViewIfNeeded();await capture(page,`기획승인_${width}`);}
  expect(posts.filter(p=>p.path.endsWith('/approve'))).toHaveLength(0);
  await button.click();await expect.poll(async()=>(await h.store.getProject(h.id)).activeRun?.kind).toBe('production');
  const after=await h.store.getProject(h.id);expect(after.storyboard!.approvedVersion).toBe(after.storyboard!.version);expect(after.activeRun!.status).toBe('queued');
  expect(after.factIssues).toEqual(snapshot.factIssues);expect(h.calls).toEqual({model:0,image:0,render:0});expect(b.errors).toEqual([]);
  expect(posts.filter(p=>p.path.endsWith('/approve'))).toHaveLength(1);
  await result('기획승인',{mode:'REAL_UI_HTTP_STORE_APPROVAL_ONLY_PRODUCTION_PAUSED',approvalRequests:1,warningPreserved:true,calls:h.calls,resource:b.resource,errors:b.errors});
 }finally{await b?.browser.close();await h.close();}
},60000);

test('비정렬 저장 결과의 실제 화면 승인→worker→ZIP 다운로드 순서가 일치한다',async()=>{
 const h=await startManualReviewFixture();let b:Awaited<ReturnType<typeof browserFor>>|undefined;
 try{
  const p=structuredClone(h.before);p.result!.cards.reverse();p.storyboard!.cards.reverse();seed(h,p);
  const storedOrder=p.result!.cards.map(c=>c.cardId),expected=[...p.result!.cards].sort((a,b)=>a.order-b.order).map(c=>c.cardId);
  b=await browserFor(h);const {page}=b;await page.goto(h.url+'/?project='+h.id);
  await page.getByRole('checkbox',{name:'카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.',exact:true}).check();
  await page.getByRole('heading',{name:'내려받기',exact:true}).waitFor();
  await expect.poll(async()=>(await h.store.getProject(h.id)).lastRun?.status,{timeout:15000}).toBe('succeeded');
  const after=await h.store.getProject(h.id);expect(after.result!.cards.map(c=>c.cardId)).toEqual(storedOrder);
  const zipButton=page.getByRole('button',{name:'ZIP 내려받기',exact:true});await zipButton.waitFor();
  const downloadEvent=page.waitForEvent('download');await zipButton.click();const download=await downloadEvent,path=resolve(evidence,'순서확인_다운로드.zip');await download.saveAs(path);
  const bytes=await readFile(path),zipEntry=after.exports.find(e=>e.kind==='zip')!;expect(createHash('sha256').update(bytes).digest('hex')).toBe(zipEntry.sha256);
  const names=['01.png','02.png','03.png','04.png','05.png','06.png','07.png','출처기록.json','이미지기록.json','글꼴라이선스.txt'],contents=verifyZip(bytes,names),record=JSON.parse(Buffer.from(contents['출처기록.json']!).toString('utf8'));
  expect(record.cards.map((c:{cardId:string})=>c.cardId)).toEqual(expected);expect(record.manifest.map((m:{cardId:string})=>m.cardId)).toEqual(expected);
  for(const [i,id]of expected.entries()){const card=after.result!.cards.find(c=>c.cardId===id)!,asset=await h.store.getAsset(h.id,card.previewAssetId!);expect(createHash('sha256').update(contents[String(i+1).padStart(2,'0')+'.png']!).digest('hex')).toBe(asset.sha256);}
  expect(record.review.manualApproval).toEqual(after.result!.manualApproval);expect(record.review.semanticReview).toEqual(p.result!.semanticReview);
  const approvals=b.posts.filter(p=>p.path.endsWith('/approve'));expect(approvals).toHaveLength(1);await page.reload();await zipButton.waitFor();expect(b.posts.filter(p=>p.path.endsWith('/approve'))).toHaveLength(1);
  await zipButton.scrollIntoViewIfNeeded();await capture(page,'카드순서_다운로드완료');
  expect(h.calls).toEqual({model:0,image:0,render:0});expect(b.errors).toEqual([]);
  await result('카드순서',{mode:'REAL_UI_HTTP_SQLITE_WORKER_EXPORT_BROWSER_DOWNLOAD',storedArrayUnchanged:true,archiveCards:expected,zipEntries:names,zipSha256:zipEntry.sha256,approvalRequests:1,calls:h.calls,errors:b.errors});
 }finally{await b?.browser.close();await h.close();}
},60000);

test('실제 카드·계획 편집 초안은 적용을 막고 제출 전 원고·제안을 그대로 보존한다',async()=>{
 const h=await startFactRecoveryFixture();let b:Awaited<ReturnType<typeof browserFor>>|undefined;
 try{
  b=await browserFor(h);const {page}=b;await page.goto(h.url+'/?project='+h.id);
  const detail=page.getByText('검수 상세·재검수(선택)',{exact:true});await detail.click();
  await page.getByRole('button',{name:'모든 주장·카드 선택',exact:true}).click();await page.getByRole('button',{name:'선택한 주장·카드 사실 재검증',exact:true}).click();
  await page.getByRole('button',{name:'누락 부분 보완 후 계속',exact:true}).click();
  await expect.poll(async()=>(await h.store.getProject(h.id)).factReview?.state,{timeout:15000}).toBe('ready');
  const before=await h.store.getProject(h.id),apply=page.getByRole('button',{name:'사실 수정안 전체 적용',exact:true});expect(before.allowedActions).toContain('apply_fact_proposal');await expect.poll(()=>apply.isEnabled(),{timeout:10000}).toBe(true);
  const edit=page.locator('summary').filter({hasText:'카드 1 원고 편집'});await edit.click();
  const title=page.getByLabel('카드 1 제목',{exact:true});await title.fill('미제출 카드 제목');await expect.poll(()=>apply.isDisabled()).toBe(true);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await apply.scrollIntoViewIfNeeded();await capture(page,`초안보호_${width}`);}
  expect(b.posts.filter(p=>p.path.endsWith('/factApply'))).toHaveLength(0);expect((await h.store.getProject(h.id)).result).toEqual(before.result);
  await title.fill(before.result!.cards[0]!.title);await expect.poll(()=>apply.isEnabled()).toBe(true);
  // 같은 TEST 제안을 기획 상태에 결합해 상위 계획 화면의 dirty 전달도 확인합니다.
  const plan=structuredClone(before);plan.result=null;plan.stage='storyboard';plan.status='ready';plan.storyboard!.approvedVersion=null;
  plan.factReview!.resultVersion=null;plan.factReview!.contentHash=factFingerprint(plan,plan.factReview!);seed(h,plan);
  await page.reload();await page.getByRole('heading',{name:'스토리보드',exact:true}).waitFor();await apply.waitFor();await expect.poll(()=>apply.isEnabled()).toBe(true);
  await page.getByLabel('선택한 카드의 계획 변경 요청',{exact:true}).fill('미제출 계획 지시');expect(await apply.isDisabled()).toBe(true);
  await apply.scrollIntoViewIfNeeded();await capture(page,'계획초안보호');await page.getByRole('button',{name:'계획 초안 버리기',exact:true}).click();await expect.poll(()=>apply.isEnabled()).toBe(true);
  expect(b.posts.filter(p=>p.path.endsWith('/factApply'))).toHaveLength(0);expect(b.errors).toEqual([]);expect(h.calls).toEqual({model:0,image:0,render:0});
  await result('초안보호',{mode:'REAL_UPPER_SCREENS_HTTP_STORE_SYNTHETIC_SDK_TRANSPORT',factApplyRequests:0,cardAndPlanBlocked:true,explicitDraftClearReenabled:true,contentPreserved:true,transport:h.recoveryCalls,realProviderCalls:0,errors:b.errors});
 }finally{await b?.browser.close();await h.close();}
},60000);
