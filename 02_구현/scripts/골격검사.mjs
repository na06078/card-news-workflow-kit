/** S0 승인된 로컬 검사만. 누락 suite는 성공으로 취급하지 않습니다. */
import {spawnSync,fork} from 'node:child_process';
import {resolve,delimiter} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {once} from 'node:events';
const root=process.cwd(), data=resolve('실행데이터/S0');
const runtime=resolve('.도구/node-v24.22.1-win-x64');
const npm=resolve(runtime,'node_modules/npm/bin/npm-cli.js');
const env={...process.env,PATH:runtime+delimiter+process.env.PATH,npm_config_cache:resolve(data,'npm-cache'),npm_config_userconfig:resolve('.도구/npmrc'),npm_config_globalconfig:resolve('.도구/global-npmrc'),PLAYWRIGHT_BROWSERS_PATH:resolve('.브라우저'),TEMP:resolve(data,'임시'),TMP:resolve(data,'임시'),CARDNEWS_LIVE_CALLS:'forbidden'};
Object.assign(process.env,{PLAYWRIGHT_BROWSERS_PATH:env.PLAYWRIGHT_BROWSERS_PATH,TEMP:env.TEMP,TMP:env.TMP});
const scripts=['typecheck','typecheck:shared','test:shared','build','check:runtime','test:frontend','test:backend','test:providers:offline','test:render','test:worker','test:integration','test:e2e','test:live:subscription','test:live:agy'];
const results=[];
for(const name of scripts){
 const r=spawnSync(process.execPath,[npm,'run',name],{cwd:root,env,encoding:'utf8',shell:false});
 const log=resolve(data,`실행-${name.replaceAll(':','-')}.log`);writeFileSync(log,(r.stdout??'')+(r.stderr??''));
 const ready=['typecheck','typecheck:shared','test:shared','build','check:runtime'].includes(name);
 const expected=ready?0:2;
 const result={script:name,command:`node.exe npm-cli.js run ${name}`,cwd:root,exit:r.status,expected,log};results.push(result);console.log(JSON.stringify(result));
 if(r.status!==expected)throw new Error(`${name}: 기대 ${expected}, 실제 ${r.status}`);
}
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(pkg.scripts.dev!=='node scripts/개발실행.mjs')throw new Error('dev script 경계 변경');
const child=fork(resolve('scripts/개발실행.mjs'),[],{execPath:process.execPath,env,stdio:['ignore','pipe','pipe','ipc']});
let stdout='';child.stdout.on('data',b=>{stdout+=b.toString();});child.stderr.on('data',b=>{stdout+=b.toString();});
const exited=once(child,'exit');
let browser;
try {
 const [ready]=await Promise.race([once(child,'message'),exited.then(([code])=>{throw new Error(`dev 조기종료 ${code}`);}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('dev readiness timeout')),15000).unref())]);
 if(ready.type!=='ready'||ready.pid!==child.pid||ready.executable!==process.execPath||!ready.startedAt)throw new Error('앱 소유 PID/exe/start 정보 불일치');
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5173/')?route.continue():route.abort());
 const response=await page.goto(ready.url);await page.getByRole('heading',{name:'카드뉴스 구현 준비 골격'}).waitFor();
 const text=await page.locator('body').innerText();
 if(response.status()!==200||!text.includes('SCAFFOLD_ONLY'))throw new Error('골격 표시 검사 실패');
 results.push({script:'dev',command:pkg.scripts.dev,cwd:root,exit:0,ready,httpStatus:response.status(),body:text});
 await page.screenshot({path:resolve(data,'골격화면.png')});
} finally {
 if(browser)await browser.close();
 if(child.connected)child.send({type:'shutdown'});
 const [code]=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('dev 정상 종료 미확인: 임의 kill하지 않음')),15000).unref())]);
 writeFileSync(resolve(data,'실행-dev.log'),stdout+`\nexit=${code}\n`);
 if(code!==0)throw new Error(`dev 종료 ${code}`);
}
writeFileSync(resolve(data,'실행결과.json'),JSON.stringify(results,null,2));
console.log('S0 로컬 준비 검사 완료. NOT_READY/live 거절은 기능 통과가 아닙니다.');
