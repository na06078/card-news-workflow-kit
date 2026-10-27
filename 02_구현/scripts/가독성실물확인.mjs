import Database from 'better-sqlite3';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {renderCard} from '../dist/server/render/렌더러.js';

const root=process.cwd(),data=resolve('실행데이터/앱');
const projectId='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
const group=process.env.CARDNEWS_VERIFY_GROUP??'배경구도수정';
if(!['가독성개선/재개','배경구도수정'].includes(group))throw Error('INVALID_EVIDENCE_GROUP');
const runId=randomUUID(),out=resolve('실행데이터',group,'실물',runId);
const sample=process.argv.includes('--sample'),all=process.argv.includes('--all');
const order=Number(process.argv.find(a=>a.startsWith('--card='))?.slice(7)??4);
if(!Number.isInteger(order)||order<1||order>7||sample&&all)throw Error('INVALID_CARD_SELECTION');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const db=new Database(resolve(data,'카드뉴스.sqlite'),{readonly:true,fileMustExist:true});
let project,assets;
try{
 db.pragma('query_only=ON');db.exec('BEGIN');
 project=JSON.parse(db.prepare('SELECT payload FROM projects WHERE id=?').get(projectId).payload);
 assets=new Map(db.prepare('SELECT id,payload FROM assets WHERE project_id=?').all(projectId).map(a=>[a.id,JSON.parse(a.payload)]));
}finally{db.close();}
await mkdir(out,{recursive:true});
const cards=sample?[project.result.cards[0]]:all?project.result.cards:project.result.cards.filter(c=>c.order===order);
const launch=chromium.launch.bind(chromium),measurements=[],resources=[];
chromium.launch=async options=>{
 const ps='$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$o=Get-CimInstance Win32_OperatingSystem;$b=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like "*card-news-workflow-kit*.브라우저*chrome.exe"});@{freeKB=[long]$o.FreePhysicalMemory;browserProcesses=$b.Count}|ConvertTo-Json -Compress';
 const before=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:20000}));resources.push({at:new Date().toISOString(),...before});
 if(before.freeKB<3*1024*1024||before.browserProcesses!==0)throw Error('RESOURCE_GATE_FAILED');
 const browser=await launch(options),close=browser.close.bind(browser);
 browser.close=async()=>{
  try{for(const context of browser.contexts())for(const page of context.pages())measurements.push(await page.evaluate(()=>{
   if(!document.querySelector('#card'))return null;
   const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
   return {image:rect('#background'),main:rect('.main'),footer:rect('footer'),header:rect('.eyebrow'),artwork:JSON.parse(document.querySelector('#background').dataset.artwork??'null'),veil:getComputedStyle(document.querySelector('.veil')).backgroundImage,footerBackground:getComputedStyle(document.querySelector('footer')).backgroundColor,font:getComputedStyle(document.querySelector('p')).fontSize,bodyLineHeight:getComputedStyle(document.querySelector('p')).lineHeight,dense:document.querySelector('#card').classList.contains('content-dense'),title:document.querySelector('h1').textContent,body:document.querySelector('p').textContent,footerText:document.querySelector('footer').innerText};
  }));}finally{await close();}
 };
 return browser;
};
const results=[];
try{
 for(const card of cards){
  const asset=assets.get(card.imageAssetId);if(!asset)throw Error('EXISTING_IMAGE_MISSING');
  const background=sample?resolve('실행데이터/가독성개선/샘플/7286e515-f073-4744-b1ea-05b582b42e78/image.png'):asset.absolutePath;
  const expected=sample?'2d73c36dea80c0d49e0cb5f0c581219d2eed1d2528b16526996ad856e9a9ace4':asset.sha256;
  if(hash(await readFile(background))!==expected)throw Error('BACKGROUND_HASH_MISMATCH');
  const output=await renderCard({projectId,runId,attempt:1,resultVersion:project.result.version,card,size:project.result.size,image:{assetId:card.imageAssetId,absolutePath:background,sha256:expected},researchAt:project.period.anchorAt,sourceLabels:project.sources.filter(s=>card.sourceIds.includes(s.sourceId)).map(s=>({sourceId:s.sourceId,label:s.publisher??new URL(s.url).hostname,url:s.url})),font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},templateVersion:'cn-basic-2',outputPath:resolve(out,`카드_${card.order}.png`)});
  const m=measurements.at(-1),exact=m.title===card.title&&m.body===card.body;
  const height=project.result.size==='1080x1350'?1350:1080,a=m.artwork;
  const fullBackground=Math.abs(m.image.left)<1&&Math.abs(m.image.top)<1&&m.image.width===1080&&m.image.height===height;
  const geometry=!!a&&Math.abs(a.centerYRatio-.30)<.015&&a.left>=-1&&a.top>=-1&&a.left+a.width<=1081&&a.top+a.height<=height+1&&Math.abs(a.width/a.sourceBounds.width-a.height/a.sourceBounds.height)<.001;
  const gradient=m.veil.includes('linear-gradient')&&m.footerBackground==='rgba(0, 0, 0, 0)';
  const minimumFont=card.layout?.fontScale==='small'?34:36;
  if(!exact||!fullBackground||!geometry||!gradient||parseFloat(m.font)<minimumFont||hash(await readFile(background))!==expected||/https?:\/\/|설명용 이미지|T\d\d:/.test(m.footerText))throw Error('ACTUAL_CARD_ACCEPTANCE_FAILED');
  const {title,body,...safeMeasurements}=m;
  const result={order:card.order,path:output.path,sha256:output.sha256,bytes:output.bytes,checks:output.checks,originalTextPreserved:exact,backgroundPreserved:true,fullBackground,geometry,gradient,measurements:safeMeasurements};results.push(result);
  console.log(JSON.stringify({order:card.order,passed:true,bodyChars:[...card.body].length,artworkCenterY:a.centerYRatio,artworkHeight:a.height,bodyFont:m.font,path:output.path}));
 }
}catch(error){results.push({passed:false,errorCode:error.error?.details?.reason??error.message});process.exitCode=1;}
finally{
 chromium.launch=launch;
 const result={at:new Date().toISOString(),passed:results.length===cards.length&&results.every(r=>r.originalTextPreserved),mode:sample?'approved_separate_sample':'actual_original_cards',projectId,sourceResultVersion:project.result.version,sampleUsedAsCurrentBackground:false,modelCalls:0,appWrites:0,resources,results};
 await writeFile(resolve(out,'실물검증.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,count:results.length,path:resolve(out,'실물검증.json')}));if(!result.passed)process.exitCode=1;
}
