import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {ResultVersionSchema,IdSchema,VersionSchema,SourceSchema,ClaimSchema,UtcSchema,canonicalJson,ExportEntrySchema,type BuildExport,type ExportEntry,type VerifiedAsset} from '../shared/포트.js';
import {appRoot,dataRoot,localBytes,safePath,publish,sha256,RenderFailure} from './파일경계.js';
import {verifiedPng,decodePng} from './이미지검사.js';
import {verifyZip} from './압축검사.js';
export const buildExport:BuildExport=async(raw,options={})=>{
 // 입력 객체를 공유하지 않는 불변 snapshot. 이후 현재 버전 재검사는 Store/서버 책임.
 let input=structuredClone(raw);const created:string[]=[];
 try{
  options.signal?.throwIfAborted();IdSchema.parse(input.projectId);IdSchema.parse(input.runId);VersionSchema.parse(input.attempt);
  if(input.result.finalApprovedVersion!==input.result.version)throw new RenderFailure('FINAL_NOT_APPROVED','현재 결과의 최종 승인이 필요합니다.',{...input,resultVersion:input.result.version});
  ResultVersionSchema.parse(input.result);
  // 저장 배열은 정렬 계약이 없습니다. 복사본만 정렬하고 아래에서 ID·개정·자산 연결을 그대로 검증합니다.
  input={...input,result:{...input.result,cards:[...input.result.cards].sort((a,b)=>a.order-b.order)},manifest:[...input.manifest].sort((a,b)=>a.order-b.order)};
  if(!input.result.cards.length||input.result.cards.length!==input.manifest.length||input.result.cards.length!==input.imageRecords.length)throw new RenderFailure('EXPORT_STALE','승인 manifest 수량이 일치하지 않습니다.',{...input,resultVersion:input.result.version});
  if(![7,30].includes(input.period.days)||input.period.to!==input.period.anchorAt||input.period.from>input.period.to)throw new Error('조사 기간 불일치');
  for(const t of [input.period.anchorAt,input.period.from,input.period.to])UtcSchema.parse(t);
  for(const source of input.sources)SourceSchema.parse(source);for(const claim of input.claims)ClaimSchema.parse(claim);
  const sources=new Set(input.sources.map(s=>s.sourceId));if(sources.size!==input.sources.length||input.claims.some(c=>c.sourceIds.some(id=>!sources.has(id))))throw new Error('출처 참조 오류');
  const contents:Record<string,Uint8Array>={};const pngItems:{name:string;bytes:Buffer;cardId:string;revision:number;width:number;height:number}[]=[];
  const seen=new Set<string>();const orders=new Set<number>();
  for(let i=0;i<input.result.cards.length;i++){
   options.signal?.throwIfAborted();const card=input.result.cards[i];const m=input.manifest[i];const a=m.asset;
   if(seen.has(card.cardId)||orders.has(card.order)||(i>0&&card.order<=input.result.cards[i-1].order)||card.sourceIds.some(id=>!sources.has(id))||m.cardId!==card.cardId||m.revision!==card.revision||m.order!==card.order||a.assetId!==card.previewAssetId||a.projectId!==input.projectId||a.kind!=='preview'||a.mimeType!=='image/png'||card.state!=='ready'||card.approvedRevision!==card.revision)throw new RenderFailure('EXPORT_STALE','현재 카드·개정·순서·자산 manifest 불일치',{...input,resultVersion:input.result.version});
   seen.add(card.cardId);orders.add(card.order);IdSchema.parse(a.assetId);
   const {bytes,decoded}=await verifiedPng(a.absolutePath,a.sha256);const height=input.result.size==='1080x1350'?1350:1080;
   if(a.bytes!==bytes.length||a.width!==1080||a.height!==height||decoded.width!==1080||decoded.height!==height)throw new Error('출력 PNG 픽셀/크기 불일치');
   const name=String(i+1).padStart(2,'0')+'.png';contents[name]=bytes;pngItems.push({name,bytes,cardId:card.cardId,revision:card.revision,width:1080,height});
   const records=input.imageRecords.filter(r=>r.cardId===card.cardId&&r.cardRevision===card.revision);if(records.length!==1)throw new Error('이미지 기록 개정 불일치');
   const r=records[0],image=r.image,p=r.provenance;
   if(image.assetId!==card.imageAssetId||image.projectId!==input.projectId||image.kind!=='image'||image.mimeType!=='image/png'||p.tool!=='agy'||p.illustrative!==true||!p.usageConditionsVerified||!p.usageConditions||!p.prompt||!p.toolVersion||canonicalJson(image.provenance)!==canonicalJson(p))throw new Error('이미지 생성/사용 조건 기록 불일치');
   UtcSchema.parse(p.generatedAt);const checked=await verifiedPng(image.absolutePath,image.sha256);
   if(checked.bytes.length!==image.bytes||checked.decoded.width!==image.width||checked.decoded.height!==image.height)throw new Error('원본 이미지 기록 크기 불일치');
  }
  const license=await localBytes(input.fontLicensePath,join(appRoot,'assets/render'),100000);
  if(!license.toString('utf8').includes('SIL OPEN FONT LICENSE'))throw new Error('글꼴 OFL 누락');
  const manifest=input.manifest.map(m=>({cardId:m.cardId,revision:m.revision,order:m.order,assetId:m.asset.assetId,sha256:m.asset.sha256}));
  contents['출처기록.json']=strToU8(JSON.stringify({projectId:input.projectId,resultVersion:input.result.version,period:input.period,sources:input.sources,claims:input.claims,review:{factsCheck:input.result.factsCheck,visualCheck:input.result.visualCheck,semanticReview:input.result.semanticReview??null,manualApproval:input.result.manualApproval??null},manifest,cards:input.result.cards.map(c=>({cardId:c.cardId,revision:c.revision,order:c.order,role:c.role,title:c.title,body:c.body,sourceIds:c.sourceIds}))},null,2));
  // 내부 절대경로는 배포 기록에 넣지 않고 원본 ID·크기·해시와 provenance를 보존.
  contents['이미지기록.json']=strToU8(JSON.stringify({projectId:input.projectId,resultVersion:input.result.version,imageRecords:input.imageRecords.map(r=>({cardId:r.cardId,cardRevision:r.cardRevision,image:{assetId:r.image.assetId,mimeType:r.image.mimeType,width:r.image.width,height:r.image.height,bytes:r.image.bytes,sha256:r.image.sha256},provenance:r.provenance}))},null,2));
  contents['글꼴라이선스.txt']=license;
  const zip=zipSync(contents,{level:0});const reopened=verifyZip(zip,Object.keys(contents));
  for(const item of pngItems){const p=decodePng(Buffer.from(reopened[item.name]));if(p.width!==item.width||p.height!==item.height)throw new Error('ZIP PNG 재디코딩 실패');}
  const dir=join(input.outputDir,`result-${input.result.version}-${randomUUID()}`);await safePath(join(dir,'check'),dataRoot,true);
  const entries:ExportEntry[]=[];const assets:VerifiedAsset[]=[];
  const add=async(name:string,bytes:Uint8Array,kind:'png'|'zip'|'records',mimeType:string,cardId:string|null=null,revision:number|null=null,width:number|null=null,height:number|null=null)=>{
   options.signal?.throwIfAborted();const id=randomUUID();const path=join(dir,name);await publish(path,bytes);created.push(path);
   const e=ExportEntrySchema.parse({exportId:id,projectId:input.projectId,resultVersion:input.result.version,kind,cardId,cardRevision:revision,filename:name,mimeType,bytes:bytes.length,sha256:sha256(bytes),downloadUrl:`/api/projects/${input.projectId}/exports/${id}/download`});entries.push(e);
   assets.push({assetId:id,projectId:input.projectId,runId:input.runId,attempt:input.attempt,kind:'export',absolutePath:path,mimeType,bytes:e.bytes,sha256:e.sha256,width,height,provenance:null});
  };
  for(const item of pngItems)await add(item.name,item.bytes,'png','image/png',item.cardId,item.revision,item.width,item.height);
  for(const name of ['출처기록.json','이미지기록.json','글꼴라이선스.txt'])await add(name,contents[name],'records',name.endsWith('.json')?'application/json':'text/plain');
  await add('카드뉴스.zip',zip,'zip','application/zip');options.signal?.throwIfAborted();
  return {projectId:input.projectId,resultVersion:input.result.version,entries,assets};
 }catch(e){for(const path of created)await unlink(path).catch(()=>{});if(e instanceof RenderFailure)throw e;throw new RenderFailure('EXPORT_FAILED',e instanceof Error?e.message:'출력 실패',{projectId:input.projectId,runId:input.runId,resultVersion:input.result.version});}
};
