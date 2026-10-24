import { z } from 'zod';
export const IdSchema = z.uuid();
export const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const TextSchema = z.string().refine(s => [...s].length > 0, '빈 문자열 금지');
const bounded = (max:number) => TextSchema.refine(s => [...s].length <= max, `최대 ${max} code point`);
const unique = <T>(schema:z.ZodType<T>) => z.array(schema).refine(a => new Set(a).size === a.length, '중복 값 금지');
const ids = unique(IdSchema);
export const SizeSchema = z.enum(['1080x1080','1080x1350']);
export const ModelIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]*$/);
export const CreateProjectRequestSchema = z.strictObject({
  topic: bounded(500), createRequestId: IdSchema, period: z.union([z.literal(7),z.literal(30)]).default(7),claudeModel:ModelIdSchema.nullable().optional()
});
export const VersionRequestSchema = z.strictObject({requestId:IdSchema,version:VersionSchema});
export const SelectionRequestSchema = VersionRequestSchema.extend({candidateIds:ids.min(1).max(3)});
export const AnswerItemSchema = z.strictObject({itemId:TextSchema,optionIds:unique(TextSchema),text:bounded(2000).nullable()}).refine(a => a.text === null ? a.optionIds.length > 0 : a.optionIds.length === 0, '선택 또는 자유 입력 하나만');
export const AnswerRequestSchema = VersionRequestSchema.extend({questionId:IdSchema,answer:z.array(AnswerItemSchema).min(1).max(4).refine(a => new Set(a.map(x=>x.itemId)).size===a.length,'중복 itemId')});
export const ApproveRequestSchema = VersionRequestSchema.extend({stage:z.enum(['storyboard','final'])});
export const RevisionRequestSchema = VersionRequestSchema.extend({cardIds:ids.min(1).max(20),instruction:bounded(4000),scope:z.enum(['storyboard','text','image','layout'])});
export const CancelRequestSchema = z.strictObject({requestId:IdSchema});
export const RetryRequestSchema = VersionRequestSchema.extend({confirmUnknownOutcome:z.boolean().optional()});
export const CardApproveRequestSchema = VersionRequestSchema.extend({resultVersion:VersionSchema});
export const RequestSchemas = {research:VersionRequestSchema,selection:SelectionRequestSchema,answers:AnswerRequestSchema,approve:ApproveRequestSchema,revisions:RevisionRequestSchema,cancel:CancelRequestSchema,retry:RetryRequestSchema,cardApprove:CardApproveRequestSchema} as const;

