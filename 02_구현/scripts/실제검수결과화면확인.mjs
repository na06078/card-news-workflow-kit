import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55',base='http://127.0.0.1:5173',out=resolve('실행데이터/실사용검수복구/결과화면',randomUUID());await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolve(root,'.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true}),context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();const blocked=[],errors=[],layouts=[];
const fail=code=>{throw Object.assign(Error(code),{code});};
await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname)){blocked.push({type:'external',host:u.hostname});return route.abort();}if(['GET','HEAD'].includes(r.method())||r.method()==='POST'&&u.pathname==='/api/providers/refresh')return route.continue();blocked.push({type:'mutation',path:u.pathname});return route.abort();});page.on('pageerror',e=>errors.push(e.name));
try{
 await page.goto(base+'/?project='+projectId);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor({timeout:20000});
 const response=await context.request.get(base+'/api/projects/'+projectId,{headers:{Origin:base}});if(!response.ok())fail('SNAPSHOT_READ_FAILED');const p=(await response.json()).data,report=p.factReview?.proposal?.semanticReview;
 if(p.factReview?.state!=='ready'||!report)fail('SEMANTIC_REPORT_MISSING');
 if(p.result?.cards.length!==7||p.claims.length!==8||report.reviewedCardIds.length!==7||new Set(report.reviewedCardIds).size!==7||p.result.cards.some(c=>!report.reviewedCardIds.includes(c.cardId))||report.reviewedClaimIndices.length!==8||new Set(report.reviewedClaimIndices).size!==8||p.claims.some((_,i)=>!report.reviewedClaimIndices.includes(i)))fail('REPORT_SCOPE_MISMATCH');
 const panel=page.getByRole('region',{name:'사실 문제와 복구'}),heading=panel.getByRole('heading',{name:'적용 전 제안 LLM 의미 검수 의견',exact:true}),article=heading.locator('..');await heading.waitFor();
 let text=await article.innerText();if(!text.includes(report.inputHash)||!text.includes(report.verdict)||!text.includes(report.reviewer.provider))fail('WRONG_REPORT_DISPLAYED');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await heading.scrollIntoViewIfNeeded();const dim=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth}));
  const button=panel.getByRole('button',{name:'사실 수정안 전체 적용',exact:true});await button.scrollIntoViewIfNeeded();const hit=await button.evaluate(e=>{const r=e.getBoundingClientRect(),t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:r.width>0&&r.height>0,hit:t===e||e.contains(t),disabled:e.disabled};});layouts.push({...dim,button:hit});if(dim.documentWidth>width+1||!hit.visible||!hit.hit)fail('RESULT_LAYOUT_FAILED');
 }
 await page.setViewportSize({width:1440,height:1000});await article.screenshot({path:resolve(out,'의미검수결과.png')});
 await page.reload();await panel.getByRole('heading',{name:'적용 전 제안 LLM 의미 검수 의견',exact:true}).waitFor();text=await article.innerText();if(!text.includes(report.inputHash)||!text.includes(report.verdict))fail('REPORT_RELOAD_FAILED');
 const result={passed:!blocked.length&&!errors.length,projectId,projectVersion:p.projectVersion,runId:p.factReview.runId,verdict:report.verdict,reviewer:report.reviewer,actualModel:report.actualModel,inputHash:report.inputHash,reviewedCards:report.reviewedCardIds.length,reviewedClaims:report.reviewedClaimIndices.length,layouts,reloaded:true,mutations:blocked,errors,newModelRequests:0};await writeFile(resolve(out,'결과표시검증.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,resultPath:resolve(out,'결과표시검증.json')}));if(!result.passed)process.exitCode=1;
}catch(e){await writeFile(resolve(out,'화면실패진단.json'),JSON.stringify({errorCode:e.code??'BROWSER_VERIFICATION_FAILED',blocked,errors,layouts,newModelRequests:0},null,2));console.error(JSON.stringify({errorCode:e.code??'BROWSER_VERIFICATION_FAILED',resultPath:resolve(out,'화면실패진단.json')}));process.exitCode=1;}finally{await context.close();await browser.close();}
