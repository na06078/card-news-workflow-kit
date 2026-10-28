import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

// 읽기 및 이 격리 브라우저의 미제출 편집만 확인합니다. 사용자 데이터 mutation은 전부 차단합니다.
const base='http://127.0.0.1:5173',id='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
const out=resolve('실행데이터/리뷰보강/원본확인');await mkdir(out,{recursive:true});
const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000}));
assert(resource.freeKB>=3*1024*1024);assert.equal(resource.browserProcesses,0);
const browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const get=async path=>{const r=await context.request.get(base+path,{headers:{Origin:base}});assert.equal(r.status(),200);return (await r.json()).data;};
 await get('/api/bootstrap');const before=await get('/api/projects/'+id),dashboard=await get('/api/providers/status');
 assert.equal(before.execution.worker.state,'ready');assert.equal(before.activeRun,null);
 const forbidden=[],errors=[];
 await context.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.origin!==base)return route.abort();
  if(r.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});
  if(!['GET','HEAD'].includes(r.method())){forbidden.push({method:r.method(),path:u.pathname});return route.abort();}
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
 await page.goto(base+'/?project='+id);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();
 const images=page.locator('button.image-button img');assert.equal(await images.count(),before.result.cards.length);
 await images.evaluateAll(async es=>{await Promise.all(es.map(async img=>{await img.decode();if(!img.naturalWidth)throw Error('PNG_DECODE_FAILED');}));});
 await page.getByText('검수 상세·재검수(선택)',{exact:true}).click();
 const apply=page.getByRole('button',{name:'사실 수정안 전체 적용',exact:true});await apply.waitFor();assert(await apply.isEnabled());
 await page.locator('summary').filter({hasText:'카드 1 원고 편집'}).click();
 const title=page.getByLabel('카드 1 제목',{exact:true}),oldTitle=await title.inputValue();await title.fill(oldTitle+' [미제출 보호 확인]');
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='사실 수정안 전체 적용');return b?.disabled;});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await apply.scrollIntoViewIfNeeded();
  assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1);
  await page.screenshot({path:resolve(out,`원본초안보호_${width}.png`)});
 }
 await page.getByRole('button',{name:'카드 1 초안 버리기',exact:true}).click();
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='사실 수정안 전체 적용');return b&&!b.disabled;});
 assert.equal(await title.inputValue(),oldTitle);
 const after=await get('/api/projects/'+id);
 for(const key of ['projectVersion','stage','status','storyboard','result','claims','sources','factReview','exports'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
 const runtime=JSON.parse(await readFile(resolve('실행데이터/연결준비/사용자앱런타임.json'),'utf8'));
 for(const [file,hash]of Object.entries(runtime.build))assert.equal(createHash('sha256').update(await readFile(resolve(file))).digest('hex'),hash);
 const modules={};for(const f of ['backend/실행상태.js','backend/작업자잠금.js','render/내보내기.js'])modules[f]=createHash('sha256').update(await readFile(resolve('dist/server',f))).digest('hex');
 const record={passed:true,mode:'ORIGINAL_APP_READ_ONLY_WITH_ISOLATED_BROWSER_DRAFT',url:base+'/?project='+id,projectVersion:after.projectVersion,resultVersion:after.result.version,cards:after.result.cards.length,exports:after.exports.length,worker:after.execution.worker.state,active:after.activeRun,originalUnchanged:true,pngDecoded:await images.count(),draftBlocksApply:true,explicitDraftClearReenabled:true,mutationRequests:forbidden,errors,runtimePid:runtime.pid,httpPid:runtime.http.pid,workerPid:runtime.worker.pid,startedAt:runtime.startedAt,buildHashesMatch:true,modules,resource};
 await writeFile(resolve(out,'원본반영결과.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
 await context.close();
}finally{await browser.close();}
