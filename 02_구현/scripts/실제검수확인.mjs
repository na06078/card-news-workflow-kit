import {open,readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),base=resolve(root,'실행데이터/검수모델전환/실제검수');
const budgetPath=resolve(base,'승인예산.json'),provider=process.argv[2],sample=process.argv[3];
if(!['agy','claude'].includes(provider)||!['matching','mismatch'].includes(sample)){
 console.log('READ_ONLY: 실제 실행은 provider(agy|claude)와 case(matching|mismatch), 승인예산.json이 모두 필요합니다.');
}else{
 const lock=await open(budgetPath+'.lock','wx');let reviewer,scope,attempt;
 try{
  const budget=JSON.parse(await readFile(budgetPath,'utf8'));
  if(budget.approved!==true||budget.attempts.filter(a=>a.provider===provider).length>=budget.limits[provider])throw Error('LIVE_BUDGET_NOT_AVAILABLE');
  attempt={id:randomUUID(),provider,sample,reservedAt:new Date().toISOString(),state:'reserved'};budget.attempts.push(attempt);await writeFile(budgetPath,JSON.stringify(budget,null,2));
  const cwd=resolve(base,attempt.id);await mkdir(cwd,{recursive:true});
  const {initializeOwnedScope,closeOwnedScope}=await import(pathToFileURL(resolve(root,'dist/server/providers/프로세스격리.js')).href);scope={closeOwnedScope};await initializeOwnedScope();
  const {createSemanticReviewer}=await import(pathToFileURL(resolve(root,'dist/server/providers/의미검수.js')).href);
  const projectId=randomUUID(),cardId=randomUUID(),sourceId=randomUUID(),candidateId=randomUUID(),runId=randomUUID();
  const text=sample==='matching'?'합성기관 발표에 따르면 경찰 10명이 부상했다.':'합성기관 발표에 따르면 경찰 999명이 부상했다.';
  const input={projectId,cards:[{cardId,title:'합성 자료의 부상 집계',body:text,sourceIds:[sourceId]}],claims:[{claimIndex:0,claim:{text,sourceIds:[sourceId],kind:'publisher_claim',availability:'released',conditions:['제공된 합성 자료 안의 관계만 검토']}}],sources:[{sourceId,candidateId,url:'https://example.com/semantic-review-synthetic',title:'합성 검수용 자료',publisher:'합성기관',publishedDate:null,eventDate:null,accessedAt:new Date().toISOString(),primary:true,access:'opened',evidence:'합성기관은 경찰 10명이 부상했고 시민 999명이 대피했다고 발표했다.',limitations:['SYNTHETIC FIXTURE: 실제 뉴스·기사 조회가 아니며 제공 자료와 문장의 의미 관계만 시험한다.']}]};
  const selection={provider,model:provider==='agy'?'gemini-3.8-flash-high':null};
  const signal=AbortSignal.timeout(budget.timeoutMs);
  reviewer=createSemanticReviewer({selection,livePermission:{inference:true,approvalReference:budget.approvalReference},signal});
  const report=await reviewer.review({projectId,runId,attempt:1,cwd},input);
  const cleanup=await reviewer.dispose();reviewer=undefined;
  const expected=sample==='matching'?report.verdict==='supported':report.verdict==='unsupported'||report.verdict==='unverifiable';
  const result={sample,provider,selection,report,cleanup,expectedVerdictObserved:expected,actualProvider:true,syntheticInput:true,sourceSearchOrImageCalls:0};
  await writeFile(resolve(cwd,'실제결과.json'),JSON.stringify(result,null,2));
  Object.assign(attempt,{state:expected?'passed':'unexpected_verdict',finishedAt:new Date().toISOString(),verdict:report.verdict,actualModel:report.actualModel,resultPath:resolve(cwd,'실제결과.json')});
  console.log(JSON.stringify({provider,sample,state:attempt.state,verdict:report.verdict,actualModel:report.actualModel,resultPath:attempt.resultPath}));
 }catch(error){
  const safeCode=typeof error?.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'LIVE_REVIEW_FAILED';
  if(attempt)Object.assign(attempt,{state:'error',errorCode:safeCode,finishedAt:new Date().toISOString()});
  console.error(JSON.stringify({provider,sample,state:'error',errorCode:safeCode}));process.exitCode=1;
 }finally{
  if(reviewer)try{await reviewer.dispose();}catch{process.exitCode=1;}
  if(scope)try{await scope.closeOwnedScope();}catch{console.error('OWNED_SCOPE_CLOSE_UNCONFIRMED');process.exitCode=1;}
  if(attempt){const current=JSON.parse(await readFile(budgetPath,'utf8'));const index=current.attempts.findIndex(a=>a.id===attempt.id);current.attempts[index]=attempt;await writeFile(budgetPath,JSON.stringify(current,null,2));}
  await lock.close();await unlink(budgetPath+'.lock');
 }
}
