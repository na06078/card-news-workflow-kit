import express from 'express';
import {createServer as createViteServer} from 'vite';
import react from '@vitejs/plugin-react';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {createStore} from '../../../../src/backend/저장소.js';
import {createApp} from '../../../../src/backend/앱.js';
import {createWorker} from '../../../../src/worker/작업자.js';
import {createOfflineAgyAdapter} from '../../../../src/providers/agy.js';
import {renderCard} from '../../../../src/render/렌더러.js';
import {buildExport} from '../../../../src/render/내보내기.js';
import {createHttpClient} from '../../../../src/frontend/클라이언트.js';
import type * as C from '../../../../src/shared/포트.js';

/** TEST ONLY: 실제 B1/W1/R1/F1 + 명시 합성 외부 응답. 기본 앱에서 import 금지. */
export async function startLocal(testOptions:{dataRoot?:string;createClaudeAdapter?:C.CreateClaudeAdapter;createSemanticReviewer?:C.CreateSemanticReviewer}={}){
 if(process.env.CARDNEWS_LIVE_CALLS!=='forbidden')throw Error('TEST_OPT_IN_REQUIRED');
 const data=resolve(testOptions.dataRoot??'실행데이터/I2',randomUUID());await mkdir(data,{recursive:true});
 const dbPath=resolve(data,'통합.sqlite');const store=await createStore({dataDir:data,dbPath,dataMode:'mock'});
 const hosts:string[]=[],origins:string[]=[];let backend=createApp({store,dataDir:data,allowedHosts:hosts,allowedOrigins:origins});
 const records:unknown[]=[],network:unknown[]=[];const record=(name:string,evidence:unknown)=>records.push({name,evidence});
 const calls={syntheticClaude:0,syntheticImage:0,answers:[] as {projectId:string;answer:C.AnswerItem[]}[],sdkQuery:0,auth:0,agySpawn:0};
 const controls={error:null as string|null,imageFailOnce:false};
 const agy=createOfflineAgyAdapter({executablePath:resolve('실행데이터/I2/TEST_ONLY_agy.exe'),livePermission:{inference:false,search:false,image:false}},(_exe,_args,opts)=>{
  calls.syntheticImage++;
  const result=(async()=>{if(controls.imageFailOnce){controls.imageFailOnce=false;return {exitCode:1,stdout:'',stderr:'INJECTED_TEST_FAILURE'};}
   const png=new PNG({width:96,height:96});for(let i=0;i<png.data.length;i+=4){png.data[i]=35;png.data[i+1]=65;png.data[i+2]=95;png.data[i+3]=255;}
   await writeFile(resolve(opts.cwd,'image.png'),PNG.sync.write(png));
   return {exitCode:0,stderr:'',stdout:JSON.stringify({conversation_id:'I2-SYNTHETIC-NOT-AGY',status:'SUCCESS',response:'합성 TEST image.png',duration_seconds:0,num_turns:0,usage:{}})};
  })();return {result,cancel:async()=>({runId:null,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'TEST_DOUBLE_NO_PROCESS',children:[]})};
 });
 const createClaudeAdapter:C.CreateClaudeAdapter=({bridge,signal})=>({
  async *start(c,input){calls.syntheticClaude++;await bridge.saveSession(c,'I2-SYNTHETIC-'+c.projectId);
   if(controls.error){yield await bridge.publishError(c,{code:controls.error,message:'명시 주입 시험 오류',retryable:true,nextActions:['retry'],projectId:c.projectId,runId:c.runId,currentVersion:null,details:{reason:'I2_SYNTHETIC'}});return;}
   const {snapshot:p,request}=input as {snapshot:C.ProjectSnapshot;request?:C.RevisionRequest};
   if(c.phase==='research'){
    const candidates:C.Candidate[]=[],sources:C.Source[]=[];
    for(let n=1;n<=7;n++){const cid=randomUUID(),sid=randomUUID();candidates.push({candidateId:cid,researchVersion:p.researchVersion+1,eventKey:`I2-SYNTHETIC-${n}`,category:'합성',title:`[I2 합성] 시험 후보 ${n}`,summary:'실제 뉴스·검색 결과가 아닌 로컬 시험 자료입니다.',publishedDate:null,eventDate:null,sourceIds:[sid],selectionReason:'통합 경계 검증',uncertainties:['날짜·원문 실검증 없음']});sources.push({sourceId:sid,candidateId:cid,url:`https://example.org/I2-synthetic/${cid}`,title:'I2 합성 시험 출처',publisher:'SYNTHETIC',publishedDate:null,eventDate:null,accessedAt:null,primary:true,access:'not_opened',evidence:null,limitations:['실제 원문 아님']});}
    yield await bridge.publishResult(c,{kind:'candidates',researchVersion:p.researchVersion+1,candidates,sources,shortageReason:null});return;
   }
   if(c.phase==='editorial'){
    const question:C.Question={questionId:randomUUID(),version:1,runId:c.runId,kind:'editorial',status:'open',createdAt:new Date().toISOString(),items:[{itemId:'audience',text:'[I2 합성] 누구에게 설명할까요?',header:'독자',options:[{optionId:'public',label:'일반 사용자',description:'쉬운 개념'},{optionId:'developer',label:'개발자',description:'기술 맥락'}],multiSelect:false,allowFreeText:true,recommendedOptionId:'public',recommendationReason:'시험 추천이며 자동 답변 아님'}]};
    yield await bridge.openQuestion(c,{question,mapping:{toolUseId:'I2-SYNTHETIC-TOOL',items:[{itemId:'audience',originalQuestion:question.items[0].text,options:question.items[0].options.map(o=>({optionId:o.optionId,label:o.label}))}]}});
    const answer=await bridge.waitForAnswer(c,question.questionId,1,signal??new AbortController().signal);calls.answers.push({projectId:c.projectId,answer});
    const selected=p.sources.filter(s=>p.selectedCandidateIds.includes(s.candidateId));const selectedSources=selected.map(s=>({...s,access:'opened' as const,accessedAt:new Date().toISOString(),evidence:'I2 합성 fixture 근거. 실제 원문 열람 아님.',limitations:['SYNTHETIC; live 원문/날짜 미검증']}));const sources=p.sources.map(s=>selectedSources.find(x=>x.sourceId===s.sourceId)??s);
    const audience=answer[0].text??question.items[0].options.find(o=>o.optionId===answer[0].optionIds[0])!.label;
    const board:C.Storyboard={version:(p.storyboard?.version??0)+1,audience,rationale:'합성 답변을 반영한 로컬 기획',format:'합성 2장 시험',hooks:['합성 자료로 흐름 확인','실제 뉴스가 아닙니다'],size:'1080x1080',approvedVersion:null,cards:['cover','closing'].map((role,n)=>({cardId:randomUUID(),order:n+1,role:role as 'cover'|'closing',title:n?'합성 시험 정리':'합성 로컬 시험',body:n?'실제 조사와 생성은 검증하지 않았습니다.':'질문 답변과 승인 경계를 확인합니다.',sourceIds:selectedSources.map(s=>s.sourceId),imagePlan:'I2 합성 설명용 그림, 실제 사진 아님'}))};
    yield await bridge.publishResult(c,{kind:'storyboard',storyboard:board,sources,claims:[{text:'I2 합성 시험 주장. 실제 뉴스 아님.',sourceIds:selectedSources.map(s=>s.sourceId),kind:'publisher_claim',availability:'unknown',conditions:['SYNTHETIC fixture, 실제 검증 아님']}]});return;
   }
   if(!request||request.scope!=='text')throw Error('I2_UNSUPPORTED_SYNTHETIC_REQUEST');
   const text=JSON.parse(request.instruction) as {title:string;body:string};
   const cards=p.result!.cards.filter(x=>request.cardIds.includes(x.cardId)).map(x=>({...x,...text}));
   yield await bridge.publishResult(c,{kind:'cards',cards,factsCheck:'pending',visualCheck:'pending'});
  },answer:async()=>{},status:id=>store.getRun(id),cancel:async id=>({runId:id,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'I2_TEST_DOUBLE_NO_PROCESS',children:[]}),dispose:async()=>[]
 });
 const syntheticAgy:C.AgyAdapter={...agy,async generate(i,s){const out=await agy.generate(i,s);const provenance={...out.provenance,usageConditions:'I2 합성 PNG: 이 fixture가 직접 만든 단색 픽셀만 사용. 실제 agy 약관 검증 아님.',usageConditionsVerified:true};return {...out,provenance,asset:{...out.asset,provenance}};}};
 const workerOptions:C.WorkerOptions={store,dataDir:data,ownerId:randomUUID(),dataMode:'mock',createClaudeAdapter:testOptions.createClaudeAdapter??createClaudeAdapter,claudeOptions:{livePermission:{inference:false,search:false,image:false}},createSemanticReviewer:testOptions.createSemanticReviewer,reviewerOptions:{livePermission:{inference:false}},agy:syntheticAgy,renderCard:(i,o)=>renderCard(i,{...o,browserExecutablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe')}),buildExport,font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),heartbeatMs:100,pollMs:10,leaseMs:30000};
 let worker=createWorker(workerOptions);
 const vite=await createViteServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],logLevel:'error',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zod']}});
 const outer=express();outer.use((req,res,next)=>{if(!req.url.startsWith('/api/'))return next();res.on('finish',()=>network.push({method:req.method,path:req.url,status:res.statusCode,replayed:res.getHeader('Idempotency-Replayed')??false}));return backend(req,res,next);});outer.use(vite.middlewares);
 const server=await new Promise<ReturnType<typeof outer.listen>>((ok,fail)=>{const s=outer.listen(0,'127.0.0.1',()=>ok(s));s.once('error',fail);});
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('address');const url=`http://127.0.0.1:${addr.port}`;hosts.push(`127.0.0.1:${addr.port}`);origins.push(url);
 record('runtime',{pid:process.pid,node:process.version,startedAt:new Date().toISOString(),url,dbPath,mode:'SYNTHETIC EXTERNAL ONLY; REAL HTTP/SQLITE/WORKER/RENDER/F1'});
 async function api(){let cookie='',csrf='';const actualFetch:typeof fetch=async(input,init)=>{const headers=new Headers(init?.headers);headers.set('Origin',url);if(cookie)headers.set('Cookie',cookie);const r=await fetch(input,{...init,headers});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return r;};const client=createHttpClient({baseUrl:url,fetch:actualFetch});csrf=(await client.bootstrap()).csrfToken;
  return {client,async post(path:string,input:unknown){const r=await actualFetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(input)});return {status:r.status,body:await r.json(),replayed:r.headers.get('Idempotency-Replayed')==='true'};},get:(path:string)=>actualFetch(url+path)};
 }
 async function seed(a:Awaited<ReturnType<typeof api>>,topic='[I2 합성] 로컬 시험'){const p=await a.client.createProject({topic,createRequestId:randomUUID()});await a.client.mutate('research',{projectId:p.projectId},{version:1,requestId:randomUUID()});await worker.tick();return a.client.getProject(p.projectId);}
 async function waitFor(id:string,predicate:(p:C.ProjectSnapshot)=>boolean){for(let n=0;n<500;n++){const p=await store.getProject(id);if(predicate(p))return p;await new Promise(r=>setTimeout(r,10));}throw Error('STATE_TIMEOUT');}
 return {url,data,dbPath,store,api,seed,waitFor,calls,controls,record,get worker(){return worker;},restartHttp(){backend=createApp({store,dataDir:data,allowedHosts:hosts,allowedOrigins:origins});record('HTTP-recreated',{sameWorker:true,scope:'Express session map only; not OS process'});},async restartWorker(){await worker.dispose();worker=createWorker({...workerOptions,ownerId:randomUUID()});record('worker-recreated',{scope:'same process explicit object restart; no external SDK'});},async close(){await worker.dispose();await agy.dispose();await vite.close();await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));await store.close();record('cleanup',{serverClosed:!server.listening,method:'owned close/dispose only; no kill'});await writeFile(resolve(data,'증거.json'),JSON.stringify({records,network,calls},null,2));},async save(name:string,value:unknown){await writeFile(resolve(data,name),JSON.stringify(value,null,2));},async hash(path:string){return createHash('sha256').update(await readFile(path)).digest('hex');}};
}
