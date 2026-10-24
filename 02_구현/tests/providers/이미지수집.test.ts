import {beforeAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm,realpath,symlink,link,utimes,stat,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
const cid='11111111-1111-4111-8111-111111111111';
const browserExecutablePath=resolve('.브라우저/chromium-1248/chrome-win64/chrome.exe');
const scratch=resolve('실행데이터/연결준비/전체실사용검증/수집검사/임시');
let dir:string,cacheRoot:string,outputPath:string,jpeg:Buffer,expectedPixels:Buffer;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function materializer(){return (await import('../../src/providers/이미지수집.js')).materializeAgyImage;}
const input=()=>({cacheRoot,conversationId:cid,outputPath,browserExecutablePath,signal:new AbortController().signal});
beforeAll(async()=>{
 // OFFLINE 합성 JPEG fixture. 실제 생성 이미지/API가 아니며 네트워크를 사용하지 않습니다.
 const browser=await chromium.launch({headless:true,executablePath:browserExecutablePath});
 try{const context=await browser.newContext({offline:true,serviceWorkers:'block'});await context.route('**/*',r=>r.abort());const page=await context.newPage();
 const fixture=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=7;canvas.height=3;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e03467';ctx.fillRect(0,0,7,3);ctx.fillStyle='#34a9cf';ctx.fillRect(3,0,4,3);const url=canvas.toDataURL('image/jpeg',0.9);const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,0,0);return {jpeg:url.split(',')[1],pixels:Array.from(ctx.getImageData(0,0,7,3).data)};});
 jpeg=Buffer.from(fixture.jpeg,'base64');expectedPixels=Buffer.from(fixture.pixels);
 }finally{await browser.close();}
},30000);
beforeEach(async()=>{await mkdir(scratch,{recursive:true});dir=await realpath(await mkdtemp(join(scratch,'오프라인-')));cacheRoot=join(dir,'brain');await mkdir(join(cacheRoot,cid),{recursive:true});await mkdir(join(dir,'output'));outputPath=join(dir,'output','image.png');await writeFile(join(cacheRoot,cid,'vendor.jpg'),jpeg);});
afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
describe('OFFLINE 합성 raster — agy 실호출 없음',()=>{
 it('현재 CID JPEG만 PNG로 변환하고 원본·픽셀·크기·해시를 보존한다',async()=>{
  const other=join(cacheRoot,'22222222-2222-4222-8222-222222222222');await mkdir(other);await writeFile(join(other,'ignored.png'),'corrupt OTHER CID');
  const materialize=await materializer();const result=await materialize(input());const png=await readFile(outputPath);const decoded=PNG.sync.read(png,{checkCRC:true});
  expect(result).toEqual({sourcePath:join(cacheRoot,cid,'vendor.jpg'),sourceSha256:sha(jpeg),sourceBytes:jpeg.length,width:7,height:3});
  expect([decoded.width,decoded.height]).toEqual([7,3]);expect(decoded.data).toEqual(expectedPixels);expect(sha(decoded.data)).toBe(sha(expectedPixels));expect(await readFile(result.sourcePath)).toEqual(jpeg);
 },30000);
 it.each(['../escape','not-uuid','11111111-1111-4111-8111-111111111111/../other'])('UUID 경계 거절: %s',async conversationId=>{const materialize=await materializer();await expect(materialize({...input(),conversationId})).rejects.toMatchObject({code:'ASSET_INVALID'});});
 it.each(['relative','unc','traversal','filename','missing-parent'])('목적지 경계 거절: %s',async kind=>{
  const target=kind==='relative'?'image.png':kind==='unc'?'//server/share/image.png':kind==='traversal'?join(dir,'output')+'/../output/image.png':kind==='filename'?join(dir,'output','other.png'):join(dir,'missing','image.png');
  await expect((await materializer())({...input(),outputPath:target})).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it.each(['relative','unc','traversal'])('캐시 root 경계 거절: %s',async kind=>{
  const root=kind==='relative'?'brain':kind==='unc'?'//server/share/brain':cacheRoot+'/../brain';
  await expect((await materializer())({...input(),cacheRoot:root})).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it('이미지 후보 복수는 newest로 고르지 않고 거절한다',async()=>{await writeFile(join(cacheRoot,cid,'second.webp'),jpeg);await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});});
 it('후보 0개면 다른 CID를 찾지 않는다',async()=>{await rm(join(cacheRoot,cid,'vendor.jpg'));await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});});
 it.each(['corrupt','svg','empty','broken-jpeg','bad-png-crc'])('잘못된 raster 거절: %s',async kind=>{
  let bytes:Buffer=kind==='svg'?Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'):kind==='empty'?Buffer.alloc(0):kind==='broken-jpeg'?Buffer.from([255,216,255,0]):Buffer.from('not raster');
  if(kind==='bad-png-crc'){bytes=PNG.sync.write(new PNG({width:2,height:2}));bytes[29]^=255;}
  await writeFile(join(cacheRoot,cid,'vendor.jpg'),bytes);await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});
 },30000);
 it('기존 목적지는 그대로 두고 거절한다',async()=>{const marker=Buffer.from('DO NOT OVERWRITE');await writeFile(outputPath,marker);await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});expect(await readFile(outputPath)).toEqual(marker);});
 it('mtime이 실행보다 오래된 원본을 거절한다',async()=>{await utimes(join(cacheRoot,cid,'vendor.jpg'),new Date(0),new Date(0));await expect((await materializer())({...input(),notBefore:Date.now()})).rejects.toMatchObject({code:'ASSET_INVALID'});});
 it('중단된 요청은 파일을 만들지 않는다',async()=>{const ac=new AbortController();ac.abort();await expect((await materializer())({...input(),signal:ac.signal})).rejects.toMatchObject({code:'EXTERNAL_OUTCOME_UNKNOWN'});await expect(stat(outputPath)).rejects.toMatchObject({code:'ENOENT'});});
 it('launch 중 취소해도 생성된 격리 browser를 닫는다',async()=>{
  const launch=chromium.launch.bind(chromium),ac=new AbortController();let closed=false;
  const spy=vi.spyOn(chromium,'launch').mockImplementationOnce(async options=>{const browser=await launch(options);browser.once('disconnected',()=>{closed=true;});ac.abort();return browser;});
  try{await expect((await materializer())({...input(),signal:ac.signal})).rejects.toMatchObject({code:'EXTERNAL_OUTCOME_UNKNOWN'});expect(closed).toBe(true);await expect(stat(outputPath)).rejects.toMatchObject({code:'ENOENT'});}finally{spy.mockRestore();}
 },30000);
 it('symlink source 거절 — 권한 미지원이면 명시 skip',async({skip})=>{
  const target=join(dir,'fixture.jpg');await writeFile(target,jpeg);await rm(join(cacheRoot,cid,'vendor.jpg'));
  try{await symlink(target,join(cacheRoot,cid,'vendor.jpg'));}catch(e){if(['EPERM','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??''))return skip('OS symlink 권한 미지원; 권한 변경하지 않음');throw e;}
  await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it.each(['cid','root','parent'])('junction 디렉터리 거절: %s',async kind=>{
  const path=kind==='cid'?join(cacheRoot,cid):kind==='root'?cacheRoot:join(dir,'output');const target=join(dir,'junction-target');await rename(path,target);
  await symlink(target,path,process.platform==='win32'?'junction':'dir');await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});
 });
 it('브라우저 실행 실패는 원시 오류 없이 공급자 실행 오류로 전달한다',async()=>{
  const spy=vi.spyOn(chromium,'launch').mockRejectedValueOnce(new Error('OFFLINE browser unavailable PRIVATE_MARKER'));
  try{await expect((await materializer())(input())).rejects.toMatchObject({code:'IMAGE_GENERATION_FAILED',message:'IMAGE_GENERATION_FAILED'});}finally{spy.mockRestore();}
 });
 it('원본이 변환 도중 바뀌면 PNG를 게시하지 않는다',async()=>{
  const launch=chromium.launch.bind(chromium);const spy=vi.spyOn(chromium,'launch').mockImplementationOnce(async options=>{await writeFile(join(cacheRoot,cid,'vendor.jpg'),Buffer.from('CHANGED OFFLINE'));return launch(options);});
  try{await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});await expect(stat(outputPath)).rejects.toMatchObject({code:'ENOENT'});}finally{spy.mockRestore();}
 },30000);
 it('4096을 넘는 decoded 크기는 캔버스 변환 전에 거절한다',async()=>{await writeFile(join(cacheRoot,cid,'vendor.jpg'),PNG.sync.write(new PNG({width:4097,height:1})));await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});},30000);
 it('hardlink 원본 거절',async()=>{await link(join(cacheRoot,cid,'vendor.jpg'),join(dir,'hardlink.jpg'));await expect((await materializer())(input())).rejects.toMatchObject({code:'ASSET_INVALID'});});
 it('PNG 원본은 크기와 실제 RGBA를 그대로 보존한다',async()=>{
  const fixture=new PNG({width:2,height:4});fixture.data.fill(255);fixture.data[0]=25;const source=PNG.sync.write(fixture);await writeFile(join(cacheRoot,cid,'vendor.jpg'),source);
  const result=await (await materializer())(input());const decoded=PNG.sync.read(await readFile(outputPath),{checkCRC:true});expect([result.width,result.height]).toEqual([2,4]);expect(decoded.data).toEqual(fixture.data);expect(result.sourceSha256).toBe(sha(source));
 },30000);
});
