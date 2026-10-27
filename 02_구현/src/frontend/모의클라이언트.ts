/** 명시 개발용 메모리 adapter. 실조사/생성/파일 다운로드 증거가 아닙니다. */
import {createMockSnapshot,type MockStage} from '../shared/모의자료.js';
import {ProjectSnapshotSchema,RequestSchemas,validateAnswer,canonicalJson,canManuallyApprove,type FrontendClient,type ProjectSnapshot,type MutationName,type RequestByMutation,type ResponseByMutation} from '../shared/포트.js';
import {clientError} from './클라이언트.js';
import {versionFor} from './상태.js';
export function createMockClient(initial:MockStage|ProjectSnapshot='topic'):FrontendClient {
 let p=structuredClone(typeof initial==='string'?createMockSnapshot(initial):ProjectSnapshotSchema.parse(initial));
 p.dataMode='mock';
 const receipts=new Map<string,{identity:string;data:unknown}>();
 const copy=()=>ProjectSnapshotSchema.parse(structuredClone(p));
 const fail=(code:string,message:string)=>{const f=clientError(code,message);f.status=409;f.error.details.requestOutcome='rejected';throw f;};
 return {bootstrap:async()=>({csrfToken:'mock-only',contractVersion:'CN-1'}),
  async createProject(input){p=createMockSnapshot();p.topic='[모의] '+input.topic;p.period.days=input.period??7;return {projectId:p.projectId,projectVersion:1};},
  async getProject(){return copy();},async getRun(){return structuredClone((p.activeRun??p.lastRun)!);},
  async getEvents(){return {events:[],nextSeq:0,hasMore:false};},
  async downloadExport(){return fail('EXPORT_FAILED','모의 모드는 실제 파일을 생성하거나 내려받지 않습니다.');},
  async getExports(){return {resultVersion:p.result?.version??1,entries:[],exportRun:null};},
  async mutate<K extends MutationName>(name:K,target:Parameters<FrontendClient['mutate']>[1],input:RequestByMutation[K]):Promise<ResponseByMutation[K]>{
   const r=RequestSchemas[name].parse(input);const key=r.requestId,identity=canonicalJson({name,target,input:r});const saved=receipts.get(key);
   if(saved){if(saved.identity!==identity)fail('REQUEST_ID_CONFLICT','같은 ID의 입력이 다릅니다.');return structuredClone(saved.data) as ResponseByMutation[K];}
   if('version' in r&&r.version!==versionFor(p,name,r as unknown as Record<string,unknown>,target.cardId))fail('VERSION_CONFLICT','모의 원장을 다시 불러오세요.');
   if(target.projectId!==p.projectId)fail('NOT_FOUND','모의 프로젝트가 없습니다.');
   const previous=p;const version=p.projectVersion+1;
   if(name==='factReview'){
    const req=input as RequestByMutation['factReview'],units=p.result?.cards??p.storyboard?.cards??[];
    if(p.activeRun||!p.allowedActions.includes('reverify_facts'))fail('STAGE_CONFLICT','현재 모의 상태에서 재검증할 수 없습니다.');
    if(req.claimIndices.some(i=>!p.claims[i])||req.cardIds.some(id=>!units.some(c=>c.cardId===id)))fail('FACT_SCOPE_INVALID','주장·카드 범위를 확인하세요.');
    const content=canonicalJson({storyboard:p.storyboard,result:p.result,claims:p.claims,sources:p.sources,claimIndices:req.claimIndices,cardIds:req.cardIds});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result?.version??null,contentHash:hash,claimIndices:req.claimIndices,cardIds:req.cardIds,state:'ready',readyVersion:version,proposal:{sources:[],observations:[],cards:[],beforeClaims:req.claimIndices.map(claimIndex=>({claimIndex,claim:structuredClone(p.claims[claimIndex]!)})),beforeCards:units.filter(c=>req.cardIds.includes(c.cardId)).map(c=>({cardId:c.cardId,title:c.title,body:c.body,sourceIds:c.sourceIds})),findings:req.claimIndices.map(claimIndex=>({claimIndex,cardIds:req.cardIds,classification:'unverifiable',reason:'모의 검토: 실제 원문 접근·사실 검증을 실행하지 않아 확인 불가입니다.',afterClaim:{...structuredClone(p.claims[claimIndex]!),kind:'uncertain'},comparisons:[]}))}};
    p.factIssues=req.claimIndices.map(claimIndex=>({code:'MOCK_UNVERIFIED',message:'모의 검토는 근거 확인을 대신하지 않습니다.',claimIndex,cardIds:req.cardIds,sourceIds:p.claims[claimIndex]!.sourceIds}));
    p.allowedActions=p.allowedActions.filter(a=>a!=='apply_fact_proposal'&&a!=='approve_storyboard'&&(a!=='approve_final'||canManuallyApprove(p)));
   }
   if(name==='factApply'){
    const req=input as RequestByMutation['factApply'],review=p.factReview;
    if(!review||review.runId!==req.reviewRunId||review.state!=='ready'||review.readyVersion!==p.projectVersion)fail('FACT_PROPOSAL_STALE','현재 모의 제안이 아닙니다.');
    if(!review?.proposal?.cards.length)fail('FACT_SCOPE_INVALID','모의 검토에는 실제 원고 수정안이 없습니다. 확인 불가는 해소되지 않습니다.');
    fail('FACT_REVIEW_FAILED','모의 모드는 실제 이미지 재사용 렌더를 실행하지 않습니다. 적용 성공으로 표시하지 않습니다.');
   }
   if(name==='rebuildExports')fail('EXPORT_FAILED','모의 모드에서는 실제 파일을 생성하지 않습니다. 현재 승인은 유지됩니다.');

   if(name==='research')p={...createMockSnapshot('selection'),topic:previous.topic,period:previous.period};
   if(name==='selection') {p={...createMockSnapshot('question'),topic:previous.topic,period:previous.period};p.selectedCandidateIds=(input as RequestByMutation['selection']).candidateIds;}
   if(name==='answers') {
    if(!p.question)fail('QUESTION_STALE','열린 질문이 없습니다.');
    const req=input as RequestByMutation['answers'];
    if(p.question!.kind!=='editorial'&&req.answer.some(a=>a.text!==null))fail('VALIDATION_ERROR','앱 소유 고정 질문은 선택지로만 답변하세요.');
    const answer=validateAnswer(p.question,input);
    const size=p.question?.kind==='output_size'?(answer.answer[0]?.optionIds[0]??answer.answer[0]?.text):null;
    p={...createMockSnapshot('storyboard'),topic:previous.topic,period:previous.period};
    if(size==='1080x1080'||size==='1080x1350')p.storyboard!.size=size;
    if(previous.question?.kind==='output_size')p.storyboard!.version=(previous.storyboard?.version??1)+1;
   }
   if(name==='approve') {
    const req=input as RequestByMutation['approve'],stage=req.stage,manual=stage==='final'&&req.acknowledgeWarnings===true;
    if(p.activeRun||(!manual&&!!p.factIssues?.length)||!p.allowedActions.includes(stage==='storyboard'?'approve_storyboard':'approve_final'))fail('STAGE_CONFLICT','현재 모의 상태에서는 승인할 수 없습니다. 허용 동작을 확인하세요.');
    if(stage==='final'&&(manual?!canManuallyApprove(p):(!p.result||p.result.cards.some(c=>c.state!=='ready')||p.result.factsCheck!=='passed'||p.result.visualCheck!=='passed')))fail('STAGE_CONFLICT','현재 모의 결과의 승인 준비 조건을 확인하세요.');
    if(manual){
     // 명시 모의 adapter 안에서만 브라우저 WebCrypto로 동일 콘텐츠 입력을 결합합니다. 실제 저장·검수·파일 생성 증거가 아닙니다.
     const cards=[...p.result!.cards].sort((a,b)=>a.order-b.order).map(({cardId,title,body,sourceIds})=>({cardId,title,body,sourceIds:[...sourceIds]}));
     const claims=p.claims.map((claim,claimIndex)=>({claimIndex,claim:structuredClone(claim)})),referenced=new Set([...cards.flatMap(c=>c.sourceIds),...claims.flatMap(c=>c.claim.sourceIds)]);
     const sources=[...new Map(p.sources.map(s=>[s.sourceId,s])).values()].filter(s=>referenced.has(s.sourceId)).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
     const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson({projectId:p.projectId,cards,claims,sources})));
     p.result!.manualApproval={resultVersion:p.result!.version,approvedAt:new Date().toISOString(),contentHash:Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join(''),warningsAcknowledged:true};
    }

    if(stage==='storyboard'){
     if(!p.storyboard?.size)fail('STAGE_CONFLICT','출력 크기 답변이 필요합니다.');
     p={...createMockSnapshot('review'),topic:previous.topic,period:previous.period};p.storyboard=structuredClone(previous.storyboard);p.storyboard!.approvedVersion=p.storyboard!.version;p.result!.size=p.storyboard!.size!;p.result!.storyboardVersion=p.storyboard!.version;
    }else{if(!p.result)fail('STAGE_CONFLICT','결과가 없습니다.');p.result!.finalApprovedVersion=p.result!.version;p.result!.cards.forEach(c=>c.approvedRevision=c.revision);p.stage='export';p.status='approved';p.allowedActions=['revise'];p.exports=[];}
   }
   if(name==='cardApprove'){const card=p.result?.cards.find(c=>c.cardId===target.cardId);if(!card||card.state!=='ready')fail('STAGE_CONFLICT','준비된 카드만 승인됩니다.');card!.approvedRevision=card!.revision;}
   if(name==='revisions'){
    const req=input as RequestByMutation['revisions'];
    const units=req.scope==='storyboard'?p.storyboard?.cards:p.result?.cards;
    if(p.activeRun||!p.allowedActions.includes('revise')||!units||req.cardIds.some(id=>!units.some(c=>c.cardId===id)))fail('STAGE_CONFLICT','현재 수정할 수 있는 카드 범위가 아닙니다.');
    if((p.stage==='production'||p.status==='error')&&(req.scope!=='text'&&req.scope!=='layout'||req.cardIds.some(id=>!p.result?.cards.some(c=>c.cardId===id&&c.state==='failed'))))fail('STAGE_CONFLICT','제작 실패 중에는 실패 카드의 텍스트·배치만 수정할 수 있습니다.');

    if(req.scope==='storyboard'){p.storyboard!.version++;p.storyboard!.approvedVersion=null;p.storyboard!.rationale=req.instruction;}
    else{const result=p.result!;result.version++;result.finalApprovedVersion=null;delete result.manualApproval;p.stage='review';p.exports=[];p.allowedActions=['approve_final','revise'];
     result.cards.filter(c=>req.cardIds.includes(c.cardId)).forEach(c=>{c.revision++;c.approvedRevision=null;if(req.scope==='text'){try{const text=JSON.parse(req.instruction) as {title:string;body:string};c.title=text.title;c.body=text.body;}catch{c.body=req.instruction;}}});}
   }
   if(name==='cancel'){p.lastRun=p.activeRun?{...p.activeRun,status:'canceled'}:p.lastRun;p.activeRun=null;p.status='canceled';p.allowedActions=['retry'];}
   if(name==='retry'){p.status='ready';p.activeRun=null;p.allowedActions=p.result?['approve_final','revise']:['select'];}
   p.projectVersion=version;copy();
   const receipt={projectId:p.projectId,projectVersion:version,runId:p.activeRun?.runId??null,status:p.activeRun?.status??null,accepted:true as const};
   const data=name==='cardApprove'?{projectId:p.projectId,projectVersion:version,cardId:target.cardId!,approvedRevision:p.result!.cards.find(c=>c.cardId===target.cardId)!.revision}:name==='selection'?{...receipt,selectedCandidateIds:p.selectedCandidateIds}:name==='answers'?{...receipt,questionId:(input as RequestByMutation['answers']).questionId,questionVersion:(input as RequestByMutation['answers']).version}:name==='approve'&&(input as RequestByMutation['approve']).stage==='final'?{...receipt,finalApprovedVersion:p.result!.version}:receipt;
   receipts.set(key,{identity,data:structuredClone(data)});return data as ResponseByMutation[K];
  }
 };
}
