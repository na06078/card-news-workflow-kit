import {test,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {fixture,hash} from './자료.js';
import {singleBrowser} from './단일브라우저.js';
import {renderCard} from '../../src/render/렌더러.js';

test('전체 프레임 배경 위에 큰 그림 중심30%와 연속 그라디언트·투명 footer를 유지한다',async()=>{
 const monitor=singleBrowser();
 try{
  const i=await fixture('전체배경');const p=new PNG({width:1024,height:1024});
  for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)p.data.set(x>=280&&x<744&&y>=300&&y<724?[20,160,150,255]:[248,244,232,255],(y*1024+x)*4);
  const bytes=PNG.sync.write(p);await writeFile(i.image.absolutePath,bytes);i.image.sha256=hash(bytes);
  const out=await renderCard(i),m=monitor.measurements[0];
  await writeFile(resolve(i.outputPath,'../전체배경측정.json'),JSON.stringify(m,null,2));
  expect([m.image.x,m.image.y,m.image.width,m.image.height],'배경은 작은 별도 그림 박스가 아니라 전체 프레임').toEqual([0,0,1080,1080]);
  expect(m.footerBackground).toBe('rgba(0, 0, 0, 0)');expect(m.veil).toBe('linear-gradient(rgb(8, 20, 39), rgb(8, 20, 39))'.replace('rgb(8, 20, 39), rgb(8, 20, 39)','rgba(8, 20, 39, 0.3), rgba(8, 20, 39, 0.7) 35%, rgb(8, 20, 39) 80%'));
  expect(m.veilRect.height).toBe(1080);expect(m.artwork.centerYRatio).toBeCloseTo(.3,6);
  expect(m.artwork.height).toBeGreaterThan(590);expect(m.artwork.width/m.artwork.height).toBeCloseTo(464/424,4);
  const final=PNG.sync.read(await readFile(out.path));const ys:number[]=[];
  for(let y=0;y<700;y++)for(let x=0;x<1080;x++){const n=(y*1080+x)*4;const [r,g]=final.data.subarray(n,n+3);if(g-r>18&&r<20)ys.push(y);}
  const top=Math.min(...new Set(ys)),bottom=Math.max(...new Set(ys));expect((top+bottom)/2/1080).toBeCloseTo(.3,2);expect(bottom-top).toBeGreaterThan(590);
  const px=(x:number,y:number)=>[...final.data.subarray((y*1080+x)*4,(y*1080+x)*4+3)];
  expect(px(10,100)[0]).toBeGreaterThan(px(10,500)[0]);expect(px(10,500)[0]).toBeGreaterThan(px(10,750)[0]);expect(px(1000,950)).toEqual(px(10,950));
  expect([m.title,m.body]).toEqual([i.card.title,i.card.body]);expect(out.checks.overflow).toBe(false);expect(hash(await readFile(i.image.absolutePath))).toBe(i.image.sha256);
 }finally{monitor.restore();}
},60000);
