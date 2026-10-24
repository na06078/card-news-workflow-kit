import {test,expect} from '@playwright/test';
import {fork} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

test('npm dev 실제 서버·별도 worker·F1 진입점과 안전한 IPC 종료',async({browser})=>{
 const data=resolve('실행데이터/I2',randomUUID());await mkdir(data,{recursive:true});
 const child=fork(resolve('scripts/개발실행.mjs'),[`--data-dir=${data}`],{execPath:process.execPath,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout?.on('data',x=>output+=x);child.stderr?.on('data',x=>output+=x);
 const exited=new Promise<number|null>(r=>child.once('exit',r));
 try{
  const ready=await new Promise<Record<string,unknown>>((ok,fail)=>{const timer=setTimeout(()=>fail(Error('DEV_READY_TIMEOUT')),20000);child.on('message',m=>{if(m&&typeof m==='object'&&'type'in m&&m.type==='ready'){clearTimeout(timer);ok(m as Record<string,unknown>);}});child.once('exit',()=>{clearTimeout(timer);fail(Error('DEV_EXIT_BEFORE_READY'));});});
  expect(ready.components).toEqual(expect.arrayContaining(['http','worker','vite']));
  const context=await browser.newContext({serviceWorkers:'block'});const requests:string[]=[];await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(requests.push(r.request().url()),r.abort()));const page=await context.newPage();await page.goto('http://127.0.0.1:5173');await expect(page.getByLabel('조사 주제',{exact:true})).toBeVisible();await page.getByLabel('조사 주제',{exact:true}).fill('I2 생산 게이트');await page.getByRole('button',{name:'프로젝트 만들기',exact:true}).click();await page.getByRole('button',{name:'자료 조사 시작',exact:true}).click();await expect(page.getByText('AUTH_MODE_UNKNOWN',{exact:true})).toBeVisible({timeout:12000});expect(requests).toEqual([]);await page.screenshot({path:resolve(data,'정상앱-차단화면.png'),fullPage:true});await context.close();await writeFile(resolve(data,'정상앱런타임.json'),JSON.stringify({ready,childPid:child.pid,actualLiveCalls:'no SDK/auth/agy invocation; production gate',requests},null,2));
 }finally{if(child.connected)child.send({type:'shutdown'});const code=await Promise.race([exited,new Promise<never>((_,fail)=>setTimeout(()=>fail(Error('OWNED_DEV_SHUTDOWN_TIMEOUT_NO_KILL')),20000))]);await writeFile(resolve(data,'정상앱.log'),output);expect(code).toBe(0);}
});
