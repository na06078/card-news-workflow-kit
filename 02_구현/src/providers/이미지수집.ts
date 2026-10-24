import {lstat,realpath,readdir,open,unlink} from 'node:fs/promises';
import type {Stats} from 'node:fs';
import {isAbsolute,resolve,join,dirname,basename,parse} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,type Browser,type BrowserContext} from 'playwright';
import {PNG} from 'pngjs';
import {fail,ProviderFailure} from './오류.js';
const MAX_BYTES=50*1024*1024;
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function localPath(path:string):string {
 if(!isAbsolute(path)||/^[\\/]{2}/.test(path)||/[\x00-\x1f]/.test(path)||path.slice(parse(path).root.length).includes(':')||path.split(/[\\/]/).some(p=>p==='..'||p==='.' ))fail('ASSET_INVALID');
 return resolve(path);
}
function identity(a:Stats,b:Stats):boolean {return a.dev===b.dev&&a.ino===b.ino&&a.birthtimeMs===b.birthtimeMs;}
function stable(a:Stats,b:Stats):boolean {return identity(a,b)&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1&&b.isFile()&&!b.isSymbolicLink();}
/** 메타데이터만 검사하며 캐시의 다른 conversation 디렉터리는 열거하지 않습니다. */
async function directory(path:string):Promise<Stats>{
 const full=localPath(path);let current=parse(full).root;
 for(const part of full.slice(current.length).split(/[\\/]/).filter(Boolean)){
  current=join(current,part);const st=await lstat(current);
  if(!st.isDirectory()||st.isSymbolicLink())fail('ASSET_INVALID');
 }
 if(!same(await realpath(full),full))fail('ASSET_INVALID');return lstat(full);
}
async function absent(path:string){try{await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}fail('ASSET_INVALID');}
function mime(bytes:Buffer):string{
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return fail('ASSET_INVALID');
}
/** 검증된 단일 CID의 실제 raster bytes만 로컬 Chromium으로 디코딩/PNG 변환합니다. */
export async function materializeAgyImage(input:{cacheRoot:string;conversationId:string;outputPath:string;browserExecutablePath:string;signal:AbortSignal;notBefore?:number}):Promise<{sourcePath:string;sourceSha256:string;sourceBytes:number;width:number;height:number}>{
 let browser:Browser|undefined,context:BrowserContext|undefined,browserOperation=false;
 const checkAbort=()=>{if(input.signal.aborted)fail('EXTERNAL_OUTCOME_UNKNOWN');};
 const abort=()=>{void browser?.close().catch(()=>{});};
 input.signal.addEventListener('abort',abort,{once:true});
 try{
  checkAbort();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.conversationId)||input.notBefore!==undefined&&!Number.isFinite(input.notBefore))fail('ASSET_INVALID');
  const root=localPath(input.cacheRoot),cid=join(root,input.conversationId),output=localPath(input.outputPath),parent=dirname(output);
  if(basename(output)!=='image.png')fail('ASSET_INVALID');
  const rootStat=await directory(root),cidStat=await directory(cid),parentStat=await directory(parent);
  await absent(output);
  // 단일 CID 바로 아래만. 하위 폴더 탐색이나 newest 선택은 금지합니다.
  const candidates=(await readdir(cid)).filter(name=>/\.(?:jpe?g|png|webp)$/i.test(name));
  if(candidates.length!==1)fail('ASSET_INVALID');
  const sourcePath=join(cid,candidates[0]);const before=await lstat(sourcePath);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<=0||before.size>MAX_BYTES||!same(await realpath(sourcePath),sourcePath)||!same(dirname(await realpath(sourcePath)),cid)||input.notBefore!==undefined&&before.mtimeMs<input.notBefore-10000)fail('ASSET_INVALID');
  const file=await open(sourcePath,'r');let bytes:Buffer;
  try{
   if(!stable(before,await file.stat()))fail('ASSET_INVALID');
   bytes=Buffer.alloc(before.size);let offset=0;
   while(offset<bytes.length){checkAbort();const result=await file.read(bytes,offset,bytes.length-offset,offset);if(!result.bytesRead)fail('ASSET_INVALID');offset+=result.bytesRead;}
   const extra=Buffer.alloc(1);if((await file.read(extra,0,1,offset)).bytesRead||!stable(before,await file.stat())||!stable(before,await lstat(sourcePath))||!same(await realpath(sourcePath),sourcePath))fail('ASSET_INVALID');
  }finally{await file.close();}
  if(!identity(rootStat,await directory(root))||!identity(cidStat,await directory(cid)))fail('ASSET_INVALID');
  const contentType=mime(bytes);checkAbort();
  const executable=localPath(input.browserExecutablePath);const executableStat=await lstat(executable);
  if(!executableStat.isFile()||executableStat.isSymbolicLink()||!same(await realpath(executable),executable))fail('ASSET_INVALID');
  browserOperation=true;
  browser=await chromium.launch({headless:true,executablePath:executable,timeout:15000,args:['--disable-background-networking','--disable-component-update','--no-first-run']});checkAbort();
  context=await browser.newContext({offline:true,serviceWorkers:'block',javaScriptEnabled:true});
  await context.route('**/*',route=>route.abort('blockedbyclient'));
  const page=await context.newPage();await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:"><title>Local raster decoder</title>');
  let timer:ReturnType<typeof setTimeout>|undefined;
  const converted=await Promise.race([
   page.evaluate(async({url})=>{
    try{const image=new Image();image.src=url;await image.decode();const width=image.naturalWidth,height=image.naturalHeight;
     if(width<1||height<1||width>4096||height>4096)return null;
     const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)return null;
     ctx.drawImage(image,0,0);return {width,height,png:canvas.toDataURL('image/png').split(',')[1]};
    }catch{return null;}
   },{url:`data:${contentType};base64,${bytes.toString('base64')}`}),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ProviderFailure('ASSET_INVALID')),15000);})
  ]).finally(()=>{if(timer)clearTimeout(timer);});
  browserOperation=false;
  if(!converted)fail('ASSET_INVALID');
  // Canvas 출력을 실제 CRC/decode로 확인합니다. 소스 PNG도 손상된 CRC를 묵인하지 않습니다.
  const png=Buffer.from(converted.png,'base64');
  try{if(contentType==='image/png')PNG.sync.read(bytes,{checkCRC:true});const decoded=PNG.sync.read(png,{checkCRC:true});if(decoded.width!==converted.width||decoded.height!==converted.height)fail('ASSET_INVALID');}catch{fail('ASSET_INVALID');}
  if(!identity(parentStat,await directory(parent))||!identity(rootStat,await directory(root))||!identity(cidStat,await directory(cid))||!stable(before,await lstat(sourcePath))||!same(await realpath(sourcePath),sourcePath))fail('ASSET_INVALID');
  checkAbort();
  const destination=await open(output,'wx');let finished=false;
  try{checkAbort();await destination.writeFile(png,{signal:input.signal});checkAbort();finished=true;}
  finally{const owned=await destination.stat();await destination.close();if(!finished){const current=await lstat(output).catch(()=>undefined);if(current&&identity(owned,current))await unlink(output);}}
  return {sourcePath,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes.length,width:converted.width,height:converted.height};
 }catch(error){
  if(input.signal.aborted)fail('EXTERNAL_OUTCOME_UNKNOWN');
  if(error instanceof ProviderFailure)throw error;
  // 경로/손상 데이터는 ASSET_INVALID, Chromium 실행 문제는 재설치·경로 점검 대상입니다.
  if(browserOperation)fail('IMAGE_GENERATION_FAILED');
  return fail('ASSET_INVALID');
 }finally{input.signal.removeEventListener('abort',abort);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
