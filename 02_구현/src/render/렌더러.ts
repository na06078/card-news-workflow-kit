import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,type Browser} from 'playwright';
import {RenderInputSchema,RenderOutputSchema,type RenderCard} from '../shared/포트.js';
import {appRoot,dataRoot,localBytes,safePath,publish,sha256,RenderFailure} from './파일경계.js';
import {verifiedPng,decodePng} from './이미지검사.js';
import {cardHtml} from './카드템플릿.js';
import {placeArtwork} from './구도배치.js';
export const renderCard:RenderCard=async(raw,options={})=>{
 let browser:Browser|undefined;
 let aborted=false;
 const abort=()=>{aborted=true;void browser?.close().catch(()=>{});};
 try{
  const input=RenderInputSchema.parse(raw);
  options.signal?.throwIfAborted();options.signal?.addEventListener('abort',abort,{once:true});
  if(input.card.imageAssetId!==input.image.assetId||new Set(input.sourceLabels.map(s=>s.sourceId)).size!==input.sourceLabels.length||input.card.sourceIds.some(id=>!input.sourceLabels.some(s=>s.sourceId===id))||input.sourceLabels.some(s=>!input.card.sourceIds.includes(s.sourceId)))throw new Error('카드 이미지/출처 참조 불일치');
  await safePath(input.outputPath,dataRoot,true);
  let image:Buffer;
  try{image=(await verifiedPng(input.image.absolutePath,input.image.sha256)).bytes;}catch{throw new RenderFailure('ASSET_INVALID','배경 PNG 경로·해시·디코딩 검증 실패',input,'BACKGROUND_INVALID');}
  let font:Buffer;
  try{font=await localBytes(input.font.absolutePath,join(appRoot,'assets/render'),5*1024*1024);if(font.subarray(0,4).toString()!=='wOF2')throw new Error('WOFF2');}catch{throw new RenderFailure('RENDER_FAILED','한국어 글꼴 파일 검증 실패',input,'FONT_UNAVAILABLE');}
  try{
   const executable=await safePath(options.browserExecutablePath??join(appRoot,'.브라우저/chromium-1248/chrome-win64/chrome.exe'),join(appRoot,'.브라우저'));
   browser=await chromium.launch({headless:true,executablePath:executable,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  }catch{throw new RenderFailure('RENDER_FAILED','렌더 브라우저 기동 실패',input,'BROWSER_UNAVAILABLE');}
  if(aborted||options.signal?.aborted)throw new Error('렌더 취소');
  const height=input.size==='1080x1350'?1350:1080;
  const context=await browser.newContext({viewport:{width:1080,height},deviceScaleFactor:1,offline:true,serviceWorkers:'block',javaScriptEnabled:true});
  await context.route('**/*',route=>route.abort('blockedbyclient'));
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const css=await readFile(join(appRoot,'src/render/카드스타일.css'),'utf8');
  await page.setContent(cardHtml(input,css,image,font),{waitUntil:'load',timeout:15000});
  await page.evaluate(()=>document.fonts.ready);
  try{await page.evaluate(placeArtwork);}catch{throw new RenderFailure('ASSET_INVALID','배경의 균일한 종이 바탕·그림 경계를 확인할 수 없어 정밀 구도 변경을 중단했습니다.',input,'BACKGROUND_INVALID');}
  const checks=await page.evaluate(async()=>{
   await document.fonts.ready;await document.fonts.load('36px "Noto Sans KR"','한글 가나다라마바사');
   const fontLoaded=[...document.fonts].some(f=>f.family==='Noto Sans KR'&&f.status==='loaded')&&document.fonts.check('36px "Noto Sans KR"','한글');
   const img=document.querySelector<HTMLImageElement>('#background')!;await img.decode();
   await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
   const content=document.querySelector<HTMLElement>('.content')!;
   const measure=()=>{const cb=content.getBoundingClientRect();const bounds=[...document.querySelectorAll<HTMLElement>('[data-check]')].map(e=>({rect:e.getBoundingClientRect(),sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight,overflow:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1}));const overflow=content.scrollHeight>content.clientHeight+1||bounds.some(b=>b.overflow||b.rect.top<cb.top-1||b.rect.bottom>cb.bottom+1||b.rect.left<cb.left-1||b.rect.right>cb.right+1)||bounds.some((b,i)=>i>0&&b.rect.top<bounds[i-1].rect.bottom-1);return {cb,bounds,overflow};};
   let layout=measure();
   // 글/원문을 자르지 않습니다. 긴 카드에만 제한된 축약 배치를 한 번 시도하고 다시 검사합니다.
   if(layout.overflow){document.querySelector('#card')!.classList.add('content-dense');await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));layout=measure();}
   // 상세 좌표/본문 대신 외부 경계에서 안전한 넘침 사유로 분류합니다.
   return {fontLoaded,imageDecoded:img.naturalWidth>0&&img.naturalHeight>0,overflow:layout.overflow};
  });
  if(!checks.fontLoaded)throw new RenderFailure('RENDER_FAILED','한국어 글꼴 준비 실패',input,'FONT_UNAVAILABLE');
  if(!checks.imageDecoded)throw new RenderFailure('ASSET_INVALID','배경 디코딩 실패',input,'BACKGROUND_INVALID');
  if(checks.overflow)throw new RenderFailure('RENDER_FAILED','카드 글자 영역 넘침',input,'TEXT_OVERFLOW');
  const bytes=await page.locator('#card').screenshot({type:'png',animations:'disabled',scale:'css',timeout:15000});
  const decoded=decodePng(bytes);if(decoded.width!==1080||decoded.height!==height)throw new Error('최종 픽셀 크기 불일치');
  options.signal?.throwIfAborted();
  await publish(input.outputPath,bytes);
  return RenderOutputSchema.parse({projectId:input.projectId,resultVersion:input.resultVersion,cardId:input.card.cardId,cardRevision:input.card.revision,path:input.outputPath,mimeType:'image/png',width:1080,height,sha256:sha256(bytes),bytes:bytes.length,checks,warnings:['작은 화면 가독성은 사용자 별도 검수가 필요합니다.']});
 }catch(e){if(e instanceof RenderFailure)throw e;throw new RenderFailure('RENDER_FAILED',e instanceof Error?e.message:'렌더 실패',raw);}
 finally{options.signal?.removeEventListener('abort',abort);await browser?.close();}
};
