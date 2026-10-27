import {PNG} from 'pngjs';
/** 원본은 절대 crop/마스킹하지 않습니다. 지배적인 종이색에 대한 보수적 그림 경계만 추정합니다. */
export function artworkGeometry(bytes:Buffer){
 const {width:w,height:h,data:d}=PNG.sync.read(bytes,{checkCRC:true});
 const samples:number[][]=[];
 for(let x=0;x<w;x+=4){samples.push([...d.subarray(x*4,x*4+3)],[...d.subarray(((h-1)*w+x)*4,((h-1)*w+x)*4+3)]);}
 for(let y=0;y<h;y+=4){samples.push([...d.subarray(y*w*4,y*w*4+3)],[...d.subarray((y*w+w-1)*4,(y*w+w-1)*4+3)]);}
 const paper=[0,1,2].map(k=>samples.map(s=>s[k]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
 const delta=(i:number)=>Math.max(...paper.map((c,k)=>Math.abs(c-d[i+k])));
 const uniform=samples.filter(s=>s.every((c,k)=>Math.abs(c-paper[k])<=18)).length/samples.length>=.85;
 let left=w,right=-1,top=h,bottom=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(d[i+3]!==255||delta(i)>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 const bounds=right<left?{left:0,top:0,width:w,height:h}:{left,top,width:right-left+1,height:bottom-top+1};
 return {paper,uniform,sourceBounds:bounds};
}
/** 호환용 원본 사본: 원본 픽셀과 bytes를 그대로 보존합니다. */
export function artworkCopy(bytes:Buffer):Buffer{return bytes;}