export const UtcSchema = z.iso.datetime({offset:false});
export const DateSchema = z.iso.date();
/** 구문 수준의 공개 HTTPS 검사. DNS/redirect egress 안전성은 G1 경계에서 별도 검사해야 합니다. */
export const PublicUrlSchema = z.url().refine(s => {
  if(!URL.canParse(s)) return false;
  const u=new URL(s); const h=u.hostname.toLowerCase();
  return u.protocol==='https:' && !u.username && !u.password && h.includes('.') &&
    !/^[\d.]+$/.test(h) && !h.includes(':') && !h.endsWith('.localhost') &&
    !h.endsWith('.local') && !h.endsWith('.internal') && !h.endsWith('.test');
},'공개 HTTPS 원문만');
export const StageSchema=z.enum(['topic','research','selection','editorial','storyboard','production','review','export']);
export const RunStatusSchema=z.enum(['queued','running','waiting_for_user','cancel_requested','succeeded','failed','canceled','interrupted']);
export const ProjectStatusSchema=z.enum(['idle','working','waiting_for_user','ready','approved','error','interrupted','canceled']);
export const NextActionSchema=z.enum(['retry','answer','select','approve_storyboard','approve_final','revise','cancel','check_login','wait_quota','contact_user']);
// 콘텐츠 버전은 양수지만 아직 저장하지 않은 모델 설정 버전은 0입니다.
export const AppErrorSchema=z.strictObject({code:TextSchema,message:TextSchema,retryable:z.boolean(),nextActions:unique(NextActionSchema),projectId:IdSchema.nullable(),runId:IdSchema.nullable(),currentVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),details:z.strictObject({field:TextSchema.optional(),reason:TextSchema.optional(),retryAfterSeconds:z.number().int().nonnegative().optional()})});
export const MutationReceiptSchema=z.strictObject({projectId:IdSchema,projectVersion:VersionSchema,runId:IdSchema.nullable(),status:RunStatusSchema.nullable(),accepted:z.literal(true)}).refine(r=>(r.runId===null)===(r.status===null),'runId/status null 일치');
export const CreateProjectResponseSchema=z.strictObject({projectId:IdSchema,projectVersion:z.literal(1)});
// receipt 확장도 strictObject로 만들어 stage별 허용 추가 필드만 보존합니다.
const receiptFields={projectId:IdSchema,projectVersion:VersionSchema,runId:IdSchema.nullable(),status:RunStatusSchema.nullable(),accepted:z.literal(true)};
export const ResponseSchemas={
 research:MutationReceiptSchema,
 selection:z.strictObject({...receiptFields,selectedCandidateIds:ids.min(1).max(3)}),
 answers:z.strictObject({...receiptFields,questionId:IdSchema,questionVersion:VersionSchema}),
 approve:z.strictObject({...receiptFields,finalApprovedVersion:VersionSchema.optional()}),
 revisions:MutationReceiptSchema,cancel:MutationReceiptSchema,retry:MutationReceiptSchema,
 cardApprove:z.strictObject({projectId:IdSchema,projectVersion:VersionSchema,cardId:IdSchema,approvedRevision:VersionSchema})
};
export const SourceSchema=z.strictObject({sourceId:IdSchema,candidateId:IdSchema,url:PublicUrlSchema,title:TextSchema,publisher:TextSchema.nullable(),publishedDate:DateSchema.nullable(),eventDate:DateSchema.nullable(),accessedAt:UtcSchema.nullable(),primary:z.boolean(),access:z.enum(['not_opened','opened','blocked','failed']),evidence:TextSchema.nullable(),limitations:unique(TextSchema)});
export const ClaimSchema=z.strictObject({text:TextSchema,sourceIds:ids,kind:z.enum(['verified','publisher_claim','uncertain','conflicting']),availability:z.enum(['announced','released','unknown']),conditions:unique(TextSchema)});
export const CandidateSchema=z.strictObject({candidateId:IdSchema,researchVersion:VersionSchema,eventKey:TextSchema,category:TextSchema,title:TextSchema,summary:TextSchema,publishedDate:DateSchema.nullable(),eventDate:DateSchema.nullable(),sourceIds:ids,selectionReason:TextSchema,uncertainties:unique(TextSchema)});
const options=z.array(z.strictObject({optionId:TextSchema,label:TextSchema,description:TextSchema})).min(2).max(4).refine(a=>new Set(a.map(x=>x.optionId)).size===a.length,'중복 optionId');
export const QuestionItemSchema=z.strictObject({itemId:TextSchema,text:TextSchema,header:TextSchema,options,multiSelect:z.boolean(),allowFreeText:z.literal(true),recommendedOptionId:TextSchema.nullable(),recommendationReason:TextSchema.nullable()}).refine(q=>q.recommendedOptionId===null || q.options.some(o=>o.optionId===q.recommendedOptionId),'추천 선택지 없음');
export const QuestionSchema=z.strictObject({questionId:IdSchema,version:VersionSchema,runId:IdSchema.nullable(),kind:z.enum(['period_expansion','editorial','output_size']),items:z.array(QuestionItemSchema).min(1).max(4).refine(a=>new Set(a.map(x=>x.itemId)).size===a.length,'중복 itemId'),status:z.enum(['open','answered','superseded','canceled']),createdAt:UtcSchema});
export const CardPlanSchema=z.strictObject({cardId:IdSchema,order:VersionSchema,role:z.enum(['cover','body','closing']),title:TextSchema,body:TextSchema,sourceIds:ids,imagePlan:TextSchema});
const uniqueCards=<T extends {cardId:string;order:number}>(a:T[])=>new Set(a.map(x=>x.cardId)).size===a.length && new Set(a.map(x=>x.order)).size===a.length;
export const StoryboardSchema=z.strictObject({version:VersionSchema,audience:TextSchema,rationale:TextSchema,format:TextSchema,hooks:unique(TextSchema).min(2).max(3),size:SizeSchema.nullable(),cards:z.array(CardPlanSchema).max(20).refine(uniqueCards,'중복 cardId/order'),approvedVersion:VersionSchema.nullable()}).refine(s=>s.approvedVersion===null || (s.approvedVersion===s.version && s.size!==null),'현재 크기 확정 계획만 승인');
export const CardLayoutSchema=z.strictObject({fontScale:z.enum(['small','normal','large']),textAlign:z.enum(['left','center']),placement:z.enum(['top','bottom'])});
export const CardRevisionSchema=CardPlanSchema.extend({layout:CardLayoutSchema.optional(),revision:VersionSchema,imageAssetId:IdSchema.nullable(),previewAssetId:IdSchema.nullable(),state:z.enum(['pending','generating','rendering','ready','failed']),approvedRevision:VersionSchema.nullable(),error:AppErrorSchema.nullable()}).refine(c=>c.approvedRevision===null || (c.state==='ready' && c.approvedRevision===c.revision),'현재 ready 개정만 승인');
export const ResultVersionSchema=z.strictObject({version:VersionSchema,storyboardVersion:VersionSchema,size:SizeSchema,cards:z.array(CardRevisionSchema).max(20).refine(uniqueCards,'중복 cardId/order'),factsCheck:z.enum(['pending','passed','failed']),visualCheck:z.enum(['pending','passed','failed']),finalApprovedVersion:VersionSchema.nullable()}).refine(r=>r.finalApprovedVersion===null || (r.finalApprovedVersion===r.version && r.factsCheck==='passed' && r.visualCheck==='passed' && r.cards.every(c=>c.state==='ready' && c.approvedRevision===c.revision)),'현재 검수완료 결과만 최종 승인');
export const RunSchema=z.strictObject({runId:IdSchema,projectId:IdSchema,kind:z.enum(['research','editorial','production','revision','export']),status:RunStatusSchema,attempt:VersionSchema,phase:TextSchema,createdAt:UtcSchema,updatedAt:UtcSchema,lastEventSeq:z.number().int().nonnegative(),questionId:IdSchema.nullable(),error:AppErrorSchema.nullable(),externalOutcome:z.enum(['not_started','known','unknown']),retryAllowed:z.boolean(),requestedModel:ModelIdSchema.nullable().optional(),actualModel:ModelIdSchema.optional()});
export const Sha256Schema=z.string().regex(/^[a-f0-9]{64}$/);
export const ExportEntrySchema=z.strictObject({exportId:IdSchema,projectId:IdSchema,resultVersion:VersionSchema,kind:z.enum(['png','zip','records']),cardId:IdSchema.nullable(),cardRevision:VersionSchema.nullable(),filename:TextSchema,mimeType:TextSchema,bytes:z.number().int().positive(),sha256:Sha256Schema,downloadUrl:TextSchema});
export const ProjectSnapshotSchema=z.strictObject({projectId:IdSchema,topic:bounded(500),projectVersion:VersionSchema,stage:StageSchema,status:ProjectStatusSchema,claudeModel:ModelIdSchema.nullable().optional(),modelSettingsVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),period:z.strictObject({days:z.union([z.literal(7),z.literal(30)]),anchorAt:UtcSchema,from:UtcSchema,to:UtcSchema}).refine(p=>p.to===p.anchorAt && p.from<=p.to,'조사 기간 불일치'),researchVersion:z.number().int().nonnegative(),candidates:z.array(CandidateSchema),sources:z.array(SourceSchema),claims:z.array(ClaimSchema),selectedCandidateIds:ids.max(3),question:QuestionSchema.nullable(),storyboard:StoryboardSchema.nullable(),result:ResultVersionSchema.nullable(),activeRun:RunSchema.nullable(),lastRun:RunSchema.nullable(),allowedActions:unique(NextActionSchema),exports:z.array(ExportEntrySchema),dataMode:z.enum(['real','mock'])}).superRefine((p,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  const cs=new Set(p.candidates.map(c=>c.candidateId)), ss=new Map(p.sources.map(s=>[s.sourceId,s]));
  if(cs.size!==p.candidates.length || ss.size!==p.sources.length) fail('중복 candidate/source ID');
  if(new Set(p.candidates.map(c=>c.eventKey)).size!==p.candidates.length) fail('중복 eventKey');
  if(p.selectedCandidateIds.some(id=>!cs.has(id))) fail('선택 후보 없음');
  if(p.sources.some(s=>!cs.has(s.candidateId))) fail('출처 후보 없음');
  if(p.candidates.some(c=>c.researchVersion!==p.researchVersion || c.sourceIds.some(id=>ss.get(id)?.candidateId!==c.candidateId))) fail('조사/후보 출처 참조 불일치');
  for(const c of p.claims) {
    if(c.sourceIds.some(id=>!ss.has(id) || !p.selectedCandidateIds.includes(ss.get(id)!.candidateId))) fail('선택 범위 밖 주장');
    if(c.kind==='verified' && (!c.sourceIds.length || c.sourceIds.some(id=>ss.get(id)?.access!=='opened' || !ss.get(id)?.evidence))) fail('원문 근거 없는 verified');
  }
  for(const c of [...(p.storyboard?.cards??[]),...(p.result?.cards??[])]) if(c.sourceIds.some(id=>!ss.has(id))) fail('카드 출처 없음');
  for(const r of [p.activeRun,p.lastRun]) if(r && r.projectId!==p.projectId) fail('교차 project run');
  if(p.activeRun && !['queued','running','waiting_for_user','cancel_requested'].includes(p.activeRun.status)) fail('activeRun은 active 상태만');
  if(p.question?.runId && p.question.status==='open' && p.question.runId!==p.activeRun?.runId) fail('현재 질문 run 불일치');
  if(p.exports.some(e=>e.projectId!==p.projectId || e.resultVersion!==p.result?.version || p.result.finalApprovedVersion!==p.result.version)) fail('현재 승인 밖 export');
});
export const EngineContextSchema=z.strictObject({projectId:IdSchema,runId:IdSchema,attempt:VersionSchema,engine:z.literal('claude-agent-sdk'),engineSessionId:TextSchema.nullable(),cwd:TextSchema,phase:z.enum(['research','editorial','revision']),baseProjectVersion:VersionSchema,requestedModel:ModelIdSchema.nullable().optional()});
const eventBase={seq:VersionSchema,projectId:IdSchema,runId:IdSchema,attempt:VersionSchema,at:UtcSchema};
export const EngineEventSchema=z.discriminatedUnion('type',[
 z.strictObject({...eventBase,type:z.literal('progress'),actualModel:ModelIdSchema.optional(),activity:z.strictObject({provider:z.enum(['claude','agy','app']),operation:z.enum(['authentication','search','fetch','planning','image','conversion','render','export']),status:z.enum(['started','completed','failed','waiting']),cardId:IdSchema.optional(),tool:z.string().regex(/^(WebSearch|WebFetch|AskUserQuestion|StructuredOutput|generate_image)$/).optional()}).optional(),phase:TextSchema,message:TextSchema,completed:z.number().int().nonnegative().nullable(),total:z.number().int().nonnegative().nullable()}),
 z.strictObject({...eventBase,type:z.literal('need_input'),question:QuestionSchema}),
 z.strictObject({...eventBase,type:z.literal('result'),kind:z.enum(['candidates','storyboard','cards','exports']),version:VersionSchema}),
 z.strictObject({...eventBase,type:z.literal('error'),error:AppErrorSchema})
]);
export const RenderInputSchema=z.strictObject({projectId:IdSchema,runId:IdSchema,attempt:VersionSchema,resultVersion:VersionSchema,card:CardRevisionSchema,size:SizeSchema,image:z.strictObject({assetId:IdSchema,absolutePath:TextSchema,sha256:Sha256Schema}),researchAt:UtcSchema,sourceLabels:z.array(z.strictObject({sourceId:IdSchema,label:TextSchema,url:PublicUrlSchema})),font:z.strictObject({family:z.literal('Noto Sans KR'),absolutePath:TextSchema,licenseAssetId:IdSchema}),templateVersion:z.literal('cn-basic-1'),outputPath:TextSchema});
export const RenderOutputSchema=z.strictObject({projectId:IdSchema,resultVersion:VersionSchema,cardId:IdSchema,cardRevision:VersionSchema,path:TextSchema,mimeType:z.literal('image/png'),width:z.literal(1080),height:z.union([z.literal(1080),z.literal(1350)]),sha256:Sha256Schema,bytes:z.number().int().positive(),checks:z.strictObject({fontLoaded:z.boolean(),imageDecoded:z.boolean(),overflow:z.boolean()}),warnings:unique(TextSchema)});
export const EngineInputSchemas={
 research:z.strictObject({snapshot:ProjectSnapshotSchema}),
 editorial:z.strictObject({snapshot:ProjectSnapshotSchema}),
 revision:z.strictObject({snapshot:ProjectSnapshotSchema,request:RevisionRequestSchema})
};
export const EventPageSchema=z.strictObject({events:z.array(EngineEventSchema).max(100),nextSeq:z.number().int().nonnegative(),hasMore:z.boolean()});
export const ExportListSchema=z.strictObject({resultVersion:VersionSchema,entries:z.array(ExportEntrySchema),exportRun:RunSchema.nullable()});
export const BootstrapSchema=z.strictObject({csrfToken:TextSchema,contractVersion:z.literal('CN-1')});
export const FailureSchema=z.strictObject({error:AppErrorSchema});
export const successSchema=<T>(schema:z.ZodType<T>)=>z.strictObject({data:schema});
/** 검증된 JSON만 받습니다. B1이 method/정규 route와 함께 저장하고 requestId는 호출자가 제거합니다. */
export function canonicalJson(value:unknown):string {
 const ancestors=new Set<object>();
 const visit=(v:unknown):string=>{
   if(v===null || typeof v==='string' || typeof v==='boolean') return JSON.stringify(v);
   if(typeof v==='number' && Number.isFinite(v)) return JSON.stringify(v);
   if(typeof v!=='object' || v===null || ancestors.has(v)) throw new TypeError('유한 JSON 값만 허용');
   if(!Array.isArray(v) && Object.getPrototypeOf(v)!==Object.prototype && Object.getPrototypeOf(v)!==null) throw new TypeError('plain JSON object만 허용');
   ancestors.add(v);
   try {
     if(Array.isArray(v)) return '['+Array.from(v,visit).join(',')+']';
     const obj=v as Record<string,unknown>;
     return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+visit(obj[k])).join(',')+'}';
   } finally { ancestors.delete(v); }
 };
 return visit(value);
}

export function validateAnswer(question:unknown,request:unknown) {
 const q=QuestionSchema.parse(question), r=AnswerRequestSchema.parse(request);
 if(q.status!=='open' || q.questionId!==r.questionId || q.version!==r.version) throw new Error('QUESTION_STALE');
 if(q.items.length!==r.answer.length) throw new Error('VALIDATION_ERROR: 모든 질문 항목에 답변 필요');
 for(const item of q.items) {
   const a=r.answer.find(x=>x.itemId===item.itemId);
   if(!a || a.optionIds.some(id=>!item.options.some(o=>o.optionId===id)) || (!item.multiSelect && a.optionIds.length>1)) throw new Error('VALIDATION_ERROR: 선택지 불일치');
 }
 return r;
}
