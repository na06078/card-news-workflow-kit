import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// 실제 앱 조회/미제출 조작과, 명시 합성 이력의 화면 부하 검사를 구분합니다.
const base='http://127.0.0.1:5173';
const projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
const label=process.argv[2]??'반영전';
if(!/^[가-힣0-9_-]+$/.test(label))throw Error('INVALID_LABEL');
const onlyFixture=Number(process.argv.find(a=>a.startsWith('--fixture='))?.slice(10)??0);
if(![0,100,1000,10000].includes(onlyFixture))throw Error('INVALID_FIXTURE_COUNT');
const realOnly=process.argv.includes('--real-only'),group=process.env.CARDNEWS_VERIFY_GROUP??'가독성개선/재개';
if(!['가독성개선/재개','배경구도수정'].includes(group))throw Error('INVALID_EVIDENCE_GROUP');
const out=resolve('실행데이터',group,'화면',label);
await mkdir(out,{recursive:true});
const checks=[],errors=[],mutations=[],fixtureTraffic=[];
const check=(name,ok,detail={})=>{checks.push({name,passed:!!ok,...detail});if(!ok)throw Error(name);};
const ps='$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$os=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$os.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress';
const resource=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:20000}));
check('브라우저 시작 전 자원',resource.freeKB>=3*1024*1024&&resource.browserProcesses===0,resource);
let browser;
try{
 browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const hit=async locator=>{await locator.scrollIntoViewIfNeeded();return locator.evaluate(e=>{const r=e.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:r.width,height:r.height,hit:target===e||e.contains(target)};});};
 const wheelHistory=async(page,list)=>{
  await list.scrollIntoViewIfNeeded();const box=await list.boundingBox();check('이력 목록 좌표 있음',!!box);
  const before=await list.evaluate(e=>e.scrollTop);
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height/2,120));await page.mouse.wheel(0,240);await page.waitForTimeout(180);
  const after=await list.evaluate(e=>e.scrollTop);check('이력 안 실제 휠',after>before,{before,after});
 };
 async function contextFor(fixtureCount=0){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(!['127.0.0.1','localhost'].includes(url.hostname)){
    // 원문 링크 클릭은 관측하되 외부 페이지를 요청하지 않습니다.
    return route.fulfill({status:200,contentType:'text/plain',body:'TEST: external navigation observed; article not fetched'});
   }
   if(fixtureCount&&req.method()==='GET'&&url.pathname===`/api/projects/${projectId}/events`){
    const after=Number(url.searchParams.get('after')??0),end=Math.min(fixtureCount,after+100);
    fixtureTraffic.push({count:fixtureCount,after,end,at:new Date().toISOString()});
    const events=Array.from({length:Math.max(0,end-after)},(_,n)=>({projectId,runId:'00000000-0000-4000-8000-000000000001',attempt:1,at:'2026-10-26T00:00:00.000Z',seq:after+n+1,type:'progress',phase:'research',message:`TEST 합성 이력 ${after+n+1}`,completed:null,total:null}));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{events,nextSeq:end,hasMore:end<fixtureCount}})});
   }
   if(['GET','HEAD'].includes(req.method())||req.method()==='POST'&&url.pathname==='/api/providers/refresh')return route.continue();
   mutations.push({method:req.method(),path:url.pathname});return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
  return {context,page};
 }
 if(!onlyFixture){
  const {context,page}=await contextFor();
  try{
   await page.goto(base+'/?project='+projectId);await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor({timeout:20000});
   const panel=page.getByRole('region',{name:'사실 문제와 복구'});
   const response=await context.request.get(base+'/api/projects/'+projectId,{headers:{Origin:base}});check('실제 프로젝트 조회',response.ok());
   const snapshot=(await response.json()).data;check('실제7장',snapshot.result.cards.length===7);
   await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.review-card .preview img')];return images.length===7&&images.every(i=>i.complete&&i.naturalWidth===1080&&i.naturalHeight>0);},{},{timeout:15000});
   const imageIds=await page.locator('.review-card .preview img').evaluateAll(images=>images.map(i=>new URL(i.currentSrc).pathname.split('/').at(-1)));
   check('화면7PNG는 현재 결과 자산',snapshot.result.cards.every(c=>imageIds.includes(c.previewAssetId)),{resultVersion:snapshot.result.version,count:imageIds.length});
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
    check(`실제 ${width} 가로 넘침 없음`,dimensions.documentWidth<=width+1,dimensions);
    const history=page.locator('details.event-history');check(`실제 ${width} 이력 기본 접힘`,await history.getAttribute('open')===null);
    await history.locator(':scope > summary').click();const list=page.getByRole('list',{name:'시간순 작업 이력'});
    const historySize=await list.evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,overflow:getComputedStyle(e).overflowY}));
    check(`실제 ${width} 이력360px`,historySize.height<=360&&historySize.overflow==='auto',historySize);
    if(historySize.scrollHeight>historySize.height)await wheelHistory(page,list);
    await history.locator(':scope > summary').click();
    const card=page.locator('.review-card').first(),editor=card.locator('details.text-editor'),body=card.locator('textarea[id^="body-"]');
    check(`실제 ${width} 원고 기본 접힘`,await editor.getAttribute('open')===null);
    await editor.locator(':scope > summary').click();const original=await body.inputValue();await body.fill(original+'\nTEST 미제출 가독성 확인');
    await editor.locator(':scope > summary').click();check(`실제 ${width} 닫힌 미제출 표시`,(await editor.locator('summary').innerText()).includes('미제출 변경 있음'));
    await editor.locator(':scope > summary').click();check(`실제 ${width} 초안 유지`,(await body.inputValue())===original+'\nTEST 미제출 가독성 확인');
    check(`실제 ${width} 미제출 최종승인 차단`,await page.getByRole('button',{name:'현재 결과 최종 승인',exact:true}).isDisabled());
    await body.fill(original);await editor.locator(':scope > summary').click();
    const details=card.locator('details.source-details').first(),link=card.locator('.source-heading a').first();
    check(`실제 ${width} 출처 기본 접힘`,await details.getAttribute('open')===null);const linkHit=await hit(link);check(`실제 ${width} 원문 접근`,linkHit.hit,linkHit);
    const popupEvent=context.waitForEvent('page');await link.click();const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');await popup.close();
    check(`실제 ${width} 원문 클릭이 접힘 유지`,await details.getAttribute('open')===null);
    await details.locator(':scope > summary').click();check(`실제 ${width} 출처 펼침`,await details.getAttribute('open')!==null);await details.locator(':scope > summary').click();
    await panel.getByRole('button',{name:'모든 주장·카드 선택',exact:true}).click();await panel.getByLabel('다음 요청 의미 검수자').selectOption('claude');
    const issue=panel.locator('details.semantic-issue').first();if(await issue.count()){await issue.locator(':scope > summary').click();await issue.locator(':scope > summary').click();}
    check(`실제 ${width} 검수 선택 유지`,await panel.getByLabel('다음 요청 의미 검수자').inputValue()==='claude'&&await panel.getByRole('checkbox').evaluateAll(es=>es.every(e=>e.checked)));
    for(const name of ['선택한 주장·카드 사실 재검증','사실 수정안 전체 적용','현재 결과 최종 승인']){
     const button=page.getByRole('button',{name,exact:true});const h=await hit(button);check(`실제 ${width} 조작 도달 ${name}`,h.hit,h);
    }
    const preview=card.getByRole('button',{name:'카드 1 PNG 크게 보기',exact:true});await preview.click();const dialog=page.getByRole('dialog',{name:'카드 1 미리보기'});await dialog.waitFor();await page.keyboard.press('Escape');check(`실제 ${width} 확대 닫기·초점 복귀`,!await dialog.count()&&await preview.evaluate(e=>document.activeElement===e));
    await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(20,300);const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,650);await page.waitForTimeout(180);const scrollAfter=await page.evaluate(()=>scrollY);check(`실제 ${width} 문서 휠`,scrollAfter>scrollBefore,{scrollBefore,scrollAfter});
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(out,`실제화면_${width}.png`)});
    await card.screenshot({path:resolve(out,`실제카드_${width}.png`)});
    // 긴 요소 screenshot의 상단 경계와 실제 스크롤로 읽을 수 없는 잘림을 구분합니다.
    const cardHeading=card.locator('h3');await cardHeading.evaluate(e=>e.scrollIntoView({block:'center'}));
    const headingHit=await hit(cardHeading);check(`실제 ${width} 카드 제목 도달`,headingHit.hit,headingHit);
    await page.screenshot({path:resolve(out,`현재카드화면_${width}.png`)});
   }
   await page.reload();await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();check('새로고침 접힘 복원',await page.locator('details.event-history').getAttribute('open')===null);
  }finally{await context.close();}
 }
 for(const count of realOnly?[]:onlyFixture?[onlyFixture]:[100,1000,10000]){
  const {context,page}=await contextFor(count);
  try{
   await page.goto(base+'/?project='+projectId);await page.locator('details.event-history > summary').filter({hasText:`${count}건`}).waitFor({timeout:30000});
   const history=page.locator('details.event-history');
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});check(`합성 이력${count}/${width} 기본 접힘`,await history.getAttribute('open')===null);
    const collapsedHeight=await page.evaluate(()=>document.documentElement.scrollHeight);await history.locator(':scope > summary').click();
    const list=page.getByRole('list',{name:'시간순 작업 이력'}),m=await list.evaluate(e=>({count:e.children.length,height:e.clientHeight,scrollHeight:e.scrollHeight,pageHeight:document.documentElement.scrollHeight}));
    check(`합성 이력${count}/${width} 제한 높이`,m.count===count&&m.height<=360&&m.pageHeight-collapsedHeight<450,m);
    await list.evaluate(e=>e.scrollTop=0);await wheelHistory(page,list);await history.locator(':scope > summary').click();
   }
  }catch(error){
   const state=await page.evaluate(()=>({summary:document.querySelector('details.event-history > summary')?.textContent,items:document.querySelector('ol[aria-label="시간순 작업 이력"]')?.children.length,uiErrors:[...document.querySelectorAll('.error')].map(e=>e.textContent?.slice(0,300))})).catch(()=>null);
   await writeFile(resolve(out,`이력_${count}_진단.json`),JSON.stringify({count,state,traffic:fixtureTraffic.filter(r=>r.count===count)},null,2));throw error;
  }finally{await context.close();}
 }
 check('요청하지 않은 내용 변경 없음',mutations.length===0,{mutations});check('브라우저 오류 없음',errors.length===0,{errors});
}catch(error){errors.push(error.message);process.exitCode=1;}
finally{
 await browser?.close();const result={at:new Date().toISOString(),label,passed:checks.length>0&&checks.every(c=>c.passed)&&errors.length===0,checks,errors,mutations,syntheticHistoryCounts:[...new Set(fixtureTraffic.map(r=>r.count))],modelRequests:0,contentMutations:0};
 result.fixtureTraffic=fixtureTraffic;
 await writeFile(resolve(out,'화면검증.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:checks.length,failed:checks.filter(c=>!c.passed).map(c=>c.name),errors,path:resolve(out,'화면검증.json')}));if(!result.passed)process.exitCode=1;
}
