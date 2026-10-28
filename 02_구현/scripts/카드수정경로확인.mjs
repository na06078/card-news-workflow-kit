import assert from 'node:assert/strict';
import {resolve,basename,extname} from 'node:path';
import {mkdir,readFile,writeFile,copyFile,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {createStore} from '../dist/server/backend/저장소.js';
import {createApp} from '../dist/server/backend/앱.js';
import {createWorker} from '../dist/server/worker/작업자.js';
import {validateContent} from '../dist/server/providers/조사검증.js';
import {renderCard} from '../dist/server/render/렌더러.js';
import {buildExport} from '../dist/server/render/내보내기.js';
import {DomainError} from '../dist/server/backend/도메인.js';
import {DEFAULT_CARD_LAYOUT} from '../dist/server/shared/수정판정.js';

// 실제 사용자 데이터의 복사본 + 실제 HTTP/worker/renderer/UI. 모델·그림 제공자만 명시 대역입니다.
assert.equal(process.env.CARDNEWS_LIVE_CALLS,'forbidden');
const root=resolve('실행데이터/카드수정복구'),data=resolve(root,'실제경로',randomUUID());await mkdir(data,{recursive:true});
const dbPath=resolve(data,'카드뉴스.sqlite'),backup=resolve(root,'작업전보존/작업전DB.sqlite');
const src=new Database(backup,{readonly:true});try{await src.backup(dbPath);}finally{src.close();}
const assetMap=new Map(),db=new Database(dbPath);
try{
 for(const row of db.prepare('SELECT id,path,payload FROM assets').all()){
  const a=JSON.parse(row.payload),target=resolve(data,'projects',a.projectId,'보존자산',a.assetId+'_'+basename(row.path));await mkdir(resolve(target,'..'),{recursive:true});await copyFile(row.path,target);a.absolutePath=target;assetMap.set(a.assetId,a);db.prepare('UPDATE assets SET path=?,payload=? WHERE id=?').run(target,JSON.stringify(a),a.assetId);
 }
}finally{db.close();}
const ids={failed:'af725e97-8f9b-4857-986e-ab6b3b2bc758',approved:'43daccac-2d26-4db1-bdd7-3b0e6416cd55'};
const store=await createStore({dataDir:data,dbPath,dataMode:'real'}),responses=[];
const calls={model:0,image:0,render:0,export:0},prompts=[],errors=[],posts=[];
const gate=resolve(data,'브라우저해제');
let renderFailures=0,injectedRenderFailures=0;
const cleanup=runId=>({runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_OFFLINE_TEST',children:[]});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const worker=createWorker({store,dataDir:data,ownerId:randomUUID(),dataMode:'real',claudeOptions:{livePermission:{inference:false,search:false,image:false}},
 createClaudeAdapter:({bridge})=>{let runId;return {async *start(c,input){runId=c.runId;calls.model++;const next=responses.shift();assert(next,'UNEXPECTED_MODEL');const raw=typeof next==='function'?next(input):next;const content=validateContent(raw,input.snapshot,c.phase,input.request,[],c.revisionProtocol);yield await bridge.publishResult(c,content);},answer:async()=>{},status:r=>store.getRun(r),cancel:async r=>cleanup(r),dispose:async()=>[cleanup(runId)]};},
 agy:{async generate(input){calls.image++;prompts.push(input.prompt);const old=[...assetMap.values()].find(a=>a.assetId===input.card.imageAssetId)||[...assetMap.values()].find(a=>a.kind==='image'&&a.projectId===input.projectId);assert(old);const path=resolve(input.attemptDir,input.expectedFilename);await mkdir(input.attemptDir,{recursive:true});const bytes=await readFile(old.absolutePath);await writeFile(path,bytes);const provenance={...old.provenance,toolVersion:'EXPLICIT_TEST_COPY_NO_IMAGE_GENERATION',generatedAt:new Date().toISOString(),prompt:input.prompt};return {asset:{...old,assetId:randomUUID(),runId:input.runId,attempt:input.attempt,absolutePath:path,sha256:sha(bytes),bytes:bytes.length,provenance},provenance};},cancel:async r=>cleanup(r),dispose:async()=>[]},
 async renderCard(input,options){
  if(renderFailures>0){renderFailures--;injectedRenderFailures++;throw new DomainError('RENDER_FAILED');}
  const until=Date.now()+30000;for(;;){try{await readFile(gate);break;}catch(e){if(e.code!=='ENOENT')throw e;if(Date.now()>until)throw Error('BROWSER_RELEASE_TIMEOUT');await new Promise(r=>setTimeout(r,20));}}
  const r=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browsers=$b.Count}|ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000}));assert(r.freeKB>=3*1024*1024);assert.equal(r.browsers,0);calls.render++;return renderCard(input,{...options,browserExecutablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe')});
 },buildExport:async(...args)=>{calls.export++;return buildExport(...args);},font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),pollMs:10,heartbeatMs:100});
