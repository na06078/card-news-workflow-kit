import Database from 'better-sqlite3';
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';

// 기존 HTTP/CAS/요청 원장 경로만 사용합니다. DB를 직접 수정하지 않습니다.
const base='http://127.0.0.1:5173',projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
const group=process.env.CARDNEWS_VERIFY_GROUP??'가독성개선/재개';
if(!['가독성개선/재개','배경구도수정'].includes(group))throw Error('INVALID_EVIDENCE_GROUP');
const expectedProjectVersion=Number(process.env.CARDNEWS_BASE_PROJECT_VERSION??33),expectedResultVersion=Number(process.env.CARDNEWS_BASE_RESULT_VERSION??2);
if(![expectedProjectVersion,expectedResultVersion].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('INVALID_BASE_VERSION');
const data=resolve('실행데이터/앱'),out=resolve('실행데이터',group,'반영');
const ledgerPath=resolve(out,'접수원장.json'),execute=process.argv.includes('--execute');
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const protectedView=p=>({topic:p.topic,period:p.period,candidates:p.candidates,claims:p.claims,sources:p.sources,selectedCandidateIds:p.selectedCandidateIds,storyboard:p.storyboard,semanticReview:p.result?.semanticReview??null,cards:(p.result?.cards??[]).map(card=>Object.fromEntries(['cardId','order','role','title','body','sourceIds','imagePlan','imageAssetId'].map(key=>[key,card[key]??null])))});
async function dbView(){
 const db=new Database(resolve(data,'카드뉴스.sqlite'),{readonly:true,fileMustExist:true});
 try{
  db.pragma('query_only=ON');db.exec('BEGIN');
  const assets={};for(const row of db.prepare('SELECT id,path FROM assets').all())assets[row.id]=hash(await readFile(isAbsolute(row.path)?row.path:resolve(data,row.path)));
  return {projects:Object.fromEntries(db.prepare('SELECT id,payload FROM projects').all().map(r=>[r.id,hash(r.payload)])),history:Object.fromEntries(db.prepare('SELECT project_id,version,payload FROM history').all().map(r=>[`${r.project_id}:${r.version}`,hash(r.payload)])),modelValues:db.prepare('SELECT project_id,model,version FROM project_model_settings ORDER BY project_id').all(),assets,active:db.prepare("SELECT count(*) n FROM runs WHERE status IN ('queued','running','waiting_for_user','cancel_requested')").get().n,quickCheck:db.pragma('quick_check',{simple:true})};
 }finally{db.close();}
}
await mkdir(out,{recursive:true});
const boot=await fetch(base+'/api/bootstrap',{headers:{Origin:base}});if(!boot.ok)throw Error('BOOTSTRAP_FAILED');
const cookie=boot.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),csrf=(await boot.json()).data.csrfToken;
const headers={Origin:base,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
const get=async path=>{const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('API_READ_FAILED');return (await response.json()).data;};
const before=await get('/api/projects/'+projectId),beforeDb=await dbView();
if(!execute){console.log(JSON.stringify({mode:'read_only',projectVersion:before.projectVersion,resultVersion:before.result?.version,cards:before.result?.cards.length,active:beforeDb.active,worker:before.execution?.worker.state}));}
else{
 let ledger;try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!ledger){
  if(before.projectVersion!==expectedProjectVersion||before.result?.version!==expectedResultVersion||before.result.cards.length!==7||beforeDb.active||before.execution?.worker.state!=='ready'||before.result.cards.some(c=>!c.imageAssetId||!c.previewAssetId)||before.result.finalApprovedVersion!==null)throw Error('ORIGINAL_OR_WORKER_STATE_CHANGED');
  const ps='$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress';
  const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:20000}));if(resource.freeKB<3*1024*1024||resource.browserProcesses!==0)throw Error('APPLY_RESOURCE_GATE_FAILED');
  ledger={projectId,at:new Date().toISOString(),state:'reserved',request:{requestId:randomUUID(),version:before.result.version,scope:'layout',renderOnly:true,cardIds:before.result.cards.map(c=>c.cardId),instruction:'표시 규칙만 새 버전으로 재합성합니다. 원고·출처·주장·배경은 그대로 보존합니다.'},resource,protectedHash:hash(canonical(protectedView(before))),oldCards:before.result.cards.map(c=>({cardId:c.cardId,revision:c.revision,previewAssetId:c.previewAssetId,imageAssetId:c.imageAssetId})),beforeDb};
  const file=await open(ledgerPath,'wx');try{await file.writeFile(JSON.stringify(ledger,null,2));}finally{await file.close();}
 }
 if(ledger.projectId!==projectId||ledger.request.scope!=='layout'||ledger.request.renderOnly!==true)throw Error('LEDGER_SCOPE_MISMATCH');
 if(!ledger.runId){
  const response=await fetch(base+`/api/projects/${projectId}/revisions`,{method:'POST',headers,body:JSON.stringify(ledger.request),signal:AbortSignal.timeout(20000)}),body=await response.json();
  if(response.status!==202||!body.data?.runId)throw Error(body.error?.code??'RENDER_REQUEST_REJECTED');
  Object.assign(ledger,{runId:body.data.runId,state:'accepted'});await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
 }
 const deadline=Date.now()+180000;let run;
 do{
  run=await get('/api/runs/'+ledger.runId);
  if(!['queued','running','waiting_for_user','cancel_requested'].includes(run.status))break;
  if(Date.now()>deadline)throw Error('RENDER_DEADLINE_EXCEEDED');
  await new Promise(r=>setTimeout(r,1000));
 }while(true);
 const after=await get('/api/projects/'+projectId),afterDb=await dbView(),db=new Database(resolve(data,'카드뉴스.sqlite'),{readonly:true});
 let phases;try{phases=db.prepare('SELECT payload FROM invocations WHERE run_id=?').all(ledger.runId).map(r=>JSON.parse(r.payload).phase);}finally{db.close();}
 const preserved=hash(canonical(protectedView(after)))===ledger.protectedHash;
 const oldFiles=Object.entries(ledger.beforeDb.assets).every(([id,sha])=>afterDb.assets[id]===sha);
 const oldHistory=Object.entries(ledger.beforeDb.history).every(([key,sha])=>afterDb.history[key]===sha);
 const otherProjects=Object.entries(ledger.beforeDb.projects).filter(([id])=>id!==projectId).every(([id,sha])=>afterDb.projects[id]===sha);
 const modelValues=canonical(ledger.beforeDb.modelValues)===canonical(afterDb.modelValues);
 const cards=after.result.cards.map(c=>{const old=ledger.oldCards.find(a=>a.cardId===c.cardId);return {order:c.order,cardId:c.cardId,revision:c.revision,state:c.state,imageAssetId:c.imageAssetId,previewAssetId:c.previewAssetId,oldPreviewAssetId:old.previewAssetId,passed:c.state==='ready'&&c.revision===old.revision+1&&c.imageAssetId===old.imageAssetId&&c.previewAssetId!==old.previewAssetId};});
 const previewPaths=[];
 for(const card of cards){
  const response=await fetch(base+`/api/projects/${projectId}/assets/${card.previewAssetId}`,{headers,signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('NEW_PREVIEW_READBACK_FAILED');
  const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==afterDb.assets[card.previewAssetId])throw Error('HTTP_PREVIEW_HASH_MISMATCH');
  const path=resolve(out,`최종_${card.order}.png`);await writeFile(path,bytes);previewPaths.push({order:card.order,path,sha256:hash(bytes)});
  const old=await fetch(base+`/api/projects/${projectId}/assets/${card.oldPreviewAssetId}`,{headers,signal:AbortSignal.timeout(15000)});if(!old.ok||hash(Buffer.from(await old.arrayBuffer()))!==ledger.beforeDb.assets[card.oldPreviewAssetId])throw Error('OLD_PREVIEW_NOT_PRESERVED');
 }
 const result={at:new Date().toISOString(),runId:ledger.runId,runStatus:run.status,projectVersion:after.projectVersion,resultVersion:after.result.version,finalApprovedVersion:after.result.finalApprovedVersion,cardCount:cards.length,protectedContent:preserved,oldAssetsPreserved:oldFiles,oldHistoryPreserved:oldHistory,otherProjectsPreserved:otherProjects,modelValuesPreserved:modelValues,quickCheck:afterDb.quickCheck,active:afterDb.active,phases,modelOrImageInvocation:phases.some(p=>!['planning','render','terminal_commit'].includes(p)),cards,previewPaths};
 result.passed=run.status==='succeeded'&&after.result.version===ledger.request.version+1&&after.result.finalApprovedVersion===null&&cards.length===7&&cards.every(c=>c.passed)&&preserved&&oldFiles&&oldHistory&&otherProjects&&modelValues&&afterDb.quickCheck==='ok'&&!afterDb.active&&!result.modelOrImageInvocation;
 await writeFile(resolve(out,'반영결과.json'),JSON.stringify(result,null,2));
 ledger.state=result.passed?'verified':'failed';await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
