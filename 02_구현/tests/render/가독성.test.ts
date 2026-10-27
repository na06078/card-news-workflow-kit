import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {cardHtml} from '../../src/render/카드템플릿.js';
import {fixture,hash} from './자료.js';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {renderCard} from '../../src/render/렌더러.js';
import {singleBrowser} from './단일브라우저.js';

test.each(['centered','native-upper'])('중앙/상단 원본 %s 그림은 전체 배경에서 중심30%로 크게 보인다',async(position)=>{
 const monitor=singleBrowser();try{
 const i=await fixture(`TEST-그림분리-${position}`);const png=new PNG({width:1024,height:1024});
 for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const p=(y*1024+x)*4,subject=x>=280&&x<744&&y>=(position==='centered'?300:100)&&y<(position==='centered'?724:524);png.data.set(subject?[20,160,150,255]:[248,244,232,255],p);}
 const bytes=PNG.sync.write(png);await writeFile(i.image.absolutePath,bytes);i.image.sha256=hash(bytes);
 i.card.title='원본 그림과 원고를 보존하는 배치';i.card.body='긴 원고의 내용을 자르거나 그림을 가리지 않습니다. '.repeat(5);i.card.role='body';
 const out=await renderCard(i),final=PNG.sync.read(await readFile(out.path));const ys:number[]=[];
 for(let y=0;y<700;y++)for(let x=0;x<final.width;x++){const p=(y*final.width+x)*4;if(final.data[p]<20&&final.data[p+1]-final.data[p]>18)ys.push(y);}
 expect(ys.length).toBeGreaterThan(20000);const top=Math.min(...new Set(ys)),bottom=Math.max(...new Set(ys));
 expect((top+bottom)/2/1080).toBeCloseTo(.3,2);expect(bottom-top).toBeGreaterThan(590);expect(monitor.measurements[0].image.height).toBe(1080);
 expect(hash(await readFile(i.image.absolutePath))).toBe(i.image.sha256);
 await writeFile(resolve(out.path,'../그림측정.json'),JSON.stringify({top,bottom,centerRatio:(top+bottom)/2/1080,checks:out.checks}));
 }finally{monitor.restore();}
},30000);
test('footer는 안정 중복 제거한 매체명과 UTC 날짜부만 보이며 이미지 alt는 보존한다',async()=>{
 const i=await fixture('TEST-가독성-footer');
 i.sourceLabels=['연합 <뉴스>','연합 <뉴스>','example.org'].map(label=>({sourceId:randomUUID(),label,url:'https://example.org/article-long-title'}));
 i.card.sourceIds=i.sourceLabels.map(s=>s.sourceId);i.researchAt='2026-10-23T23:59:59.000Z';
 const before=JSON.stringify(i),html=cardHtml(i,'',Buffer.from('test'),Buffer.from('test'));
 const footer=html.match(/<footer>([\s\S]*?)<\/footer>/)![1];
 expect(footer).not.toContain('https://');expect(footer.match(/연합 &lt;뉴스&gt;/g)).toHaveLength(1);
 expect(footer).toContain('example.org');expect(footer).toContain('조사 기준 2026-10-23');expect(footer).not.toContain('T23:');
 expect(footer).not.toContain('설명용 이미지');expect(html).toContain('alt="설명용 이미지"');expect(JSON.stringify(i)).toBe(before);
});
