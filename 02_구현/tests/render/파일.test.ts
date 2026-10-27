import {test,expect,beforeEach,afterEach} from 'vitest';
import {singleBrowser} from './단일브라우저.js';
let monitor:ReturnType<typeof singleBrowser>;
beforeEach(()=>{monitor=singleBrowser();});
afterEach(()=>{monitor.restore();});
import {readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import {fixture,data,hash} from './자료.js';
import {renderCard} from '../../src/render/렌더러.js';
import {cardHtml} from '../../src/render/카드템플릿.js';
import {RenderOutputSchema,AppErrorSchema} from '../../src/shared/포트.js';
import {safePath,dataRoot,RenderFailure} from '../../src/render/파일경계.js';

test('긴 한국어·긴 URL 세로형 본문과 closing을 실제 렌더한다',async()=>{
 const i=await fixture('TEST-세로');i.size='1080x1350';i.card.role='body';i.card.order=2;
 i.card.title='새로운 도구를 이해할 때\n기능보다 먼저 확인할 조건';
 i.card.body='TEST 자료 · 실제 뉴스가 아닙니다.\n발표와 출시는 다릅니다. 이용 가능한 지역과 계정, 요금제 조건을 원문에서 확인하세요.\n한 가지 주장만으로 효과를 단정하지 않고 아직 확인하지 못한 한계도 함께 기록합니다.';
 const sourceId=randomUUID();i.card.sourceIds=[sourceId];i.sourceLabels=[{sourceId,label:'TEST 원문 예시 · 열람하지 않음',url:'https://example.org/research/'+('long-path-'.repeat(12))}];
 await writeFile(resolve(data,'TEST-세로-입력.json'),JSON.stringify(i,null,2));
 const out=await renderCard(i);RenderOutputSchema.parse(out);const p=PNG.sync.read(await readFile(out.path),{checkCRC:true});expect([p.width,p.height]).toEqual([1080,1350]);
 await writeFile(resolve(data,'세로-측정.json'),JSON.stringify(out,null,2));
 const closing=await fixture('TEST-마지막');closing.card.role='closing';closing.card.title='다음 소식을 만나기 전,\n원문을 한 번 더';closing.card.order=3;await renderCard(closing);
},30000);

test('HTML 특수문자와 script·외부 이미지 주입을 문자로만 렌더한다',async()=>{
 const i=await fixture('TEST-이스케이프');i.card.title='<script>alert(1)</script>';i.card.body='<img src="https://example.org/x"> & 한글';
 const html=cardHtml(i,'',Buffer.from('test'),Buffer.from('test'));
 expect(html).not.toContain('<script>');expect(html).not.toContain('<img src="https:');expect(html).toContain('&lt;script&gt;');expect(html).toContain('&amp;');
 const out=await renderCard(i);expect(out.checks.overflow).toBe(false);
},30000);

test('텍스트 수정은 원본 배경 해시를 재사용하고 입력 버전·개정번호를 보존한다',async()=>{
 const i=await fixture('TEST-수정전');const a=await renderCard(i);const imageBefore=hash(await readFile(i.image.absolutePath));
 const revised=structuredClone(i);revised.card.title='근거를 다시 살피는\n작은 습관';revised.card.revision=2;revised.resultVersion=2;revised.outputPath=resolve(data,'TEST-수정후.png');await rm(revised.outputPath,{force:true});
 const b=await renderCard(revised);expect(b.sha256).not.toBe(a.sha256);expect(b.cardRevision).toBe(2);expect(b.resultVersion).toBe(2);expect(hash(await readFile(i.image.absolutePath))).toBe(imageBefore);expect(revised.image).toEqual(i.image);
 await writeFile(resolve(data,'수정-측정.json'),JSON.stringify({before:a,after:b,imageBefore,imageAfter:hash(await readFile(i.image.absolutePath))},null,2));
},30000);

test('과도하게 긴 한국어 제목·본문은 자동 잘림 대신 구조화된 overflow 오류를 낸다',async()=>{
 const i=await fixture('TEST-넘침');i.card.title='긴 한국어 제목입니다 '.repeat(50);i.card.body='너무 긴 본문과 조건 '.repeat(100);
 await expect(renderCard(i)).rejects.toMatchObject({error:{code:'RENDER_FAILED',details:{reason:'TEXT_OVERFLOW'}}});
 await expect(readFile(i.outputPath)).rejects.toMatchObject({code:'ENOENT'});
},30000);

test('누락/손상 글꼴은 fallback PNG를 만들지 않는다',async()=>{
 const i=await fixture('TEST-글꼴오류');i.font.absolutePath=resolve('assets/render/없는글꼴.woff2');
 await expect(renderCard(i)).rejects.toMatchObject({error:{code:'RENDER_FAILED'}});
 const bad=resolve('assets/render/TEST-손상글꼴.woff2');await writeFile(bad,'wOF2 corrupt');i.font.absolutePath=bad;
 try{await expect(renderCard(i)).rejects.toMatchObject({error:{code:'RENDER_FAILED'}});}finally{await rm(bad,{force:true});}
});

test('이미지 손상·해시 변경·경로 탈출은 ASSET_INVALID 또는 검증 오류로 거절한다',async()=>{
 const i=await fixture('TEST-이미지오류');i.image.sha256='0'.repeat(64);await expect(renderCard(i)).rejects.toMatchObject({error:{code:'ASSET_INVALID'}});
 const bad=resolve(data,'TEST-손상이미지.png');const b=Buffer.from('not png');await writeFile(bad,b);i.image.absolutePath=bad;i.image.sha256=hash(b);await expect(renderCard(i)).rejects.toMatchObject({error:{code:'ASSET_INVALID'}});
 i.image.absolutePath=resolve('../assets/ai-news-background.png');await expect(renderCard(i)).rejects.toMatchObject({error:{code:'ASSET_INVALID'}});
});

test('output 경로·ADS·UNC·junction 탈출을 거절하고 기존 검증 PNG는 덮지 않는다',async()=>{
 for(const p of [resolve('../TEST-escape.png'),'\\\\server\\share\\x.png',resolve(data,'a.png')+':stream'])await expect(safePath(p,dataRoot,true)).rejects.toThrow();
 const junction=resolve(data,'TEST-junction');await rm(junction,{force:true,recursive:true});await symlink(resolve('assets/render'),junction,'junction');
 await expect(safePath(resolve(junction,'OFL.txt'),dataRoot)).rejects.toThrow();await rm(junction,{force:true});
 const i=await fixture('TEST-불변');const out=await renderCard(i);const before=await readFile(out.path);await expect(renderCard(i)).rejects.toBeInstanceOf(RenderFailure);expect(await readFile(out.path)).toEqual(before);
},30000);

test('잘못된 CN-1 입력과 이미 취소된 signal은 구조화 오류로 거절한다',async()=>{
 const i=await fixture('TEST-취소');const controller=new AbortController();controller.abort();
 try{await renderCard(i,{signal:controller.signal});throw new Error('통과하면 안 됨');}catch(e){expect(e).toBeInstanceOf(RenderFailure);AppErrorSchema.parse((e as RenderFailure).error);}
 await expect(renderCard({...i,templateVersion:'untrusted'} as never)).rejects.toMatchObject({error:{code:'RENDER_FAILED'}});
 await expect(renderCard({...i,sourceLabels:[{sourceId:randomUUID(),label:'고아 출처',url:'https://example.org/x'}]})).rejects.toMatchObject({error:{code:'RENDER_FAILED'}});
});
