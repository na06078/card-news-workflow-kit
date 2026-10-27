/** 원본 전체를 균일 배율로 그립니다. 캔버스 밖으로 나가는 것은 추정 그림 경계 밖의 종이 여백뿐입니다. */
export async function placeArtwork(){
 const card=document.querySelector<HTMLElement>('#card')!,image=document.querySelector<HTMLImageElement>('#background')!;
 if(image.dataset.artwork)return true;
 await image.decode();
 const geometry=JSON.parse(image.dataset.geometry??'null');
 if(!geometry?.uniform)throw new Error('BACKGROUND_COMPOSITION_UNCERTAIN');
 const b=geometry.sourceBounds as {left:number;top:number;width:number;height:number};
 const width=card.clientWidth,height=card.clientHeight,pad=12;
 const scale=Math.min((width-2*pad)/b.width,(height*.6-2*pad)/b.height);
 const left=(width-b.width*scale)/2,top=height*.3-b.height*scale/2;
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle=`rgb(${geometry.paper.join(',')})`;ctx.fillRect(0,0,width,height);
 ctx.drawImage(image,left-b.left*scale,top-b.top*scale,image.naturalWidth*scale,image.naturalHeight*scale);
 image.src=canvas.toDataURL('image/png');await image.decode();
 image.dataset.artwork=JSON.stringify({left,top,width:b.width*scale,height:b.height*scale,centerYRatio:.3,scale,sourceBounds:b});
 return true;
}
