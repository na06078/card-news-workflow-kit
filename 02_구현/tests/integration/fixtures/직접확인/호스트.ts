import express from 'express';
import {createServer as createViteServer} from 'vite';
import react from '@vitejs/plugin-react';
import Database from 'better-sqlite3';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {createStore} from '../../../../src/backend/저장소.js';
import {createApp} from '../../../../src/backend/앱.js';
import {createWorker} from '../../../../src/worker/작업자.js';
import {buildExport} from '../../../../src/render/내보내기.js';
import {createMockSnapshot} from '../../../../src/shared/모의자료.js';
import {buildSemanticReviewInput,semanticInputHash} from '../../../../src/providers/검수내용.js';
import type * as C from '../../../../src/shared/포트.js';

/** 원본 앱/DB와 분리한 TEST ONLY 준비 상태. 외부 모델·재렌더는 금지하고 실제 export만 사용합니다. */
export async function startManualReviewFixture(overrides:Partial<Pick<C.WorkerOptions,'createClaudeAdapter'|'createSemanticReviewer'|'createFactLinkRepairer'>>={},group:'검수간소화'|'부분복구'='검수간소화'){
 if(process.env.CARDNEWS_LIVE_CALLS!=='forbidden')throw Error('OFFLINE_TEST_REQUIRED');
 const data=resolve('실행데이터',group,'실제경로',randomUUID());await mkdir(data,{recursive:true});
 const dbPath=resolve(data,'시험.sqlite'),store=await createStore({dataDir:data,dbPath,dataMode:'mock'});
 const created=await store.createProject({topic:'[TEST 합성] 직접 확인과 파일 준비',createRequestId:randomUUID()});
 if(!('data' in created.body))throw Error('FIXTURE_PROJECT_FAILED');
 const id=created.body.data.projectId,p=createMockSnapshot('review');p.projectId=id;p.topic='[TEST 합성] 실제 뉴스가 아닌 승인 흐름 시험';
 p.activeRun=null;p.lastRun=null;p.question=null;p.allowedActions=[];p.projectVersion=5;
 const source=p.sources[0]!;p.claims=[{text:'[TEST 합성] 확인되지 않은 비교 수치',sourceIds:[source.sourceId],kind:'conflicting',availability:'unknown',conditions:['실제 원문/AI 검증 자료 아님']}];
 const dir=resolve(data,'projects',id,'준비자료');await mkdir(dir,{recursive:true});
 const rows:C.VerifiedAsset[]=[],cards:C.CardRevision[]=[];const seedRun=randomUUID(),at=new Date().toISOString();
 for(let n=1;n<=7;n++){
  const original=p.result!.cards[0]!,cardId=randomUUID(),imageId=randomUUID(),previewId=randomUUID();
  const png=new PNG({width:1080,height:1080});
  for(let i=0;i<png.data.length;i+=4)png.data.set([30+n*8,90,110,255],i);
  const bytes=PNG.sync.write(png),sha256=createHash('sha256').update(bytes).digest('hex');
  for(const [kind,assetId] of [['image',imageId],['preview',previewId]] as const){
   const path=resolve(dir,`${kind}_${n}.png`);await writeFile(path,bytes);
   rows.push({assetId,projectId:id,runId:seedRun,attempt:1,kind,absolutePath:path,mimeType:'image/png',bytes:bytes.length,sha256,width:1080,height:1080,provenance:kind==='image'?{tool:'agy',toolVersion:'TEST-SYNTHETIC-NO-PROVIDER',generatedAt:at,prompt:'합성 단색 PNG, 실제 이미지 생성 아님',illustrative:true,usageConditions:'이 테스트가 직접 생성한 합성 픽셀',usageConditionsVerified:true,conversationId:null}:null});
  }
  cards.push({...original,cardId,order:n,role:n===1?'cover':n===7?'closing':'body',title:`[TEST] 카드 ${n}`,body:'실제 뉴스가 아닌 직접 확인 흐름 검증용 원고입니다.',imageAssetId:imageId,previewAssetId:previewId,approvedRevision:null,state:'ready',error:null});
 }
 p.storyboard!.cards=cards.map(({revision,imageAssetId,previewAssetId,state,approvedRevision,error,...card})=>card);
 p.result!.cards=cards;p.result!.factsCheck='failed';p.result!.visualCheck='passed';p.result!.finalApprovedVersion=null;
 p.result!.semanticReview={reviewer:{provider:'agy',model:'gemini-3.8-flash-high'},actualModel:null,reviewedAt:at,inputHash:semanticInputHash(buildSemanticReviewInput(p)),verdict:'unverifiable',reviewedCardIds:cards.map(c=>c.cardId),reviewedClaimIndices:[0],issues:[{cardId:cards[0]!.cardId,claimIndex:0,sourceIds:[source.sourceId],message:'[TEST] 제공한 근거만으로 확인할 수 없습니다. '.repeat(20),suggestion:'필요하면 상세 근거를 확인하세요.'}]};
 const db=new Database(dbPath);
 try{db.transaction(()=>{
  db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(p),id);
  db.prepare('INSERT OR REPLACE INTO history VALUES(?,?,?)').run(id,p.projectVersion,JSON.stringify(p));
  for(const row of rows)db.prepare('INSERT INTO assets VALUES(?,?,?,?)').run(row.assetId,id,row.absolutePath,JSON.stringify(row));
 })();}finally{db.close();}
 const calls={model:0,image:0,render:0},forbidden=async(kind:keyof typeof calls):Promise<never>=>{calls[kind]++;throw Error('UNEXPECTED_'+kind.toUpperCase());};
 const worker=createWorker({store,dataDir:data,ownerId:randomUUID(),dataMode:'mock',claudeOptions:{livePermission:{inference:false,search:false,image:false}},createClaudeAdapter:()=>{calls.model++;throw Error('UNEXPECTED_MODEL');},agy:{generate:()=>forbidden('image'),cancel:async runId=>({runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'TEST_NOT_STARTED',children:[]}),dispose:async()=>[]},renderCard:()=>forbidden('render'),buildExport,font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),pollMs:10,heartbeatMs:200,...overrides});
 await worker.start();
 const hosts:string[]=[],origins:string[]=[],api=createApp({store,dataDir:data,allowedHosts:hosts,allowedOrigins:origins});
 const vite=await createViteServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],logLevel:'error',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','zod']}});
 const outer=express();outer.use((req,res,next)=>req.url.startsWith('/api/')?api(req,res,next):next());outer.use(vite.middlewares);
 const server=await new Promise<ReturnType<typeof outer.listen>>((ok,fail)=>{const s=outer.listen(0,'127.0.0.1',()=>ok(s));s.once('error',fail);});
 const address=server.address();if(!address||typeof address==='string')throw Error('FIXTURE_LISTENER_FAILED');
 const url=`http://127.0.0.1:${address.port}`;hosts.push(`127.0.0.1:${address.port}`);origins.push(url);
 return {data,dbPath,url,id,store,calls,before:structuredClone(p),async close(){await worker.dispose();await vite.close();await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));await store.close();}};
}
