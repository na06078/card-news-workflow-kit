import express from 'express';
import {createServer as createViteServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createConnection} from 'node:net';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createStore} from '../../../../src/backend/저장소.js';
import {createApp} from '../../../../src/backend/앱.js';
import {createHttpClient} from '../../../../src/frontend/클라이언트.js';
import {createMockSnapshot} from '../../../../src/shared/모의자료.js';
import type {ProjectSnapshot} from '../../../../src/shared/포트.js';

export async function startCheckpoint(){
 assert.equal(process.version,'v24.22.1','S0 전용 Node 런타임 필수');
 const data=resolve('실행데이터/I1',randomUUID());await mkdir(data,{recursive:true});
 const options={dbPath:resolve(data,'저장.sqlite'),dataDir:data,dataMode:'mock' as const};
 let store=await createStore(options);const allowedHosts:string[]=[],allowedOrigins:string[]=[];
 let backend=createApp({store,dataDir:data,allowedHosts,allowedOrigins});
 const network:unknown[]=[],records:unknown[]=[],screenshots:string[]=[],pageErrors:string[]=[],consoleErrors:string[]=[],external:string[]=[];
 const record=(name:string,evidence:unknown)=>{records.push({name,evidence});};
 const vite=await createViteServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],logLevel:'error',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zod']}});
 const outer=express();outer.use((req,res,next)=>{
  if(!req.url.startsWith('/api/'))return next();
  res.on('finish',()=>network.push({method:req.method,path:req.url,status:res.statusCode,replayed:res.getHeader('Idempotency-Replayed')??false}));
  return backend(req,res,next);
 });outer.use(vite.middlewares);
 const server=await new Promise<ReturnType<typeof outer.listen>>((ok,fail)=>{const s=outer.listen(0,'127.0.0.1',()=>ok(s));s.once('error',fail);});
 const addr=server.address();assert(addr&&typeof addr!=='string');const port=addr.port;const url=`http://127.0.0.1:${port}`;allowedHosts.push(`127.0.0.1:${port}`);allowedOrigins.push(url);
 record('runtime',{pid:process.pid,execPath:process.execPath,nodeVersion:process.version,startedAt:new Date().toISOString(),url,dbPath:options.dbPath,mode:'REAL F1 HTTP + REAL B1 + SQLite; synthetic candidates only; NO worker/provider'});
 let browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined;
 let selectedProject:ProjectSnapshot|undefined,replayInput:unknown,replayBody:unknown;
 async function api(){
  let cookie='',csrf='';
  const actualFetch:typeof fetch=async(input,init)=>{const headers=new Headers(init?.headers);if(!headers.has('Origin'))headers.set('Origin',url);if(cookie)headers.set('Cookie',cookie);const res=await fetch(input,{...init,headers});const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0]!;return res;};
  const client=createHttpClient({baseUrl:url,fetch:actualFetch});const boot=await client.bootstrap();csrf=boot.csrfToken;
  return {client,async post(path:string,input:unknown,extra:Record<string,string>={}){
   const res=await actualFetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...extra},body:JSON.stringify(input)});
   return {status:res.status,body:await res.json(),replayed:res.headers.get('Idempotency-Replayed')==='true'};
  }};
 }
 type Api=Awaited<ReturnType<typeof api>>;
 async function candidates(a:Api,id:string){
  const p=await a.client.getProject(id);const receipt=await a.client.mutate('research',{projectId:id},{version:p.projectVersion,requestId:randomUUID()});
  let job=null;
  // claimJob은 전역 실행1을 지킨다. 앞선 테스트의 미실행 editorial은 실제 cancel HTTP와 저장 정리로 종료한다.
  for(let i=0;i<100;i++){const j=await store.claimJob({ownerId:'I1-storage-seed',now:new Date().toISOString(),leaseMs:3600000,dataMode:'mock'});assert(j,'seed job');if(j.run.runId===receipt.runId){job=j;break;}assert.equal(j.run.externalOutcome,'not_started');await a.client.mutate('cancel',{projectId:j.run.projectId,runId:j.run.runId},{requestId:randomUUID()});await store.commit(j.fence,{type:'canceled',cleanupConfirmed:true});record('storage-only-cancel-unexecuted',{runId:j.run.runId,kind:j.run.kind,providerStarted:false});}
  assert(job);const f=createMockSnapshot('selection');const cs:ProjectSnapshot['candidates']=[],ss:ProjectSnapshot['sources']=[];
  const version=p.researchVersion+1;
  for(let n=1;n<=7;n++){const cid=randomUUID(),sid=randomUUID();cs.push({...f.candidates[0]!,candidateId:cid,researchVersion:version,eventKey:`I1-synthetic-${id}-${version}-${n}`,title:`[I1 합성] 후보 ${n} · 조사 v${version}`,sourceIds:[sid]});ss.push({...f.sources[0]!,sourceId:sid,candidateId:cid,url:`https://example.org/I1-synthetic/${cid}`});}
  await store.commit(job.fence,{type:'content',content:{kind:'candidates',researchVersion:version,candidates:cs,sources:ss,shortageReason:null}});
  record('synthetic-seed',{projectId:id,version,count:cs.length,via:'Store.claimJob + Store.commit(content:candidates); no research/provider executed'});
  return a.client.getProject(id);
 }
 async function seed(a:Api,label:string){const p=await a.client.createProject({topic:`[I1 합성] ${label}`,createRequestId:randomUUID()});return candidates(a,p.projectId);}
 async function shot(p:Page,name:string){const path=resolve(data,name+'.png');await p.screenshot({path,fullPage:true});screenshots.push(path);}
 const host='/tests/integration/fixtures/I1/index.html';
 async function browserCheckpoint(){
  browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true});
  context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  // 외부 요청만 거절. API 응답 fulfill/intercept/mock 없음.
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==url){external.push(u.origin);return route.abort();}return route.continue();});
  page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.goto(url+host);await page.getByLabel('조사 주제',{exact:true}).fill('[I1 합성] 브라우저 생성');
  await page.getByRole('button',{name:'프로젝트 만들기',exact:true}).click();await page.getByRole('button',{name:'자료 조사 시작',exact:true}).waitFor();
  const id=new URL(page.url()).searchParams.get('project');assert(id);const a=await api();const created=await a.client.getProject(id);assert.equal(created.activeRun,null);record('browser-create',{projectId:id,noAutomaticResearch:true});
  const seeded=await candidates(a,id);await page.reload();await page.getByRole('heading',{name:'후보 선택',exact:true}).waitFor();
  assert(await page.getByText('모의 데이터 · 실제 조사/생성 아님',{exact:true}).isVisible());
  const boxes=page.getByRole('checkbox');assert.equal(await boxes.count(),7);const submit=page.getByRole('button',{name:'선택한 후보로 진행',exact:true});assert(await submit.isDisabled());
  for(const i of [0,1,2]){await boxes.nth(i).check();assert(await submit.isEnabled());}assert(await boxes.nth(3).isDisabled());
  await shot(page,'실제HTTP-후보3개');await boxes.nth(2).uncheck();await boxes.nth(1).uncheck();
  const response=page.waitForResponse(r=>r.url().endsWith(`/api/projects/${id}/selection`)&&r.request().method()==='POST');
  await submit.click();const accepted=await response;assert.equal(accepted.status(),202);replayInput=accepted.request().postDataJSON();replayBody=await accepted.json();
  await page.getByText('선택한 원문을 확인하고 편집 방향을 준비하고 있습니다. 필요한 질문이 생기면 이곳에 표시됩니다.',{exact:true}).waitFor();
  selectedProject=await a.client.getProject(id);assert.deepEqual(selectedProject.selectedCandidateIds,[seeded.candidates[0]!.candidateId]);await page.reload();await page.getByRole('button',{name:'후보 선택',exact:false}).click();await page.getByText('저장된 선택 1개 · 조사 v1',{exact:true}).waitFor();assert(await boxes.nth(0).isChecked());assert(await boxes.nth(0).isDisabled());await shot(page,'실제HTTP-선택새로고침');
  // terminal selection 화면은 자동 polling하지 않음: 다른 저장 주체가 조사 버전을 바꾼 뒤 오래된 제출을 재현.
  const stale=await seed(a,'오래된 화면');await page.goto(url+host+'?project='+stale.projectId);await page.getByRole('heading',{name:'후보 선택',exact:true}).waitFor();await boxes.nth(0).check();
  const latest=await candidates(a,stale.projectId);assert.equal(latest.researchVersion,2);
  const conflict=page.waitForResponse(r=>r.url().endsWith(`/api/projects/${stale.projectId}/selection`)&&r.request().method()==='POST');await submit.click();const rejected=await conflict;assert.equal(rejected.status(),409);assert.equal((await rejected.json()).error.code,'VERSION_CONFLICT');
  await page.getByText('VERSION_CONFLICT',{exact:true}).waitFor();await page.getByText('저장된 선택 0개 · 조사 v2',{exact:true}).waitFor();assert.deepEqual((await a.client.getProject(stale.projectId)).selectedCandidateIds,[]);await shot(page,'실제HTTP-오래된화면409');
  await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(page,'모바일-실제HTTP-충돌');
  record('browser-checkpoint',{created:id,selected:selectedProject.selectedCandidateIds,reload:true,selectionLimits:[0,1,2,3,4],staleProjectId:stale.projectId,staleStatus:409,refetchedResearchVersion:latest.researchVersion,mocks:false});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
 }
 async function restartCheckpoint(){
  assert(selectedProject&&page);const id=selectedProject.projectId;const before=await store.getProject(id);
  await store.close();store=await createStore(options);backend=createApp({store,dataDir:data,allowedHosts,allowedOrigins});
  const a=await api();const after=await a.client.getProject(id);assert.deepEqual(after,before);
  const replay=await a.post(`/api/projects/${id}/selection`,replayInput);assert.equal(replay.status,202);assert(replay.replayed);assert.deepEqual(replay.body,replayBody);
  await page.goto(url+host+'?project='+id);await page.getByRole('button',{name:'후보 선택',exact:false}).click();await page.getByText('저장된 선택 1개 · 조사 v1',{exact:true}).waitFor();assert(await page.getByRole('checkbox').nth(0).isChecked());await shot(page,'실제SQLite-재시작복원');
  // 읽기 전용 DB 재개봉 증거. 사용자 DB나 다른 카드 DB 접근 없음.
  const db=new Database(options.dbPath,{readonly:true});try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();record('sqlite-readonly-inspection',{path:options.dbPath,tables});}finally{db.close();}
  record('restart',{projectId:id,projectVersion:after.projectVersion,selected:after.selectedCandidateIds,runId:after.activeRun?.runId,exactSnapshotRetained:true,replayed:true,scope:'createApp session map + Store SQLite close/reopen, same harness process; no OS process restart/reconcile claim'});
 }
 async function close(){
  await browser?.close();await vite.close();await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));await store.close();
  const closed=await new Promise<boolean>(ok=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('error',e=>ok((e as NodeJS.ErrnoException).code==='ECONNREFUSED'));socket.once('connect',()=>{socket.destroy();ok(false);});});
  record('cleanup',{browserClosed:!browser?.isConnected(),serverClosed:!server.listening,portRefused:closed,method:'owned browser.close/vite.close/server.close/store.close; no process kills'});
  await writeFile(resolve(data,'실행결과.json'),JSON.stringify({records,network,screenshots,pageErrors,consoleErrors,external,liveProviderCalls:0},null,2));
  await writeFile(resolve('실행데이터/I1/최근실행.json'),JSON.stringify({data,result:resolve(data,'실행결과.json'),screenshots},null,2));
  assert(closed);assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
 }
 return {url,api,seed,record,browserCheckpoint,restartCheckpoint,close};
}
