import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
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
import {semanticInputHash} from '../dist/server/providers/검수내용.js';

const mode=process.argv.includes('--isolated')?'isolated':process.argv.includes('--resume')?'resume':'prepare';
const id='af725e97-8f9b-4857-986e-ab6b3b2bc758',sourceRunId='4c2b3074-5eb1-4e1b-8271-7ba7e5078c20',checkpointId='e6e905a5-3fef-4beb-9f23-7b06e6e0c644';
const root=resolve('실행데이터/연결쌍복구'),backup=resolve(root,'변경전백업/카드뉴스.sqlite');
await mkdir(root,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
function rows(db,sql,...args){return db.prepare(sql).all(...args);}
function baseline(path){
 const db=new Database(path,{readonly:true});
 try{return {projects:rows(db,'SELECT id,payload FROM projects'),runs:rows(db,'SELECT id,payload FROM runs'),checkpoints:rows(db,'SELECT checkpoint_id,payload FROM fact_checkpoints'),assets:rows(db,'SELECT id,path,payload FROM assets')};}finally{db.close();}
}
const original=baseline(backup),originalProject=JSON.parse(original.projects.find(p=>p.id===id).payload);
const protectedContent=p=>({topic:p.topic,period:p.period,selectedCandidateIds:p.selectedCandidateIds,storyboard:p.storyboard,result:p.result,claims:p.claims,sources:p.sources,exports:p.exports});
let host,dbPath=resolve('실행데이터/앱/카드뉴스.sqlite'),base='http://127.0.0.1:5173',data=resolve(root,'실사용'),browser;
const calls={collector:0,repair:0,semantic:0,image:0,render:0};
async function startIsolated(){
 data=resolve(root,'격리경로',randomUUID());await mkdir(data,{recursive:true});dbPath=resolve(data,'카드뉴스.sqlite');
 const src=new Database(backup,{readonly:true});try{await src.backup(dbPath);}finally{src.close();}
 const store=await createStore({dataDir:data,dbPath,dataMode:'real'});
 const forbidden=kind=>{calls[kind]++;throw Error('UNEXPECTED_'+kind);};
 const cleanup=runId=>({runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_TEST_ONLY',children:[]});
 const worker=createWorker({store,dataDir:data,ownerId:randomUUID(),dataMode:'real',claudeOptions:{livePermission:{inference:false,search:false,image:false}},createClaudeAdapter:()=>forbidden('collector'),createFactLinkRepairer:()=>forbidden('repair'),createSemanticReviewer:options=>{let runId;return {async review(context,input){runId=context.runId;calls.semantic++;return {reviewer:options.selection,actualModel:options.selection.model,reviewedAt:new Date().toISOString(),inputHash:semanticInputHash(input),verdict:'unverifiable',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[{cardId:input.cards[0].cardId,claimIndex:null,sourceIds:[],message:'명시 전송 대역의 흐름 확인이며 실제 LLM 판정이 아닙니다.',suggestion:null}]};},async cancel(r){return cleanup(r);},async dispose(){return [cleanup(runId)];}};},agy:{generate:()=>forbidden('image'),cancel:async r=>cleanup(r),dispose:async()=>[]},renderCard:()=>forbidden('render'),buildExport:()=>{throw Error('UNEXPECTED_EXPORT');},font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),pollMs:10,heartbeatMs:100});
 await worker.start();
 const hosts=[],origins=[],api=createApp({store,dataDir:data,allowedHosts:hosts,allowedOrigins:origins});
 const vite=await createViteServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],logLevel:'error',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zod']}});
 const outer=express();outer.use((req,res,next)=>req.url.startsWith('/api/')?api(req,res,next):next());outer.use(vite.middlewares);
 const server=await new Promise((ok,fail)=>{const s=outer.listen(0,'127.0.0.1',()=>ok(s));s.once('error',fail);});
 base='http://127.0.0.1:'+server.address().port;hosts.push(new URL(base).host);origins.push(base);
 return {async close(){await worker.dispose();await vite.close();await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));await store.close();}};
}
function journal(runId){const db=new Database(dbPath,{readonly:true});try{return rows(db,'SELECT payload FROM invocations WHERE run_id=?',runId).map(r=>JSON.parse(r.payload));}finally{db.close();}}
async function preserve(){
 const current=baseline(dbPath);
 for(const p of original.projects)if(p.id!==id)assert.equal(current.projects.find(x=>x.id===p.id).payload,p.payload,'OTHER_PROJECT_CHANGED');
 for(const r of original.runs)assert.equal(current.runs.find(x=>x.id===r.id).payload,r.payload,'OLD_RUN_CHANGED');
 for(const c of original.checkpoints)assert.equal(current.checkpoints.find(x=>x.checkpoint_id===c.checkpoint_id).payload,c.payload,'OLD_CHECKPOINT_CHANGED');
 assert.deepEqual(current.assets,original.assets);
 const expected=JSON.parse(await readFile(resolve(root,'앱중단/적용전_무결성.json'),'utf8')).assets;
 for(const a of current.assets)assert.equal(hash(await readFile(a.path)),expected[a.id],'ASSET_CHANGED');
 return {otherProjectsUnchanged:true,oldRunsUnchanged:true,oldCheckpointsUnchanged:true,assetsUnchanged:true,assetCount:current.assets.length};
}
try{
 if(mode==='isolated')host=await startIsolated();await mkdir(data,{recursive:true});
 const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000}));
 assert(resource.freeKB>=3*1024*1024);assert.equal(resource.browserProcesses,0);
 browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--no-first-run']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const get=async path=>{const r=await context.request.get(base+path,{headers:{Origin:base}});assert.equal(r.status(),200);return (await r.json()).data;};
 await get('/api/bootstrap');const before=await get('/api/projects/'+id),dashboard=await get('/api/providers/status');
 assert.equal(before.factReview.runId,sourceRunId);assert.equal(before.factRecovery.checkpointId,checkpointId);assert.equal(before.factRecovery.reuseRepairObservation,true);assert.equal(before.factRecovery.step,'semantic');assert.equal(before.factRecovery.available,true);assert.equal(before.execution.worker.state,'ready');assert.equal(before.activeRun,null);
 assert.deepEqual(protectedContent(before),protectedContent(originalProject));
 const posts=[],blocked=[],errors=[];let allowed=false;
 await context.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();
  if(r.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:dashboard})});
  if(r.method()==='POST'){
   if(allowed&&u.pathname===`/api/projects/${id}/factReview`&&posts.length===0){const body=r.postDataJSON();assert.equal(body.resumeFromRunId,sourceRunId);assert.equal(body.checkpointId,checkpointId);assert.deepEqual(body.claimIndices,before.factReview.claimIndices);assert.deepEqual(body.cardIds,before.factReview.cardIds);posts.push(body);return route.continue();}
   blocked.push({method:r.method(),path:u.pathname});return route.abort();
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(base+'/?project='+id);await page.getByRole('heading',{name:'스토리보드',exact:true}).waitFor();
 const button=page.getByRole('button',{name:'저장 응답으로 내용 검수 계속',exact:true});await button.waitFor();assert(await button.isEnabled());
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await button.scrollIntoViewIfNeeded();assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1);
  assert(await button.evaluate(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h);}));
  await page.screenshot({path:resolve(data,`재사용준비_${width}.png`)});
 }
 assert.equal(posts.length,0);assert.deepEqual(blocked,[]);
 if(mode==='prepare'){
  const state={passed:true,mode:'ORIGINAL_PREPARE_ONLY_NO_MODEL',projectId:id,version:before.projectVersion,sourceRunId,checkpointId,reuseRepairObservation:true,step:before.factRecovery.step,posts:0,errors};
  assert.deepEqual(errors,[]);await writeFile(resolve(data,'실행준비.json'),JSON.stringify(state,null,2));console.log(JSON.stringify(state));
 }else{
  const budgetPath=resolve(data,'실행예약.json');
  await writeFile(budgetPath,JSON.stringify({state:'reserved',mode,projectId:id,sourceRunId,checkpointId,projectVersion:before.projectVersion,repairLimit:0,semanticLimit:1,reservedAt:new Date().toISOString()},null,2),{flag:'wx'});
  allowed=true;await button.click();
  let after=await get('/api/projects/'+id);const deadline=Date.now()+360000;
  while((!after.lastRun||after.lastRun.runId===sourceRunId||['queued','running','waiting_for_user','cancel_requested'].includes(after.lastRun.status))&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));after=await get('/api/projects/'+id);}
  const newRun=after.lastRun;assert(newRun&&newRun.runId!==sourceRunId,'NEW_RUN_NOT_OBSERVED');
  const marks=journal(newRun.runId),started=phase=>marks.filter(m=>m.phase===phase&&m.state==='started').length;
  const usage={collector:started('factReview'),repair:started('fact-link-repair'),semantic:started('semantic-review'),image:started('image'),render:started('render')};
  await writeFile(budgetPath,JSON.stringify({state:newRun.status==='succeeded'?'completed':'used_failed_or_unknown',mode,projectId:id,sourceRunId,checkpointId,newRunId:newRun.runId,status:newRun.status,usage,at:new Date().toISOString()},null,2));
  if(newRun.status!=='succeeded'){await writeFile(resolve(data,'실제복구실패.json'),JSON.stringify({passed:false,mode,runId:newRun.runId,status:newRun.status,error:newRun.error,usage,posts:posts.length},null,2));throw Error('RECOVERY_FAILED_'+(newRun.error?.code??newRun.status));}
  assert.equal(after.factReview.state,'ready');assert.deepEqual(protectedContent(after),protectedContent(before));assert.deepEqual(usage,{collector:0,repair:0,semantic:1,image:0,render:0});assert.equal(posts.length,1);
  if(mode==='isolated')assert.deepEqual(calls,{collector:0,repair:0,semantic:1,image:0,render:0});
  const report=after.factReview.proposal.semanticReview;assert(report);assert.equal(report.reviewedCardIds.length,6);assert.equal(report.reviewedClaimIndices.length,7);
  const db=new Database(dbPath,{readonly:true});let cp,parent;
  try{cp=JSON.parse(db.prepare('SELECT payload FROM fact_checkpoints WHERE source_run_id=?').get(newRun.runId).payload);parent=db.prepare('SELECT parent_id FROM runs WHERE id=?').get(newRun.runId).parent_id;}finally{db.close();}
  assert.equal(parent,sourceRunId);assert.equal(cp.step,'semantic');assert.equal(cp.repairObservation.originRunId,sourceRunId);
  const oldCp=JSON.parse(original.checkpoints.find(c=>c.checkpoint_id===checkpointId).payload);assert.deepEqual(cp.repairObservation,oldCp.repairObservation);
  await page.getByText('적용 전 제안 LLM 의미 검수 의견',{exact:true}).waitFor({timeout:10000});await page.reload();
  await page.getByText('적용 전 제안 LLM 의미 검수 의견',{exact:true}).waitFor({timeout:10000});assert.equal(posts.length,1);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByText('적용 전 제안 LLM 의미 검수 의견',{exact:true}).scrollIntoViewIfNeeded();assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1);await page.screenshot({path:resolve(data,`복구완료_${width}.png`)});}
  const restored=await get('/api/projects/'+id);assert.deepEqual(restored.factReview,after.factReview);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
  const record={passed:true,mode:mode==='isolated'?'COPIED_REAL_CASE_REAL_HTTP_WORKER_UI_SYNTHETIC_SEMANTIC_TRANSPORT':'ORIGINAL_UI_STORED_REPAIR_REAL_SEMANTIC_REVIEW',url:base+'/?project='+id,projectVersion:after.projectVersion,runId:newRun.runId,parentId:parent,proposalState:after.factReview.state,verdict:report.verdict,issues:report.issues.length,actualModel:report.actualModel,reviewer:report.reviewer,reviewedCards:report.reviewedCardIds.length,reviewedClaims:report.reviewedClaimIndices.length,usage,posts:posts.length,originalContentUnchanged:true,originPreserved:true,preservation:await preserve(),errors};
  await writeFile(resolve(data,'복구결과.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
 }
 await context.close();
}finally{await browser?.close();await host?.close();}
