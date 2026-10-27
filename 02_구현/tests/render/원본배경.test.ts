import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture,hash} from './자료.js';
import {singleBrowser} from './단일브라우저.js';
import {renderCard} from '../../src/render/렌더러.js';
import {artworkCopy,artworkGeometry} from '../../src/render/그림여백.js';
import {PNG} from 'pngjs';

test('현재 원본7장의 종이 바탕·경계와 원본3·7의 하단 경계를 보존하며 긴 실제4번만 렌더한다',async()=>{
 const id='43daccac-2d26-4db1-bdd7-3b0e6416cd55';
 const db=new Database(resolve('실행데이터/앱/카드뉴스.sqlite'),{readonly:true,fileMustExist:true});
 let project:any,assets:Map<string,any>;
 try{db.pragma('query_only=ON');db.exec('BEGIN');project=JSON.parse((db.prepare('SELECT payload FROM projects WHERE id=?').get(id) as any).payload);assets=new Map(db.prepare('SELECT id,payload FROM assets WHERE project_id=?').all(id).map((a:any)=>[a.id,JSON.parse(a.payload)]));}finally{db.close();}
 const evidence=[];
 for(const c of project.result.cards){
  const a=assets!.get(c.imageAssetId),bytes=await readFile(a.absolutePath),p=PNG.sync.read(bytes),g=artworkGeometry(bytes);
  expect(hash(bytes)).toBe(a.sha256);expect(artworkCopy(bytes)).toEqual(bytes);expect(g.uniform).toBe(true);
  if(c.order===3||c.order===7)expect(g.sourceBounds.top+g.sourceBounds.height).toBe(p.height);
  const b=g.sourceBounds,s=Math.min(1056/b.width,624/b.height),top=324-b.height*s/2;
  expect(top).toBeGreaterThanOrEqual(12);expect(top+b.height*s).toBeLessThanOrEqual(636);
  evidence.push({order:c.order,sha256:a.sha256,...g});
 }
 const monitor=singleBrowser();try{
  const i=await fixture('실제카드4');const c=project.result.cards.find((c:any)=>c.order===4),a=assets!.get(c.imageAssetId);
  Object.assign(i,{projectId:id,resultVersion:project.result.version,card:c,size:project.result.size,image:{assetId:a.assetId??c.imageAssetId,absolutePath:a.absolutePath,sha256:a.sha256},researchAt:project.period.anchorAt,sourceLabels:project.sources.filter((s:any)=>c.sourceIds.includes(s.sourceId)).map((s:any)=>({sourceId:s.sourceId,label:s.publisher??new URL(s.url).hostname,url:s.url})),templateVersion:'cn-basic-2'});
  const out=await renderCard(i),m=monitor.measurements[0];expect(out.checks.overflow).toBe(false);expect([m.title,m.body]).toEqual([c.title,c.body]);expect([m.image.width,m.image.height]).toEqual([1080,1080]);expect(m.artwork.centerYRatio).toBe(.3);expect(hash(await readFile(a.absolutePath))).toBe(a.sha256);
  await writeFile(resolve(i.outputPath,'../원본검사.json'),JSON.stringify({evidence,actualCard:4,output:out,measurements:m},null,2));
 }finally{monitor.restore();}
},60000);

test('불균일한 바탕은 정밀 재배치 가능으로 분류하지 않는다',()=>{
 const p=new PNG({width:128,height:128});for(let y=0;y<128;y++)for(let x=0;x<128;x++)p.data.set([x*2,y*2,100,255],(y*128+x)*4);
 expect(artworkGeometry(PNG.sync.write(p)).uniform).toBe(false);
});
