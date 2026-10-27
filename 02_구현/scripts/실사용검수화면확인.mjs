import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),out=resolve(root,'실행데이터/검수모델전환/실사용화면',randomUUID());await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolve(root,'.브라우저/chromium-1248/chrome-win64/chrome.exe'),headless:true});
const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[],blocked=[],mutations=[],network=[],metadata=[];
await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(!['127.0.0.1','localhost'].includes(url.hostname)){blocked.push(url.hostname);return route.abort();}if(req.method()==='POST'&&url.pathname==='/api/providers/refresh'){metadata.push({method:req.method(),path:url.pathname});return route.continue();}if(!['GET','HEAD'].includes(req.method())){mutations.push({method:req.method(),path:url.pathname});return route.abort();}return route.continue();});
page.on('pageerror',e=>errors.push(e.name));page.on('response',r=>{if(r.url().includes('/api/'))network.push({path:new URL(r.url()).pathname,status:r.status()});});
try{
 const projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55';await page.goto('http://127.0.0.1:5173/?project='+projectId);
 await page.getByRole('heading',{name:'카드 검수',exact:true}).waitFor({timeout:20000});
 const panel=page.getByRole('region',{name:'사실 문제와 복구'}),provider=panel.getByLabel('다음 요청 의미 검수자'),effort=panel.getByLabel('Gemini 검수 노력');
 const defaults={provider:await provider.inputValue(),effort:await effort.inputValue()};if(defaults.provider!=='agy'||defaults.effort!=='high')throw Error('REVIEW_DEFAULT_MISMATCH');
 for(const value of ['medium','low','high']){await effort.selectOption(value);if(await effort.inputValue()!==value)throw Error('EFFORT_SELECTION_FAILED');}
 await provider.selectOption('claude');const claudeExplanation=(await panel.innerText()).includes('작성 모델 설정은 변경하지 않습니다.');if(!claudeExplanation)throw Error('CLAUDE_SELECTION_GUIDANCE_MISSING');await provider.selectOption('agy');
 const layouts=[];for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();const dimensions=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth}));layouts.push(dimensions);if(dimensions.documentWidth>width+1)throw Error('HORIZONTAL_OVERFLOW');}
 await page.setViewportSize({width:1440,height:1000});await panel.screenshot({path:resolve(out,'검수선택_실사용화면.png')});
 const result={passed:errors.length===0&&blocked.length===0&&mutations.length===0,projectId,defaults,claudeExplanation,layouts,errors,blocked,mutations,metadata,network,newModelRequests:0};await writeFile(resolve(out,'검증결과.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,defaults,layouts,errors:errors.length,blocked:blocked.length,mutations:mutations.length,metadataRefreshes:metadata.length,resultPath:resolve(out,'검증결과.json')}));if(!result.passed)process.exitCode=1;
}finally{await context.close();await browser.close();}
