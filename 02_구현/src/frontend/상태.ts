import {RequestSchemas,CreateProjectRequestSchema,canManuallyApprove,type FrontendClient,type ProjectSnapshot,type MutationName,type MutationTarget,type RequestByMutation,type ClientFailure,type EngineEvent} from '../shared/포트.js';
import {clientError} from './클라이언트.js';
export type ScreenState={snapshot:ProjectSnapshot|null;busy:boolean;loading:boolean;error:ClientFailure|null;pendingRetry:boolean;notice:string;events:EngineEvent[];lastSyncedAt:string|null;historyMore:boolean};
export type Send=(name:MutationName,fields?:Record<string,unknown>,cardId?:string)=>Promise<void>;
export function versionFor(p:ProjectSnapshot,name:MutationName,fields:Record<string,unknown>={},cardId?:string):number {
 if(name==='selection')return p.researchVersion;
 if(name==='answers')return p.question?.version??0;
 if(name==='approve')return fields.stage==='storyboard'?(p.storyboard?.version??0):(p.result?.version??0);
 if(name==='revisions')return fields.scope==='storyboard'?(p.storyboard?.version??0):(p.result?.version??0);
 if(name==='cardApprove')return p.result?.cards.find(c=>c.cardId===cardId)?.revision??0;
 return p.projectVersion;
}
export function semanticReviewGuidance(p:ProjectSnapshot):string|null {
 const report=p.result?.semanticReview;
 if(p.factIssues?.some(i=>i.code==='SEMANTIC_REVIEW_STALE'))return 'LLM 의미 검수 기록이 오래되었습니다. 현재 전체 주장·카드를 선택해 다시 검수하고 제안을 검토·적용하세요.';
 if(!report||p.factIssues?.some(i=>i.code==='SEMANTIC_REVIEW_REQUIRED'))return 'LLM 의미 검수 기록이 없습니다. 모든 주장·카드 선택 후 명시적으로 재검증을 요청하고 제안을 검토·적용하세요. 과거 검사 통과 표시만으로 새 최종 승인은 불가합니다.';
 if(report.verdict!=='supported'||p.factIssues?.some(i=>i.code==='SEMANTIC_REVIEW_UNSUPPORTED'))return 'LLM 의미 검수가 근거 지지를 확인하지 못했습니다. 아래 문제 위치·근거·수정 제안을 검토하고 원고·출처를 정정한 뒤 재검수하세요. 직접 확인란으로 통과시킬 수 없습니다.';
 return null;
}
export function canFinalApprove(p:ProjectSnapshot,manual=false):boolean {if(manual)return canManuallyApprove(p)&&p.allowedActions.includes('approve_final');const r=p.result;return !!r&&!semanticReviewGuidance(p)&&r.cards.length>0&&!p.activeRun&&r.cards.every(c=>c.state==='ready')&&r.factsCheck==='passed'&&r.visualCheck==='passed'&&p.allowedActions.includes('approve_final')&&r.finalApprovedVersion!==r.version;}
export function asFailure(e:unknown):ClientFailure {if(e&&typeof e==='object'&&'status' in e&&'error' in e)return e as ClientFailure;return clientError('CLIENT_INPUT_ERROR','입력 또는 응답을 확인해 주세요. 상태를 새로고침한 뒤 다시 제출하세요.');}
export function createController(client:FrontendClient,onProject?:(id:string)=>void){
 let state:ScreenState={snapshot:null,busy:false,loading:false,error:null,pendingRetry:false,notice:'',events:[],lastSyncedAt:null,historyMore:false};
 let projectId:string|null=null,generation=0,minVersion=0,seq=0,refreshing=false;
 let pending:(()=>Promise<void>)|null=null;
 const listeners=new Set<()=>void>();
 const update=(patch:Partial<ScreenState>)=>{state={...state,...patch};listeners.forEach(f=>f());};
 async function hydrate(id:string,g:number){
  for(let batch=0;batch<20;batch++){
   const after=seq,page=await client.getEvents(id,after);if(g!==generation)return;
   const merged=new Map(state.events.map(e=>[e.seq,e]));
   for(const e of page.events)if(e.projectId===id)merged.set(e.seq,e);
   seq=Math.max(seq,page.nextSeq);
   update({events:[...merged.values()].sort((a,b)=>a.seq-b.seq),historyMore:page.hasMore});
   if(!page.hasMore)return;
   if(seq<=after)throw clientError('CLIENT_PROTOCOL_ERROR','작업 이력의 다음 페이지를 확인할 수 없습니다. 상태를 새로고침하세요.');
  }
 }
 async function refresh(){if(!projectId)return;const id=projectId,g= generation;update({loading:true});
  try {const p=await client.getProject(id);if(g!==generation||p.projectId!==id)return;
   if(p.projectVersion>=minVersion&&p.projectVersion>=(state.snapshot?.projectVersion??0))update({snapshot:p,lastSyncedAt:new Date().toISOString(),notice:state.pendingRetry?'저장된 최신 상태를 조회했습니다. 이전 요청 결과는 미확정입니다. 같은 요청으로 확인하기 전에는 이동할 수 없습니다.':state.error?'저장된 최신 상태를 조회했습니다. 아래는 이전 요청 오류이며, 조회 실패를 뜻하지 않습니다.':p.lastRun?.status==='failed'?'':state.notice});
   try{await hydrate(id,g);}catch(e){if(g===generation)update({historyMore:true});throw e;}
  }finally{if(g===generation)update({loading:false});}
 }
 async function execute(operation:()=>Promise<void>){if(state.busy)return;const g=generation;pending=operation;update({busy:true,error:null,pendingRetry:false});
  try {await operation();if(g!==generation)return;pending=null;update({notice:state.snapshot?.lastRun?.status==='failed'?'':'요청을 접수했습니다. 서버 저장 상태로 확인합니다.'});}
  catch(e){if(g!==generation)return;const failure=asFailure(e);const replay=failure.error.details?.requestOutcome!=='rejected'&&(failure.error.details?.requestOutcome==='unknown'||failure.status===0||failure.status>=500);
   if(!replay)pending=null;
   update({error:failure,pendingRetry:replay});
   if(failure.status===409){try{await refresh();}catch{/* 원래 충돌 안내 유지 */}}
  }finally{if(g===generation)update({busy:false});}
 }
 async function open(id:string){if(state.busy||state.pendingRetry)return;const g=++generation;projectId=id;seq=0;minVersion=0;pending=null;update({snapshot:null,busy:false,error:null,notice:'',events:[],pendingRetry:false,lastSyncedAt:null,historyMore:false});try{await client.bootstrap();if(g===generation)await refresh();}catch(e){if(g===generation)update({error:asFailure(e),loading:false});}}
 const send:Send=async(name,fields={},cardId)=>{
  if(state.busy||state.pendingRetry||!state.snapshot)return;
  const p=state.snapshot;const target:MutationTarget={projectId:p.projectId,...(cardId?{cardId}:{}),...((p.activeRun??p.lastRun)?{runId:(p.activeRun??p.lastRun)!.runId}:{})};
  const input=RequestSchemas[name].safeParse({requestId:crypto.randomUUID(),...(name==='cancel'?{}:{version:versionFor(p,name,fields,cardId)}),...fields});
  if(!input.success){update({error:clientError('CLIENT_INPUT_ERROR','필수 입력, 선택 수, 글자 수를 확인해 주세요.')});return;}
  const g=generation;
  // closure가 payload/target/ID를 고정합니다. 네트워크 유실 후 재전송에 최신 version을 섞지 않습니다.
  await execute(async()=>{const receipt=await client.mutate(name,target,input.data as RequestByMutation[typeof name]);if(g!==generation)return;minVersion=Math.max(minVersion,receipt.projectVersion);await refresh();});
 };
 return {getState:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};},open,refresh,
  async create(topic:string,period:7|30,claudeModel:string|null=null){if(state.busy||state.pendingRetry)return;
   const input=CreateProjectRequestSchema.safeParse({topic,period,claudeModel,createRequestId:crypto.randomUUID()});if(!input.success){update({error:clientError('CLIENT_INPUT_ERROR','주제를 1~500자로 입력해 주세요.')});return;}
   await execute(async()=>{const receipt=await client.createProject(input.data);projectId=receipt.projectId;minVersion=receipt.projectVersion;onProject?.(projectId);await refresh();});
  },send,
  async retryPending(){if(pending)await execute(pending);},
  async refreshSafely(){const g=generation;try{await refresh();if(g===generation)update({notice:state.pendingRetry?'저장된 최신 상태를 조회했습니다. 이전 요청 결과는 미확정입니다. 같은 요청으로 확인하기 전에는 이동할 수 없습니다.':state.error?'저장된 최신 상태를 조회했습니다. 아래는 이전 요청 오류이며, 조회 실패를 뜻하지 않습니다.':'현재 서버 상태를 다시 확인했습니다.'});}catch(e){if(g===generation)update({error:asFailure(e)});}},
  async poll(){if(refreshing||state.busy||!projectId)return;refreshing=true;const g=generation,id=projectId;
   try {await refresh();if(g===generation)return state.historyMore;}
   finally{refreshing=false;}return false;
  },
  reset(){if(state.busy||state.pendingRetry)return;generation++;projectId=null;pending=null;minVersion=0;seq=0;update({snapshot:null,busy:false,loading:false,error:null,pendingRetry:false,events:[],notice:'',historyMore:false,lastSyncedAt:null});},
 };
}
export type Controller=ReturnType<typeof createController>;
