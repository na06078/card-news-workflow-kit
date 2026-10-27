import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {startLocal} from '../I2/호스트.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../../../src/providers/클로드.js';
import {semanticInputHash} from '../../../../src/providers/검수내용.js';
import type * as C from '../../../../src/shared/포트.js';
export const beforeText='합성 지표는 20이다.',afterText='합성 지표는 10이다.',healthyText='합성 기록의 대상은 연습용이다.';
export type ReceiptMode='opened'|'403'|'empty'|'model-tag-only';
export const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** SDK 전송만 fake. provider 검증/bridge/Store는 실제이며 계정·native 호출은 조립하지 않습니다. */
export async function startFacts(mode:ReceiptMode='opened',semanticVerdict:C.SemanticReviewDecision['verdict']='supported'){
 const counters={adapter:0,fakeSdk:0,semantic:0,realClaude:0,realAgy:0,auth:0,native:0};
 const reviewRequests:{selection:C.ReviewSelection;input:C.SemanticReviewInput}[]=[];
 const createSemanticReviewer:C.CreateSemanticReviewer=options=>{
  let runId:string|null=null;
  return {async review(context,input){runId=context.runId;counters.semantic++;reviewRequests.push({selection:structuredClone(options.selection),input:structuredClone(input)});
   await options.onProgress?.({provider:options.selection.provider,status:'started',...(options.selection.model?{actualModel:options.selection.model}:{})});
   const result:C.SemanticReviewReport={reviewer:options.selection,actualModel:options.selection.model,reviewedAt:new Date().toISOString(),inputHash:semanticInputHash(input),verdict:semanticVerdict,reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:semanticVerdict==='supported'?[]:[{cardId:input.cards[0]!.cardId,claimIndex:input.claims[0]?.claimIndex??null,sourceIds:input.sources.map(s=>s.sourceId),message:'합성 검수 대역: 근거와 발행 문장의 의미 불일치',suggestion:'근거에 맞게 수정하고 다시 검수하세요.'}]};
   await options.onProgress?.({provider:options.selection.provider,status:'completed'});return result;
  },async cancel(id){return {runId:id,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_SYNTHETIC_REVIEW_NO_PROCESS',children:[]};},async dispose(){return [{runId,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'EXPLICIT_SYNTHETIC_REVIEW_NO_PROCESS',children:[]}];}};
 };
 const createClaudeAdapter:C.CreateClaudeAdapter=options=>{
  counters.adapter++;
  return createOfflineClaudeAdapter(options,(({prompt,options:sdkOptions})=>{
   counters.fakeSdk++;
   return Object.assign((async function*(){
    let input='';if(typeof prompt==='string')input=prompt;else for await(const m of prompt)input+=m.message.content;
    // Input snapshot is obtained by the wrapper below, not inferred from model prompt text.
    const p=current!;if(!p?.factReview)throw Error('TEST_FACT_SNAPSHOT_REQUIRED');
    const sourceId=randomUUID(),url='https://example.org/synthetic-observed/'+sourceId;
    const source:C.Source={...p.sources.find(s=>s.candidateId===p.selectedCandidateIds[0])!,sourceId,url,title:'새 합성 관측 자료',publisher:'합성기관',primary:true,access:'opened',accessedAt:new Date().toISOString(),evidence:afterText,limitations:['SYNTHETIC: 실제 원문/AI 진실성 검증 아님']};
    const card=p.result?.cards.find(c=>c.cardId===p.factReview!.cardIds[0])??p.storyboard!.cards.find(c=>c.cardId===p.factReview!.cardIds[0])!;
    const draft:C.FactProposalDraft={kind:'factReview',sources:[source],findings:[{claimIndex:0,cardIds:[card.cardId],classification:'factual_error',reason:'합성 처리 결과의 실제 문자열 인용으로 정정',afterClaim:{...p.claims[0]!,text:afterText,sourceIds:[sourceId],kind:'verified'},comparisons:[]}],cards:[{cardId:card.cardId,title:'합성 수치 정정',body:afterText,sourceIds:[sourceId]}]};
    const session=randomUUID();
    if(!sdkOptions?.cwd)throw Error('TEST_QUERY_CWD_REQUIRED');
    yield {type:'system',subtype:'init',session_id:session,cwd:sdkOptions.cwd,tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'} as never;
    if(mode!=='model-tag-only'){
     const output={url,code:mode==='403'?403:200,codeText:mode==='403'?'Forbidden':'OK',bytes:mode==='empty'?0:Buffer.byteLength(afterText),result:mode==='403'?'Forbidden':mode==='empty'?'':afterText,durationMs:1};
     yield {type:'assistant',session_id:session,message:{content:[{type:'tool_use',id:'observed-fetch',name:'WebFetch',input:{url}}]}} as never;
     yield {type:'user',session_id:session,message:{content:[{type:'tool_result',tool_use_id:'observed-fetch',is_error:false,content:JSON.stringify(output)}]},tool_use_result:output} as never;
    }
    if(JSON.stringify(sdkOptions?.tools)!==JSON.stringify(['WebSearch','WebFetch']))throw Error('TEST_UNEXPECTED_TOOLS');
    yield {type:'result',subtype:'success',session_id:session,is_error:false,permission_denials:[],structured_output:draft} as never;
   })(),{close(){}});
  }) satisfies QueryFactory);
 };
 let current:C.ProjectSnapshot|null=null;
 const h=await startLocal({dataRoot:resolve('실행데이터/검수모델전환/통합'),createSemanticReviewer,createClaudeAdapter:options=>{
  const real=createClaudeAdapter(options);return {...real,async *start(context,input){
   if(context.phase!=='factReview')throw Error('TEST_UNEXPECTED_CLAUDE_PHASE');
   current=(input as {snapshot:C.ProjectSnapshot}).snapshot;yield* real.start(context,input);
  }};
 }});
 h.record('boundary',{mocked:['initial research/storyboard legal Store commits','SDK messages','semantic reviewer decision','agy image-only child transport'],actual:['Express','SQLite','FrontendClient','worker','offline Claude adapter validation','Chromium render','buildExport','HTTP bytes'],realProviderCalls:counters});
 console.log('FACT_ARTIFACT_DIR='+h.data);
 return Object.assign(h,{counters,reviewRequests});
}
export type FactHost=Awaited<ReturnType<typeof startFacts>>;
/** 정상 enqueue/lease/fence/commit만 사용합니다. SQL·검사 태그·승인을 직접 덮지 않습니다. */
export async function prepareFacts(h:FactHost,production=true){
 const a=await h.api(),created=await a.client.createProject({topic:'[합성] 사실 차단 복구 독립 통합',createRequestId:randomUUID()}),id=created.projectId;
 await a.client.mutate('research',{projectId:id},{version:1,requestId:randomUUID()});
 const research=await h.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!research||research.run.projectId!==id)throw Error('TEST_RESEARCH_CLAIM');
 const candidateId=randomUUID(),sids=[randomUUID(),randomUUID()];
 const sources:C.Source[]=sids.map((sourceId,n)=>({sourceId,candidateId,url:'https://example.org/synthetic-initial/'+sourceId,title:n?'합성 정상 근거':'합성 기존 상충 근거',publisher:'합성기관',publishedDate:null,eventDate:null,accessedAt:new Date().toISOString(),primary:true,access:'opened',evidence:n?healthyText:beforeText,limitations:['SYNTHETIC 초기 자료; 실제 검색 아님']}));
 const candidate:C.Candidate={candidateId,researchVersion:1,eventKey:'SYNTHETIC-FACT',category:'합성',title:'합성 연습 자료',summary:'외부 사실 아님',publishedDate:null,eventDate:null,sourceIds:sids,selectionReason:'통합 시험',uncertainties:[]};
 await h.store.commit(research.fence,{type:'content',content:{kind:'candidates',researchVersion:1,candidates:[candidate],sources,shortageReason:null}});
 await a.client.mutate('selection',{projectId:id},{version:1,candidateIds:[candidateId],requestId:randomUUID()});
 const editorial=await h.store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!editorial||editorial.run.projectId!==id)throw Error('TEST_EDITORIAL_CLAIM');
 const claims:C.Claim[]=[{text:beforeText,sourceIds:[sids[0]!],kind:'conflicting',availability:'released',conditions:['합성 상충 항목']},{text:healthyText,sourceIds:[sids[1]!],kind:'verified',availability:'released',conditions:[]}];
 const storyboard:C.Storyboard={version:1,audience:'연습 사용자',rationale:'독립 경계 검사',format:'합성 2장',hooks:['실제 사실 아님','합성 자료의 수정 경계 확인'],size:'1080x1080',approvedVersion:null,cards:claims.map((c,n)=>({cardId:randomUUID(),order:n+1,role:n?'closing':'cover',title:n?'유지할 정상 카드':'정정 대상 카드',body:c.text,sourceIds:c.sourceIds,imagePlan:'시험용 합성 단색 그림'}))};
 await h.store.commit(editorial.fence,{type:'content',content:{kind:'storyboard',storyboard,sources,claims}});
 if(production){await a.client.mutate('approve',{projectId:id},{stage:'storyboard',version:1,requestId:randomUUID()});await h.worker.tick();}
 return {a,id,p:await a.client.getProject(id)};
}
export async function submitReview(h:FactHost,a:Awaited<ReturnType<FactHost['api']>>,p:C.ProjectSnapshot){
 const input={requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[(p.result?.cards??p.storyboard!.cards)[0]!.cardId]};
 const response=await a.post(`/api/projects/${p.projectId}/factReview`,input);
 await h.save('재검증접수.json',{input,response});
 if(response.status!==202)throw Error(`FACT_REVIEW_HTTP_NOT_READY: expected 202, got ${response.status} ${JSON.stringify(response.body)}`);
 return {input,response};
}
