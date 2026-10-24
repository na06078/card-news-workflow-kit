import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import type {Store} from './shared/포트.js';
import {createStore} from './backend/저장소.js';
import {createWorker} from './worker/작업자.js';
import {createClaudeAdapter} from './providers/클로드.js';
import {createAgyAdapter} from './providers/agy.js';
import {renderCard} from './render/렌더러.js';
import {buildExport} from './render/내보내기.js';
import {initializeOwnedScope,closeOwnedScope} from './providers/프로세스격리.js';

/** 정상 경로는 실제 어댑터만 조립하며 SDK 초기화·로그인·agy 실행을 하지 않습니다. */
export function createProductionWorker(store:Store,dataDir:string){
 const activatedAt=Date.now();
 const livePermission={inference:true,search:true,image:true,approvalReference:'t_dc7d2a44: fresh explicit browser actions only'} as const;
 // 기존 queued를 자동 재생하지 않습니다. 원장은 보존하고 명시 retry가 새 run을 만들게 합니다.
 const armedStore:Store={...store,async claimJob(input){
  const job=await store.claimJob(input);if(!job)return null;
  if(Date.parse(job.run.createdAt)<=activatedAt&&job.run.status!=='cancel_requested'){
   await store.commit(job.fence,{type:'failure',externalOutcome:'not_started',retryAllowed:true,error:{code:'AUTH_MODE_UNKNOWN',message:'앱 기동 전 대기 작업은 자동 실행하지 않습니다. 현재 화면에서 명시적으로 재시도해 주세요.',retryable:true,nextActions:['retry'],projectId:job.run.projectId,runId:job.run.runId,currentVersion:job.fence.baseProjectVersion,details:{reason:'FRESH_USER_ACTION_REQUIRED'}}});
   return null;
  }
  return job;
 }};
 // command -v/디렉터리 메타데이터로 확인한 기존 Windows 설치 위치. 실행/버전/auth 확인 아님.
 const agy=createAgyAdapter({executablePath:resolve(homedir(),'AppData/Local/agy/bin/agy.EXE'),livePermission});
 const worker=createWorker({store:armedStore,dataDir,ownerId:randomUUID(),dataMode:'real',createClaudeAdapter,claudeOptions:{livePermission},agy,
  renderCard:(i,o)=>renderCard(i,{...o,browserExecutablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe')}),buildExport,
  font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt')});
 let closed=false;return {worker,async close(){if(closed)return;closed=true;await worker.dispose();const reports=await agy.dispose();if(reports.some(r=>r.status==='failed'||r.status==='unknown'))throw Error('AGY_CLEANUP_UNVERIFIED');}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dataDir=resolve(process.argv.slice(2).find(x=>x.startsWith('--data-dir='))?.slice('--data-dir='.length)??'실행데이터/앱');const store=await createStore({dataDir,dbPath:resolve(dataDir,'카드뉴스.sqlite'),dataMode:'real'});
 await initializeOwnedScope();
 const runtime=createProductionWorker(store,dataDir);await runtime.worker.start();
 const record={type:'ready',pid:process.pid,node:process.version,startedAt:new Date().toISOString(),dataDir,gate:'FRESH_USER_ACTION_ONLY; same-child subscription barrier; owned Windows Job; no model/search/image startup calls'};
 console.log(JSON.stringify(record));process.send?.(record);
 let closing=false;const close=async()=>{if(closing)return;closing=true;try{await runtime.close();}finally{await store.close();await closeOwnedScope();process.disconnect?.();}};
 const shutdown=()=>{void close().catch(()=>{console.error('WORKER_CLOSE_FAILED');process.exitCode=1;});};
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('message',m=>{if(m&&typeof m==='object'&&'type'in m&&m.type==='shutdown')shutdown();});
}
