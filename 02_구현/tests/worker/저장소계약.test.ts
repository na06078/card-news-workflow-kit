import {test,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ClaimedJob,VerifiedAsset,AppError} from '../../src/shared/포트.js';

// W1의 실제 B1 포트 선행 계약 검사. 외부 공급자 호출/다른 카드 데이터 사용 없음.
test('실패한 production 카드 재시도는 새 image 자산을 채택할 수 있어야 한다',async()=>{
 const dataDir=resolve('실행데이터/W1',randomUUID());
 const s=await createStore({dataDir,dbPath:resolve(dataDir,'검사.sqlite'),dataMode:'mock'});
 try{
  const created=await s.createProject({topic:'W1 재시도 계약 검사',createRequestId:randomUUID()});
  if(!('data' in created.body))throw Error('create');
  const target={projectId:created.body.data.projectId};
  const claim=async()=>{
   const j=await s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});
   if(!j)throw Error('claim');return j;
  };
  const asset=async(j:ClaimedJob,kind:'image'|'preview'):Promise<VerifiedAsset>=>{
   const bytes=PNG.sync.write(new PNG({width:1080,height:1080}));
   const absolutePath=resolve(j.attemptDir,`${kind}.png`);await writeFile(absolutePath,bytes);
   return {assetId:randomUUID(),projectId:target.projectId,runId:j.run.runId,attempt:j.run.attempt,kind,absolutePath,mimeType:'image/png',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:1080,height:1080,provenance:kind==='image'?{tool:'agy',toolVersion:'W1_SYNTHETIC_ONLY',generatedAt:new Date().toISOString(),prompt:'로컬 계약 검사 합성 PNG',illustrative:true,usageConditions:'테스트',usageConditionsVerified:true,conversationId:null}:null};
  };
  const fixture=createMockSnapshot('selection');
  await s.mutate('research',target,{version:1,requestId:randomUUID()});let j=await claim();
  await s.commit(j.fence,{type:'content',content:{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null}});
  await s.mutate('selection',target,{version:1,requestId:randomUUID(),candidateIds:fixture.candidates.map(c=>c.candidateId)});j=await claim();
  const storyboard=createMockSnapshot('storyboard').storyboard!;
  await s.commit(j.fence,{type:'content',content:{kind:'storyboard',storyboard,sources:fixture.sources,claims:[]}});
  await s.mutate('approve',target,{stage:'storyboard',version:1,requestId:randomUUID()});j=await claim();
  const error:AppError={code:'IMAGE_GENERATION_FAILED',message:'주입한 실패',retryable:true,nextActions:['retry'],projectId:target.projectId,runId:j.run.runId,currentVersion:null,details:{}};
  const failed={version:1,storyboardVersion:1,size:'1080x1080' as const,cards:storyboard.cards.map(c=>({...c,revision:1,imageAssetId:null,previewAssetId:null,state:'failed' as const,approvedRevision:null,error})),factsCheck:'pending' as const,visualCheck:'pending' as const,finalApprovedVersion:null};
  const partial=await s.commit(j.fence,{type:'production',result:failed,assets:[]});
  await s.commit(partial.fence,{type:'failure',error,externalOutcome:'known',retryAllowed:true});
  const p=await s.getProject(target.projectId);
  expect((await s.mutate('retry',{...target,runId:j.run.runId},{version:p.projectVersion,requestId:randomUUID()})).status).toBe(202);
  j=await claim();const image=await asset(j,'image'),preview=await asset(j,'preview');
  const ready={...failed,cards:failed.cards.map(c=>({...c,state:'ready' as const,error:null,imageAssetId:image.assetId,previewAssetId:preview.assetId})),factsCheck:'passed' as const,visualCheck:'passed' as const};
  await expect(s.commit(j.fence,{type:'production',result:ready,assets:[image,preview]})).resolves.toHaveProperty('fence');
  expect((await s.getProject(target.projectId)).result?.cards[0]?.imageAssetId).toBe(image.assetId);
 }finally{await s.close();}
});
