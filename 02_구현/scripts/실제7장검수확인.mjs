import {chromium} from 'playwright';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.cwd(),base=resolve(root,'실행데이터/실사용검수복구'),budgetPath=resolve(base,'실행승인.json');
const projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55',url='http://127.0.0.1:5173';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const protectedView=p=>({topic:p.topic,period:p.period,researchVersion:p.researchVersion,candidates:p.candidates,selectedCandidateIds:p.selectedCandidateIds,storyboard:p.storyboard,result:p.result,claims:p.claims,sources:p.sources,exports:p.exports,claudeModel:p.claudeModel,modelSettingsVersion:p.modelSettingsVersion});
if(!process.argv.includes('--execute')&&!process.argv.includes('--prepare'))console.log('READ_ONLY: --prepare는 선택 준비만, --execute는 명시 예산 안에서 검수를 실행합니다.');
else{
 await mkdir(base,{recursive:true});const lock=await open(budgetPath+'.lock','wx');let browser,context,page,entry,runId,csrf='';const folder=resolve(base,randomUUID());await mkdir(folder,{recursive:true});
 let acceptedPosts=0,terminal=false,checkpoint='budget';const blocked=[],safeEvents=[];
 try{
  const budget=JSON.parse(await readFile(budgetPath,'utf8'));const untilComplete=budget.mode==='until_complete'&&budget.approvedUntilComplete===true;if(!budget.approved||budget.projectId!==projectId||!untilComplete&&(budget.maxRequests>2||budget.attempts.length>=budget.maxRequests))throw Object.assign(Error('예산 없음'),{code:'LIVE_BUDGET_EXHAUSTED'});
  checkpoint='browser';browser=await chromium.launch({executablePath:resolve(root,'.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true});context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});page=await context.newPage();
  const get=async path=>{const r=await context.request.get(url+path,{headers:{Origin:url}});if(!r.ok())throw Object.assign(Error('API 조회 실패'),{code:'LIVE_API_READ_FAILED'});return (await r.json()).data;};
  checkpoint='bootstrap';csrf=(await get('/api/bootstrap')).csrfToken;
  checkpoint='snapshots';const list=(await get('/api/projects')).projects,initial={};for(const p of list)initial[p.projectId]=digest(protectedView(await get('/api/projects/'+p.projectId)));
  const before=await get('/api/projects/'+projectId);if(before.activeRun||list.some(p=>p.activeRunId))throw Object.assign(Error('다른 작업 진행 중'),{code:'RUN_ACTIVE'});
  await writeFile(resolve(folder,'보존기준.json'),JSON.stringify({projectId,projectVersion:before.projectVersion,protectedHashes:initial,claimCount:before.claims.length,cardCount:before.result?.cards.length??0},null,2));
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(!['127.0.0.1','localhost'].includes(u.hostname)){blocked.push({kind:'external',host:u.hostname});return route.abort();}
   if(['GET','HEAD'].includes(req.method())||req.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.continue();
   if(req.method()==='POST'&&u.pathname===`/api/projects/${projectId}/factReview`&&entry&&acceptedPosts===0){const body=req.postDataJSON();if(body.reviewer==='agy'&&body.reviewEffort==='high'&&body.version===before.projectVersion&&JSON.stringify(body.claimIndices)===JSON.stringify(before.claims.map((_,i)=>i))&&JSON.stringify([...body.cardIds].sort())===JSON.stringify(before.result.cards.map(c=>c.cardId).sort())){acceptedPosts++;return route.continue();}}
   blocked.push({kind:'mutation',path:u.pathname});return route.abort();
  });
  checkpoint='page';await page.goto(url+'/?project='+projectId);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor({timeout:20000});
  const panel=page.getByRole('region',{name:'사실 문제와 복구'});await panel.getByLabel('다음 요청 의미 검수자').selectOption('agy');await panel.getByLabel('Gemini 검수 노력').selectOption('high');
  for(let i=0;i<before.claims.length;i++){checkpoint=`claim_${i+1}`;await panel.getByRole('checkbox',{name:new RegExp(`문제 주장 ${i+1} 선택`)}).check();}
  for(const card of before.result.cards){checkpoint=`card_${card.order}`;await panel.getByRole('checkbox',{name:`영향 카드 ${card.order} 선택`,exact:true}).check();}
  checkpoint='button';const button=panel.getByRole('button',{name:'선택한 주장·카드 사실 재검증',exact:true});const current=await get('/api/projects/'+projectId);await writeFile(resolve(folder,'준비화면진단.json'),JSON.stringify({group:await panel.getByRole('group',{name:'사실 재검증 요청과 상태'}).innerText(),checked:await panel.getByRole('checkbox').evaluateAll(es=>es.filter(e=>e.checked).length),allowedActions:current.allowedActions,execution:current.execution,active:current.activeRun?.status??null},null,2));if(!await button.isEnabled())throw Object.assign(Error('실제 선택 후 요청 불가'),{code:'LIVE_REVIEW_BUTTON_DISABLED'});
  if(process.argv.includes('--prepare')){await writeFile(resolve(folder,'준비결과.json'),JSON.stringify({prepared:true,claimCount:before.claims.length,cardCount:before.result.cards.length,provider:await panel.getByLabel('다음 요청 의미 검수자').inputValue(),effort:await panel.getByLabel('Gemini 검수 노력').inputValue(),acceptedPosts:0,blocked},null,2));console.log(JSON.stringify({prepared:true,acceptedPosts:0,resultPath:resolve(folder,'준비결과.json')}));}
  else{
  entry={id:randomUUID(),projectId,startedAt:new Date().toISOString(),state:'reserved',claudeReserved:1,agyReserved:1,folder};budget.attempts.push(entry);await writeFile(budgetPath,JSON.stringify(budget,null,2));
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/api/projects/${projectId}/factReview`);await button.click();const received=await response;const payload=await received.json();if(received.status()!==202||!payload.data?.runId)throw Object.assign(Error('재검수 접수 실패'),{code:payload.error?.code??'LIVE_REVIEW_NOT_ACCEPTED'});runId=payload.data.runId;entry.runId=runId;entry.state='accepted';await writeFile(budgetPath,JSON.stringify(budget,null,2));await writeFile(resolve(folder,'접수.json'),JSON.stringify({status:received.status(),receipt:payload.data},null,2));
  let phase='',phaseStarted=Date.now(),lastPrint=0,after=0,run;
  for(;;){
   run=await get('/api/runs/'+runId);const ep=await get(`/api/projects/${projectId}/events?after=${after}`);after=ep.nextSeq;
   for(const e of ep.events)if(e.runId===runId){safeEvents.push({type:e.type,phase:e.phase??null,at:e.at,actualModel:e.actualModel??null,activity:e.activity??null,errorCode:e.error?.code??null});}
   const nextPhase=run.phase==='semantic-review'?'semantic-review':'source';if(nextPhase!==phase){phase=nextPhase;phaseStarted=Date.now();console.log(JSON.stringify({runId,phase,status:run.status}));}
   if(!['queued','running','waiting_for_user','cancel_requested'].includes(run.status)){terminal=true;break;}
   if(Date.now()-lastPrint>20000){console.log(JSON.stringify({runId,phase,status:run.status,elapsedSeconds:Math.round((Date.now()-phaseStarted)/1000)}));lastPrint=Date.now();}
   if(Date.now()-phaseStarted>budget.timeoutMs+10000){const cancelled=await context.request.post(url+`/api/runs/${runId}/cancel`,{headers:{Origin:url,'X-CSRF-Token':csrf},data:{requestId:randomUUID()}});await writeFile(resolve(folder,'시간제한취소.json'),JSON.stringify({runId,status:cancelled.status(),phase},null,2));throw Object.assign(Error('승인 시간 초과'),{code:'LIVE_REVIEW_DEADLINE'});}
   await new Promise(r=>setTimeout(r,1000));
  }
  const final=await get('/api/projects/'+projectId),unchanged={};for(const p of list)unchanged[p.projectId]=digest(protectedView(await get('/api/projects/'+p.projectId)))===initial[p.projectId];
  const report=final.factReview?.proposal?.semanticReview,reportReady=run.status==='succeeded'&&final.factReview?.state==='ready'&&!!report;
  const contentUnchanged=Object.values(unchanged).every(Boolean);if(!contentUnchanged)throw Object.assign(Error('보존 대상 변경 감지'),{code:'PROTECTED_CONTENT_CHANGED'});
  await page.reload();await panel.waitFor({timeout:10000});const text=await panel.innerText();const displayed=!!report&&text.includes(report.verdict)&&text.includes('적용 전 제안');
  let captureError=false;try{const heading=panel.getByRole('heading',{name:'적용 전 제안 LLM 의미 검수 의견',exact:true});if(report)await heading.locator('..').screenshot({path:resolve(folder,'실제검수결과화면.png')});else await panel.screenshot({path:resolve(folder,'실제검수실패화면.png')});}catch{captureError=true;}
  const result={runId,run:{status:run.status,phase:run.phase,error:run.error,requestedModel:run.requestedModel,actualModel:run.actualModel},projectStatus:final.status,reportReady,displayed,verdict:report?.verdict??null,reviewer:report?.reviewer??final.factReview?.reviewer,report:report??null,proposalSources:final.factReview?.proposal?.sources.map(s=>({sourceId:s.sourceId,url:s.url,access:s.access}))??[],proposalCardCount:final.factReview?.proposal?.cards.length??0,contentUnchanged,unchanged,acceptedPosts,blocked,events:safeEvents,originalApplied:false,finalApproved:false,newImages:0};
  result.captureError=captureError;await writeFile(resolve(folder,'실제7장결과.json'),JSON.stringify(result,null,2));Object.assign(entry,{state:reportReady&&displayed?'result_displayed':'failed',verdict:report?.verdict??null,errorCode:run.error?.code??null,finishedAt:new Date().toISOString()});console.log(JSON.stringify({runId,state:entry.state,verdict:entry.verdict,errorCode:entry.errorCode,contentUnchanged,resultPath:resolve(folder,'실제7장결과.json')}));if(entry.state!=='result_displayed')process.exitCode=1;
  }
 }catch(error){const errorCode=/^[A-Z_]{1,80}$/.test(error.code??'')?error.code:'LIVE_HARNESS_FAILED',sourceLine=/실제7장검수확인\.mjs:(\d+):\d+/.exec(error.stack??'')?.[1]??null;if(entry)Object.assign(entry,{state:'error',errorCode,finishedAt:new Date().toISOString()});console.error(JSON.stringify({runId:runId??null,state:'error',errorCode,errorType:error.name,checkpoint,sourceLine}));process.exitCode=1;
 }finally{
  if(entry){const b=JSON.parse(await readFile(budgetPath,'utf8')),i=b.attempts.findIndex(x=>x.id===entry.id);if(i>=0)b.attempts[i]=entry;await writeFile(budgetPath,JSON.stringify(b,null,2));}
  await writeFile(resolve(folder,'실행진단.json'),JSON.stringify({runId:runId??null,terminal,acceptedPosts,checkpoint,blocked,events:safeEvents},null,2));await context?.close();await browser?.close();await lock.close();await unlink(budgetPath+'.lock');
 }
}
