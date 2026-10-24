import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PNG} from 'pngjs';
import type {RenderInput} from '../../src/shared/포트.js';
export const data=resolve('실행데이터/R1');
export const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export async function fixture(name='TEST-정사각'):Promise<RenderInput>{
 await mkdir(data,{recursive:true});
 const png=new PNG({width:1080,height:1350});
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
  const i=(y*png.width+x)*4;const circle=(x-820)**2+(y-350)**2<220**2;
  png.data[i]=circle?70:18;png.data[i+1]=circle?170:38;png.data[i+2]=circle?180:64;png.data[i+3]=255;
 }
 const bytes=PNG.sync.write(png);const bg=resolve(data,'TEST-배경.png');await writeFile(bg,bytes);
 const imageId=randomUUID();const outputPath=resolve(data,name+'.png');await rm(outputPath,{force:true});
 return {projectId:randomUUID(),runId:randomUUID(),attempt:1,resultVersion:1,
 card:{cardId:randomUUID(),revision:1,order:1,role:'cover',title:'변화를 읽는 힘,\n근거에서 시작합니다',body:'로컬 TEST 렌더링 자료입니다.\n발표 내용과 실제 사용 조건을 나누어 확인하세요.\n실제 최신 검색이나 agy 생성 결과가 아닙니다.',sourceIds:[],imagePlan:'TEST: 직접 만든 기하학 배경',imageAssetId:imageId,previewAssetId:null,state:'rendering',approvedRevision:null,error:null},
 size:'1080x1080',image:{assetId:imageId,absolutePath:bg,sha256:hash(bytes)},researchAt:'2026-10-23T00:00:00.000Z',sourceLabels:[],font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},templateVersion:'cn-basic-1',outputPath};
}
