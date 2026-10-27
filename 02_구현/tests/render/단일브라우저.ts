import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {vi} from 'vitest';

/** 실제 renderer 페이지를 닫기 직전에 읽습니다. 진단용 두 번째 브라우저는 만들지 않습니다. */
export function singleBrowser(){
 const measurements: any[]=[];
 const launch=chromium.launch.bind(chromium);
 function resources(stage:string){
  const raw=execFileSync('powershell.exe',['-NoProfile','-Command','$o=Get-CimInstance Win32_OperatingSystem; $p=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and ($_.ExecutablePath -like "*\\.브라우저\\*" -or $_.CommandLine -like "*playwright_chromiumdev_profile*") }); @{freeKB=$o.FreePhysicalMemory;totalKB=$o.TotalVisibleMemorySize;browserPids=@($p | ForEach-Object {$_.ProcessId})} | ConvertTo-Json -Compress'],{encoding:'utf8',timeout:15000});
  const r=JSON.parse(raw);console.log('RESOURCE',stage,JSON.stringify(r));
  return r;
 }
 const spy=vi.spyOn(chromium,'launch').mockImplementation(async options=>{
  const before=resources('before');
  if(before.freeKB<3*1024*1024||before.browserPids.length)throw new Error('브라우저 자원 안전 조건 불충족');
  const browser=await launch(options);const close=browser.close.bind(browser);let closed=false;
  browser.close=async()=>{
   if(closed)return;closed=true;
   try{for(const context of browser.contexts())for(const page of context.pages()){
    measurements.push(await page.evaluate(()=>{const rect=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON();return {image:rect('#background'),main:rect('.main'),header:rect('.eyebrow'),footer:rect('footer'),bodyFont:getComputedStyle(document.querySelector('p')!).fontSize,title:document.querySelector('h1')!.textContent,body:document.querySelector('p')!.textContent,dense:document.querySelector('#card')!.classList.contains('content-dense')};}));
    Object.assign(measurements.at(-1),await page.evaluate(()=>({artwork:JSON.parse(document.querySelector<HTMLElement>('#background')!.dataset.artwork??'null'),footerBackground:getComputedStyle(document.querySelector('footer')!).backgroundColor,veil:getComputedStyle(document.querySelector('.veil')!).backgroundImage,veilRect:document.querySelector('.veil')!.getBoundingClientRect().toJSON()})));
    console.log('LAYOUT',JSON.stringify(measurements.at(-1)));
    console.log('BOUNDS',JSON.stringify(await page.evaluate(()=>({content:{rect:document.querySelector('.content')!.getBoundingClientRect().toJSON(),sh:document.querySelector('.content')!.scrollHeight,ch:document.querySelector('.content')!.clientHeight},bounds:[...document.querySelectorAll('[data-check]')].map(e=>({tag:e.tagName,rect:e.getBoundingClientRect().toJSON(),sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight}))}))));
   }}finally{await close();resources('after');}
  };
  return browser;
 });
 return {measurements,restore:()=>spy.mockRestore()};
}
