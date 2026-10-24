/** 명시 개발용 메모리 adapter. 실조사/생성/파일 다운로드 증거가 아닙니다. */
import {createMockSnapshot,type MockStage} from '../shared/모의자료.js';
import {ProjectSnapshotSchema,RequestSchemas,validateAnswer,canonicalJson,type FrontendClient,type ProjectSnapshot,type MutationName,type RequestByMutation,type ResponseByMutation} from '../shared/포트.js';
import {clientError} from './클라이언트.js';
import {versionFor} from './상태.js';
export function createMockClient(initial:MockStage|ProjectSnapshot='topic'):FrontendClient {
 let p=structuredClone(typeof initial==='string'?createMockSnapshot(initial):ProjectSnapshotSchema.parse(initial));
 const receipts=new Map<string,{identity:string;data:unknown}>();
 const copy=()=>ProjectSnapshotSchema.parse(structuredClone(p));
 const fail=(code:string,message:string)=>{const f=clientError(code,message);f.status=409;throw f;};
 return {bootstrap:async()=>({csrfToken:'mock-only',contractVersion:'CN-1'}),
  async createProject(input){p=createMockSnapshot();p.topic='[모의] '+input.topic;p.period.days=input.period??7;return {projectId:p.projectId,projectVersion:1};},
  async getProject(){return copy();},async getRun(){return structuredClone((p.activeRun??p.lastRun)!);},
  async getEvents(){return {events:[],nextSeq:0,hasMore:false};},
  async getExports(){return {resultVersion:p.result?.version??1,entries:[],exportRun:null};},
  async mutate<K extends MutationName>(name:K,target:Parameters<FrontendClient['mutate']>[1],input:RequestByMutation[K]):Promise<ResponseByMutation[K]>{
   const r=RequestSchemas[name].parse(input);const key=r.requestId,identity=canonicalJson({name,target,input:r});const saved=receipts.get(key);
   if(saved){if(saved.identity!==identity)fail('REQUEST_ID_CONFLICT','같은 ID의 입력이 다릅니다.');return structuredClone(saved.data) as ResponseByMutation[K];}
   if('version' in r&&r.version!==versionFor(p,name,r as unknown as Record<string,unknown>,target.cardId))fail('VERSION_CONFLICT','모의 원장을 다시 불러오세요.');
   const previous=p;const version=p.projectVersion+1;
   if(name==='research')p={...createMockSnapshot('selection'),topic:previous.topic,period:previous.period};
   if(name==='selection') {p={...createMockSnapshot('question'),topic:previous.topic,period:previous.period};p.selectedCandidateIds=(input as RequestByMutation['selection']).candidateIds;}
   if(name==='answers') {
    if(!p.question)fail('QUESTION_STALE','열린 질문이 없습니다.');
    const answer=validateAnswer(p.question,input);
    const size=p.question?.kind==='output_size'?(answer.answer[0]?.optionIds[0]??answer.answer[0]?.text):null;
    p={...createMockSnapshot('storyboard'),topic:previous.topic,period:previous.period};
    if(size==='1080x1080'||size==='1080x1350')p.storyboard!.size=size;
    if(previous.question?.kind==='output_size')p.storyboard!.version=(previous.storyboard?.version??1)+1;
   }
   if(name==='approve') {
    const stage=(input as RequestByMutation['approve']).stage;
    if(stage==='storyboard'){
     if(!p.storyboard?.size)fail('STAGE_CONFLICT','출력 크기 답변이 필요합니다.');
     p={...createMockSnapshot('review'),topic:previous.topic,period:previous.period};p.storyboard=structuredClone(previous.storyboard);p.storyboard!.approvedVersion=p.storyboard!.version;p.result!.size=p.storyboard!.size!;p.result!.storyboardVersion=p.storyboard!.version;
    }else{if(!p.result)fail('STAGE_CONFLICT','결과가 없습니다.');p.result!.finalApprovedVersion=p.result!.version;p.result!.cards.forEach(c=>c.approvedRevision=c.revision);p.stage='export';p.status='approved';p.allowedActions=['revise'];p.exports=[];}
   }
   if(name==='cardApprove'){const card=p.result?.cards.find(c=>c.cardId===target.cardId);if(!card||card.state!=='ready')fail('STAGE_CONFLICT','준비된 카드만 승인됩니다.');card!.approvedRevision=card!.revision;}
   if(name==='revisions'){
    const req=input as RequestByMutation['revisions'];
    if(req.scope==='storyboard'){p.storyboard!.version++;p.storyboard!.approvedVersion=null;p.storyboard!.rationale=req.instruction;}
    else{const result=p.result!;result.version++;result.finalApprovedVersion=null;p.stage='review';p.exports=[];p.allowedActions=['approve_final','revise'];
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