let vite,server,browser,context,page,base,cookie,csrf;
const protectedResult=p=>JSON.stringify({result:p.result,exports:p.exports,storyboard:p.storyboard,claims:p.claims,sources:p.sources});
async function api(path){const r=await fetch(base+path,{headers:{Origin:base,Cookie:cookie??''}});assert.equal(r.status,200);return (await r.json()).data;}
async function open(id){
 browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const dashboard=await api('/api/providers/status');
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();if(req.method()==='POST'&&url.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});if(req.method()==='POST'){assert(url.pathname.endsWith('/revisions')||url.pathname.endsWith('/retry'),'UNEXPECTED_MUTATION');posts.push(req.postDataJSON());}return route.continue();});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(base+'/?project='+id);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();
}
async function closeBrowser(){await browser?.close();browser=undefined;context=undefined;page=undefined;}
async function waitDone(id,oldRun,expected='succeeded'){let p=await api('/api/projects/'+id);const end=Date.now()+60000;while((p.lastRun?.runId===oldRun||p.activeRun)&&Date.now()<end){await new Promise(r=>setTimeout(r,80));p=await api('/api/projects/'+id);}assert(p.lastRun?.runId!==oldRun);assert.equal(p.lastRun.status,expected,p.lastRun.error?.code);return p;}
async function finishClick(id,before,click,expected='succeeded',endpoint='/revisions'){await unlink(gate).catch(e=>{if(e.code!=='ENOENT')throw e;});const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(endpoint),{timeout:10000});await click();assert.equal((await accepted).status(),202);await closeBrowser();await writeFile(gate,'released');return waitDone(id,before.lastRun?.runId,expected);}
async function request(id,scope,instruction,response,expected='succeeded'){const before=await api('/api/projects/'+id);await open(id);const details=page.locator('#card-1 details:has(select)');await details.locator('summary').click();await details.locator('select').selectOption(scope);await page.getByLabel('카드 1 수정 지시',{exact:true}).fill(instruction);if(response)responses.push(response);const after=await finishClick(id,before,()=>page.getByRole('button',{name:'카드 1 부분 수정 요청',exact:true}).click(),expected);return {before,after};}
async function retry(id,before,response){await open(id);if(response)responses.push(response);const unknown=page.getByRole('checkbox',{name:'외부 실행 결과가 불명확하여 중복 호출될 수 있음을 확인했습니다',exact:true});if(await unknown.count())await unknown.check();return finishClick(id,before,()=>page.getByRole('button',{name:'실패·중단 작업 재시도',exact:true}).click(),'succeeded','/retry');}
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});assert.equal(r.status,202);return (await r.json()).data;}
try{
 await worker.start();const hosts=[],origins=[],app=createApp({store,dataDir:data,allowedHosts:hosts,allowedOrigins:origins});
 vite=await createViteServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],logLevel:'error',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zod']}});
 const outer=express();outer.use((req,res,next)=>req.url.startsWith('/api/')?app(req,res,next):next());outer.use(vite.middlewares);server=await new Promise((ok,fail)=>{const s=outer.listen(0,'127.0.0.1',()=>ok(s));s.once('error',fail);});base='http://127.0.0.1:'+server.address().port;hosts.push(new URL(base).host);origins.push(base);
 const boot=await fetch(base+'/api/bootstrap',{headers:{Origin:base}});assert.equal(boot.status,200);cookie=boot.headers.getSetCookie().map(s=>s.split(';')[0]).join(';');csrf=(await boot.json()).data.csrfToken;
 // 1. 원래 pending 카드만 모델 없이 실제 재합성합니다.
 const old=await api('/api/projects/'+ids.failed);await open(ids.failed);const recovered=await finishClick(ids.failed,old,()=>page.getByRole('button',{name:'카드 1 저장 원고로 표시 복구',exact:true}).click());
 assert(recovered.result.cards.every(c=>c.state==='ready'));assert.equal(calls.model,0);assert.equal(calls.image,0);assert.equal(calls.render,1);
 assert.deepEqual(recovered.result.cards.slice(1),old.result.cards.slice(1));for(const key of ['title','body','sourceIds','imageAssetId','imagePlan'])assert.deepEqual(recovered.result.cards[0][key],old.result.cards[0][key]);assert.deepEqual(recovered.claims,old.claims);assert.deepEqual(recovered.sources,old.sources);
 const steps=[{case:'legacy_pending_local_render',passed:true}];
 // 2. 정상 비변경 결과 네 종류는 이미 승인된 다른 복사 프로젝트의 원본/파일을 그대로 둡니다.
 for(const status of ['needs_scope','no_change','unsupported','clarification']){
  const outcome=status==='needs_scope'?{kind:'revision',status,requestedScope:'text',reason:'원고 수정이 필요합니다.'}:status==='clarification'?{kind:'revision',status,question:'어떤 문장을 수정할까요?'}:{kind:'revision',status,reason:status==='no_change'?'이미 같은 배치입니다.':'현재 범위로 처리할 수 없습니다.'};
  const counts={...calls};const {before,after}=await request(ids.approved,'layout','속도 수치를 바꾸고 싶습니다.',outcome);assert.equal(protectedResult(after),protectedResult(before));assert.deepEqual(after.lastRun.revisionOutcome,outcome);assert.equal(calls.render,counts.render);assert.equal(calls.image,counts.image);
  await open(ids.approved);const heading={needs_scope:'수정 범위 확인 필요',no_change:'변경 없음',unsupported:'현재 범위로 처리 불가',clarification:'추가 확인 필요'}[status];await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  if(status==='needs_scope'){const n=posts.length;await page.getByRole('button',{name:'문구 수정으로 확인'}).click();assert.equal(await page.getByLabel('수정 범위',{exact:true}).first().inputValue(),'text');assert.equal(posts.length,n);await page.getByLabel('카드 1 수정 지시',{exact:true}).screenshot({path:resolve(data,'범위확인_초안.png')});}
  if(status==='unsupported'){await page.getByRole('heading',{name:heading,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(data,'처리불가_안내.png')});}
  await closeBrowser();steps.push({case:status,preservedApproval:true,passed:true});
 }
 // 3. 문구/배치 patch는 선택 카드만 실제 새 PNG를 만들고 기존 그림을 재사용합니다.
 for(const scope of ['text','layout']){
  const {before,after}=await request(ids.failed,scope,scope==='text'?'마지막에 검증용 안내를 붙입니다.':'가운데 정렬',({snapshot})=>{const c=snapshot.result.cards[0];return {kind:'revision',status:'patch',patches:[{cardId:c.cardId,scope,changes:scope==='text'?{title:c.title,body:c.body+' 변경 경로 확인.',sourceIds:c.sourceIds}:{fontScale:'normal',textAlign:'center',placement:'bottom'}}]};});
  assert.equal(after.result.version,before.result.version+1);assert.deepEqual(after.result.cards.slice(1),before.result.cards.slice(1));assert.equal(after.result.cards[0].imageAssetId,before.result.cards[0].imageAssetId);assert.equal(after.result.cards[0].state,'ready');assert.notEqual(after.result.cards[0].previewAssetId,before.result.cards[0].previewAssetId);steps.push({case:scope,passed:true});
 }
 // 4. 그림은 기존 경계의 명시 대역이며 지시가 실제 prompt에 전달되는지만 검사합니다.
 const n=calls.model;const image=await request(ids.failed,'image','검증용 그림 구도 지시',null);assert.equal(calls.model,n);assert.equal(calls.image,1);assert(prompts.at(-1).includes('검증용 그림 구도 지시'));assert.notEqual(image.after.result.cards[0].imageAssetId,image.before.result.cards[0].imageAssetId);assert.deepEqual(image.after.result.cards.slice(1),image.before.result.cards.slice(1));steps.push({case:'image_transport_stub_real_render',passed:true});
 // 5. 승인 결과의 적용 전 실패→실제 UI retry→비변경 종료는 승인/다운로드/정상 상태를 유지합니다.
 const freshCounts={...calls};
 const fresh=await request(ids.approved,'layout','현재 배치를 그대로 확인합니다.',()=>{throw new DomainError('PROVIDER_PROTOCOL_ERROR');},'failed');
 assert.equal(fresh.after.lastRun.error.code,'PROVIDER_PROTOCOL_ERROR');assert.equal(fresh.after.lastRun.revisionApplied,undefined);assert.equal(protectedResult(fresh.after),protectedResult(fresh.before));
 const freshAfter=await retry(ids.approved,fresh.after,{kind:'revision',status:'no_change',reason:'기존 배치와 같습니다.'});
 assert.equal(freshAfter.status,fresh.before.status);assert.equal(freshAfter.status,'approved');assert.equal(freshAfter.stage,fresh.before.stage);assert.equal(protectedResult(freshAfter),protectedResult(fresh.before));assert.equal(freshAfter.lastRun.attempt,2);assert.equal(calls.render,freshCounts.render);assert.equal(calls.image,freshCounts.image);assert.equal(calls.model,freshCounts.model+2);
 await open(ids.approved);await page.getByRole('heading',{name:'변경 없음',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'변경 없음',exact:true}).waitFor();assert.equal((await api('/api/projects/'+ids.approved)).status,'approved');await page.getByRole('heading',{name:'변경 없음',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(data,'재시도_변경없음.png')});await closeBrowser();
 steps.push({case:'fresh_retry_no_change_preserves_approved_exports',passed:true,exportsPreserved:freshAfter.exports.length});
 // 6. A/B 중 A만 변경→렌더 실패→실제 UI retry는 모델을 다시 부르지 않고 A만 렌더합니다.
 const mixedBefore=await api('/api/projects/'+ids.approved),[changed,unchanged]=mixedBefore.result.cards,mixedCounts={...calls};assert.equal(unchanged.approvedRevision,unchanged.revision);
 responses.push(({snapshot})=>{const [a,b]=snapshot.result.cards,layout=a.layout??DEFAULT_CARD_LAYOUT;return {kind:'revision',status:'patch',patches:[{cardId:a.cardId,scope:'layout',changes:{...layout,textAlign:layout.textAlign==='left'?'center':'left'}},{cardId:b.cardId,scope:'layout',changes:{...(b.layout??DEFAULT_CARD_LAYOUT)}}]};});renderFailures=1;await writeFile(gate,'released');
 await post('/api/projects/'+ids.approved+'/revisions',{requestId:randomUUID(),version:mixedBefore.result.version,scope:'layout',cardIds:[changed.cardId,unchanged.cardId],instruction:'첫 카드만 정렬을 바꾸고 두 번째 카드는 유지합니다.'});
 const mixedFailed=await waitDone(ids.approved,mixedBefore.lastRun.runId,'failed');assert.equal(mixedFailed.lastRun.error.code,'RENDER_FAILED');assert.equal(mixedFailed.lastRun.revisionApplied.cardRevisions.length,1);assert.equal(mixedFailed.lastRun.revisionApplied.cardRevisions[0].cardId,changed.cardId);assert.deepEqual(mixedFailed.result.cards.slice(1),mixedBefore.result.cards.slice(1));
 const mixedAfter=await retry(ids.approved,mixedFailed,null);assert.equal(mixedAfter.lastRun.attempt,2);assert(mixedAfter.result.cards.every(c=>c.state==='ready'));assert.equal(mixedAfter.result.version,mixedFailed.result.version);assert.equal(mixedAfter.result.cards[0].revision,mixedFailed.result.cards[0].revision);assert.deepEqual(mixedAfter.result.cards.slice(1),mixedBefore.result.cards.slice(1));assert.equal(calls.model,mixedCounts.model+1);assert.equal(calls.image,mixedCounts.image);assert.equal(calls.render,mixedCounts.render+1);assert.equal(injectedRenderFailures,1);
 await open(ids.approved);const retriedPng=page.getByRole('button',{name:'카드 1 PNG 크게 보기',exact:true}).locator('img');await retriedPng.evaluate(e=>e.decode());await retriedPng.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(data,'혼합선택_렌더재시도.png')});await page.reload();assert.deepEqual((await api('/api/projects/'+ids.approved)).result,mixedAfter.result);await closeBrowser();steps.push({case:'mixed_selection_retry_real_png_no_second_model',passed:true,appliedCards:1,selectedCards:2});
 await open(ids.failed);const img=page.getByRole('button',{name:'카드 1 PNG 크게 보기',exact:true}).locator('img');await img.evaluate(e=>e.decode());await img.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(data,'선택카드_수정완료.png')});await closeBrowser();assert.deepEqual(errors,[]);assert.equal(responses.length,0);
 const record={passed:true,mode:'COPIED_REAL_DATA_REAL_HTTP_STORE_WORKER_UI_RENDER_EXPLICIT_PROVIDER_STUBS',data,steps,calls,mutationRequests:posts.length,errors,originalDataNotWritten:true};await writeFile(resolve(data,'카드수정통합결과.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await closeBrowser();await worker.dispose();await vite?.close();if(server)await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));await store.close();}
