// 승인된 격리 project Chromium + F1 전용 Vite. 사용자 브라우저 사용 없음.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const data=resolve('실행데이터/F1');await mkdir(data,{recursive:true});
const records=[],screenshots=[],errors=[];let browser,server;
const check=(name,value)=>{assert.ok(value,name);records.push({name,passed:true});};
const shot=async(page,name)=>{const path=resolve(data,`${name}.png`);await page.screenshot({path,fullPage:true});screenshots.push(path);};
try{
 server=await createServer({configFile:false,root:process.cwd(),cacheDir:resolve(data,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:5181,strictPort:true,watch:{ignored:['**/실행데이터/F1/임시/**','**/실행데이터/F1/vite-cache/**']}},logLevel:'error'});await server.listen();
 console.log(JSON.stringify({pid:process.pid,execPath:process.execPath,startedAt:new Date().toISOString(),server:'http://127.0.0.1:5181',mode:'isolated mock fixture only'}));
 browser=await chromium.launch({executablePath:resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul'});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){errors.push(`forbidden network ${u.origin}`);await route.abort();return;}
  if(u.pathname==='/api/bootstrap'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'LOGIN_REQUIRED',message:'공식 로그인 필요 (오류 주입)',retryable:false,nextActions:['check_login'],projectId:null,runId:null,currentVersion:null,details:{}}})});return;}
  if(u.pathname.includes('/assets/')){const png=new PNG({width:1080,height:1080});for(let i=0;i<png.data.length;i+=4){png.data[i]=45;png.data[i+1]=89;png.data[i+2]=65;png.data[i+3]=255;}await route.fulfill({contentType:'image/png',body:PNG.sync.write(png)});return;}
  await route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const open=async scenario=>{await page.goto(`http://127.0.0.1:5181/실행데이터/F1/화면검사.html?scenario=${scenario}`);await page.getByRole('heading',{name:scenario==='topic'?'어떤 이야기를 전할까요?':scenario==='http-error'?'요청을 확인해 주세요':scenario==='selection'?'후보 선택':scenario==='question'?'편집 방향 확인':scenario==='storyboard'?'스토리보드':scenario==='cancel'?'취소 요청됨 · 정리 확인 중':'카드 검수',exact:true}).waitFor();};
 const overflow=async name=>check(`${name} 수평 overflow 없음`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await open('topic');await page.keyboard.press('Tab');check('키보드 본문 건너뛰기 포커스',await page.getByRole('link',{name:'본문으로 건너뛰기'}).evaluate(e=>e===document.activeElement));await shot(page,'데스크톱-주제');
 await page.getByLabel('조사 주제',{exact:true}).fill('반응형 모의 조사');await page.getByRole('button',{name:'프로젝트 만들기'}).click();await page.getByRole('button',{name:'자료 조사 시작'}).waitFor();check('프로젝트 생성 후 자동 조사 없음',await page.getByRole('button',{name:'자료 조사 시작'}).isEnabled());await page.getByRole('button',{name:'자료 조사 시작'}).click();await page.getByRole('heading',{name:'후보 선택',exact:true}).waitFor();check('모의 조사 명시 실행',await page.getByText('[모의] 발표 후보',{exact:true}).isVisible());
 await open('selection');await overflow('데스크톱 후보');await shot(page,'데스크톱-후보');
 const boxes=page.getByRole('checkbox');await boxes.nth(0).check();await boxes.nth(1).check();await boxes.nth(2).check();check('3개 선택 후 4번째 차단',await boxes.nth(3).isDisabled());
 await page.setViewportSize({width:375,height:812});await overflow('375px 후보');await shot(page,'모바일-후보');
 await boxes.nth(1).uncheck();await boxes.nth(2).uncheck();await page.getByRole('button',{name:'선택한 후보로 진행'}).click();await page.getByRole('button',{name:'답변 저장'}).waitFor();check('추천 자동 답변 아님',await page.getByRole('button',{name:'답변 저장'}).isDisabled());await shot(page,'모바일-질문');
 await page.getByRole('radio',{name:'직접 입력',exact:true}).check();await page.getByLabel('독자 자유 답변').fill('처음 접하는 교육자');await page.getByRole('button',{name:'답변 저장'}).click();await page.getByRole('heading',{name:'스토리보드',exact:true}).waitFor();check('자유 입력 답변 수락 모의 흐름',await page.getByRole('button',{name:'스토리보드 승인 · 제작 시작'}).isDisabled());await overflow('375px 계획');await shot(page,'모바일-스토리보드');
 await page.getByRole('checkbox',{name:'계획과 크기를 확인했습니다'}).check();await page.getByRole('button',{name:'스토리보드 승인 · 제작 시작'}).click();await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor();await overflow('375px 검수');await shot(page,'모바일-검수');
 await page.getByLabel('카드 1 제목',{exact:true}).fill('제목만 별도로 바꾸기');await page.getByRole('button',{name:'카드 1 텍스트 수정 요청'}).click();await page.getByText('개정 2 · ready',{exact:true}).waitFor();check('특정 카드 text 수정 개정 증가',true);
 await page.getByRole('button',{name:'카드 1 개별 승인'}).click();await page.getByText('현재 개정 승인 저장됨',{exact:true}).waitFor();check('개별 승인 저장 표시',true);
 await page.getByRole('checkbox',{name:'사실·출처와 시각적 가독성을 직접 확인했습니다'}).check();await page.getByRole('button',{name:'현재 결과 최종 승인'}).click();await page.getByRole('heading',{name:'내려받기',exact:true}).waitFor();check('모의 다운로드 링크 없음',await page.getByRole('link',{name:/ZIP 내려받기/}).count()===0);await shot(page,'모바일-최종승인');
 await open('failure');check('카드별 실패 재시도',await page.getByRole('button',{name:'카드 1 실패 작업 재시도'}).isEnabled());await overflow('375px 실패');await shot(page,'모바일-실패');
 await open('interrupted');check('불명 외부 결과 재시도 차단',await page.getByRole('button',{name:'실패·중단 작업 재시도'}).isDisabled());await page.getByRole('checkbox',{name:/외부 실행 결과가 불명확/}).check();check('위험 확인 후만 재시도 허용',await page.getByRole('button',{name:'실패·중단 작업 재시도'}).isEnabled());await shot(page,'모바일-중단');
 await open('cancel');check('취소 정리 대기 중 이중 취소 차단',await page.getByRole('button',{name:'작업 취소 요청'}).isDisabled());await shot(page,'모바일-취소중');
 await open('http-error');check('실제 HTTP 오류를 그대로 표시',await page.getByText('LOGIN_REQUIRED',{exact:true}).isVisible());check('HTTP 실패 시 mock fallback 없음',await page.getByText('모의 데이터 · 실제 조사/생성 아님',{exact:true}).count()===0);await overflow('375px HTTP 오류');await shot(page,'모바일-HTTP오류');
 await page.setViewportSize({width:1440,height:1000});await open('review');await shot(page,'데스크톱-검수');
 await open('preview');const image=page.getByRole('img',{name:'카드 1 서버 렌더 PNG',exact:true});await image.waitFor();check('실제 PNG bytes 주입 미리보기 decode',await image.evaluate(e=>e.complete&&e.naturalWidth===1080));await page.getByRole('button',{name:'카드 1 PNG 크게 보기'}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Tab');check('확대 미리보기 키보드 포커스 격리',await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"],dialog')));await page.keyboard.press('Escape');check('확대 PNG Escape 닫기',await page.getByRole('dialog').count()===0);
 check('브라우저 pageerror/외부 네트워크 없음',errors.length===0);
 console.log(JSON.stringify({passed:records.length,screenshots,errors},null,2));
}finally{
 await browser?.close();await server?.close();
 await writeFile(resolve(data,'브라우저결과.json'),JSON.stringify({records,screenshots,errors,mode:'mock fixtures + injected HTTP errors + local PNG bytes only; not B1/provider integration',cleanup:'finally browser.close and owned Vite server.close'},null,2));
}
