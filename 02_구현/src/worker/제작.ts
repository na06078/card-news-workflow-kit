import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type * as C from '../shared/포트.js';
import {workerError,normalizeError} from './실행단계.js';
import {checkStoredFacts} from './검수.js';
export type ExecutionTools={fence:()=>C.LeaseFence;guard:()=>Promise<void>;commit:(value:C.WorkerCommit)=>Promise<C.EngineEvent|null>;mark:(phase:string,state:C.InvocationMark['state'],cardId?:string|null,expectedPath?:string|null,sha256?:string|null)=>Promise<void>;wait:<T>(promise:Promise<T>)=>Promise<T>;agyStarted:()=>void;renderStarted:()=>void;signal:AbortSignal};
/** B1이 승인/CAS/manifest 보존을 다시 검증합니다. 여기서는 대상 카드만 외부 경계를 엽니다. */
export async function produce(options:C.WorkerOptions,job:C.ClaimedJob,t:ExecutionTools){
 let p=await options.store.getProject(job.fence.projectId);const board=p.storyboard;
 if(!board||board.approvedVersion!==board.version||!board.size)throw workerError('STAGE_CONFLICT',t.fence());
 let result:C.ResultVersion=p.result?structuredClone(p.result):{...(p.factReview?.state==='applied'&&p.factReview.proposal?.semanticReview?{semanticReview:structuredClone(p.factReview.proposal.semanticReview)}:{}),version:1,storyboardVersion:board.version,size:board.size,cards:board.cards.map(c=>({...c,revision:1,imageAssetId:null,previewAssetId:null,state:'pending',approvedRevision:null,error:null})),factsCheck:'pending',visualCheck:'pending',finalApprovedVersion:null};
 const targetIds=job.run.kind==='factApply'?job.snapshot.factReview?.proposal?.cards.map(c=>c.cardId)??[]:job.revision?.cardIds??result.cards.filter(c=>c.state!=='ready').map(c=>c.cardId);
 let failed=false;
 const progress=async(activity:C.ProgressActivity,message:string)=>{await t.guard();await options.store.appendEvent(t.fence(),{type:'progress',phase:activity.operation,message,activity,completed:result.cards.filter(c=>c.state==='ready').length,total:result.cards.length});};
 for(const id of targetIds){
  const card=result.cards.find(c=>c.cardId===id);if(!card)throw workerError('STAGE_CONFLICT',t.fence());if(card.state==='ready')continue;
  const assets:C.VerifiedAsset[]=[];let image:C.VerifiedAsset|undefined;
  await t.guard();
  try{
   await progress({provider:'app',operation:'planning',status:'started',cardId:id},'카드 제작 시작');
   if(card.imageAssetId)image=await options.store.getAsset(p.projectId,card.imageAssetId);
   else{
    if(job.run.kind==='factApply')throw workerError('ASSET_INVALID',t.fence());
    const dir=resolve(job.attemptDir,card.cardId,String(card.revision));await mkdir(dir,{recursive:true});
    await t.mark('image','prepared',id,resolve(dir,'image.png'));await t.guard();await t.mark('image','started',id,resolve(dir,'image.png'));t.agyStarted();
    await progress({provider:'agy',operation:'image',status:'started',cardId:id},'카드 그림 요청');
    const prompt=job.run.revisionProtocol===2&&job.revision?.scope==='image'?`${card.imagePlan}\n사용자가 명시한 이미지 수정 지시:\n${job.revision.instruction}`:card.imagePlan;
    const out=await t.wait(options.agy.generate({projectId:p.projectId,runId:job.run.runId,attempt:job.run.attempt,card,size:result.size,attemptDir:dir,prompt,expectedFilename:'image.png'},t.signal,async event=>{if(event.phase!=='image'&&event.phase!=='conversion')return;await progress({provider:event.phase==='image'?'agy':'app',operation:event.phase,status:event.status,cardId:id,...(event.phase==='image'?{tool:'generate_image'}:{})},event.message);}));
    await t.guard();await t.mark('image','output_observed',id,out.asset.absolutePath,out.asset.sha256);
    if(out.asset.projectId!==p.projectId||out.asset.runId!==job.run.runId||out.asset.attempt!==job.run.attempt||out.asset.kind!=='image')throw workerError('ASSET_INVALID',t.fence());
    image=out.asset;assets.push(image);card.imageAssetId=image.assetId;await t.mark('image','validated',id,image.absolutePath,image.sha256);
    await progress({provider:'agy',operation:'image',status:'completed',cardId:id},'카드 그림 파일 확인 완료');
   }
   const outputPath=resolve(job.attemptDir,card.cardId,`${card.revision}-preview.png`);
   await mkdir(resolve(outputPath,'..'),{recursive:true});await t.mark('render','prepared',id,outputPath);await t.guard();await t.mark('render','started',id,outputPath);t.renderStarted();
   await progress({provider:'app',operation:'render',status:'started',cardId:id},'한글 카드 렌더 시작');
   const rendered=await t.wait(options.renderCard({projectId:p.projectId,runId:job.run.runId,attempt:job.run.attempt,resultVersion:result.version,card,size:result.size,image:{assetId:image.assetId,absolutePath:image.absolutePath,sha256:image.sha256},researchAt:p.period.anchorAt,sourceLabels:p.sources.filter(s=>card.sourceIds.includes(s.sourceId)).map(s=>({sourceId:s.sourceId,label:s.publisher??new URL(s.url).hostname,url:s.url})),font:options.font,templateVersion:'cn-basic-2',outputPath},{signal:t.signal}));
   await t.guard();await t.mark('render','output_observed',id,rendered.path,rendered.sha256);
   if(rendered.projectId!==p.projectId||rendered.cardId!==id||rendered.cardRevision!==card.revision||rendered.resultVersion!==result.version||rendered.path!==outputPath||rendered.width!==1080||rendered.height!==(result.size==='1080x1080'?1080:1350)||!rendered.checks.fontLoaded||!rendered.checks.imageDecoded||rendered.checks.overflow)throw workerError('RENDER_FAILED',t.fence());
   const preview:C.VerifiedAsset={assetId:randomUUID(),projectId:p.projectId,runId:job.run.runId,attempt:job.run.attempt,kind:'preview',absolutePath:rendered.path,mimeType:rendered.mimeType,bytes:rendered.bytes,sha256:rendered.sha256,width:rendered.width,height:rendered.height,provenance:null};assets.push(preview);card.previewAssetId=preview.assetId;card.state='ready';card.error=null;await t.mark('render','validated',id,preview.absolutePath,preview.sha256);
  }catch(error){await t.guard();failed=true;card.state='failed';card.error=normalizeError(error,t.fence(),image?'RENDER_FAILED':'IMAGE_GENERATION_FAILED');}
  // 저장된 provenance/렌더 검사만. 사람 가독성·독립 원문 검증을 대신하지 않음.
  result.factsCheck=checkStoredFacts(p,result);
  result.visualCheck=result.cards.every(c=>c.state==='ready')?'passed':'pending';
  await progress({provider:image?'app':'agy',operation:image?'render':'image',status:card.state==='ready'?'completed':'failed',cardId:id},card.state==='ready'?'카드 렌더 검증 완료':'카드 제작 실패');
  await t.commit({type:'production',result,assets});
  p=await options.store.getProject(p.projectId);result=structuredClone(p.result!);
 }
 if(failed||result.cards.some(c=>c.state!=='ready'))throw result.cards.find(c=>c.state==='failed')?.error??workerError('IMAGE_GENERATION_FAILED',t.fence());
}
export async function exportResult(options:C.WorkerOptions,job:C.ClaimedJob,t:ExecutionTools){
 const p=await options.store.getProject(job.fence.projectId),r=p.result;
 if(!r||r.finalApprovedVersion!==r.version||!r.cards.every(c=>c.state==='ready'))throw workerError('FINAL_NOT_APPROVED',t.fence());
 const manifest=await Promise.all(r.cards.map(async c=>({cardId:c.cardId,revision:c.revision,order:c.order,asset:await options.store.getAsset(p.projectId,c.previewAssetId!)})));
 const imageRecords=await Promise.all(r.cards.map(async c=>{const image=await options.store.getAsset(p.projectId,c.imageAssetId!);if(!image.provenance)throw workerError('ASSET_INVALID',t.fence());return {cardId:c.cardId,cardRevision:c.revision,image,provenance:image.provenance};}));
 const progress=async(status:C.ProgressActivity['status'],message:string)=>{await t.guard();await options.store.appendEvent(t.fence(),{type:'progress',phase:'export',message,completed:r.cards.length,total:r.cards.length,activity:{provider:'app',operation:'export',status}});};
 await t.mark('export','prepared');await t.guard();await t.mark('export','started');await progress('started','PNG·ZIP 내보내기 시작');
 try{
 const output=await t.wait(options.buildExport({projectId:p.projectId,runId:job.run.runId,attempt:job.run.attempt,result:r,manifest,period:p.period,sources:p.sources,claims:p.claims,imageRecords,fontLicensePath:options.fontLicensePath,outputDir:resolve(job.attemptDir,'exports')},{signal:t.signal}));
 await t.guard();await t.mark('export','output_observed');
 if(output.projectId!==p.projectId||output.resultVersion!==r.version)throw workerError('EXPORT_STALE',t.fence());
 await t.mark('export','validated');await progress('completed','내보내기 파일 검증 완료');await t.commit({type:'exports',resultVersion:r.version,entries:output.entries,assets:output.assets});
 }catch(error){await progress('failed','내보내기 실패');throw normalizeError(error,t.fence(),'EXPORT_FAILED');}
}
