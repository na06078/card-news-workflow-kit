import {z} from 'zod';
import {createHash} from 'node:crypto';
import {CandidateSchema,SourceSchema,ClaimSchema,StoryboardSchema,CardRevisionSchema, type EngineContent,type ProjectSnapshot,type EngineContext,type RevisionRequest,canonicalJson} from '../shared/포트.js';
import {fail} from './오류.js';
import {RevisionPatchSchema,RevisionDecisionSchema,AppErrorSchema,normalizeRevisionDecision,DEFAULT_CARD_LAYOUT,type RevisionDecision} from '../shared/포트.js';
import {FactProposalDraftSchema} from '../shared/포트.js';
import {validateFactReview,type FetchReceipt} from './사실재검증.js';
const RESEARCH_SOURCE_LIMIT=100;
export const contentSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('candidates'),researchVersion:z.number().int().positive(),candidates:z.array(CandidateSchema).max(24),sources:z.array(SourceSchema).max(RESEARCH_SOURCE_LIMIT),shortageReason:z.string().min(1).nullable()}),
 z.strictObject({kind:z.literal('storyboard'),storyboard:StoryboardSchema,sources:z.array(SourceSchema).max(100),claims:z.array(ClaimSchema).max(100)}),
 z.strictObject({kind:z.literal('cards'),cards:z.array(CardRevisionSchema).max(20),factsCheck:z.enum(['pending','passed','failed']),visualCheck:z.enum(['pending','passed','failed'])})
]);
/** UUIDv5: a stable relationship ID, not a credential or a new factual source. */
function sourceRelationId(sourceId:string,candidateId:string):string {
 const namespace=Buffer.from(sourceId.replaceAll('-',''),'hex');
 const bytes=createHash('sha1').update(namespace).update(candidateId,'utf8').digest().subarray(0,16);
 bytes[6]=(bytes[6]!&0x0f)|0x50;bytes[8]=(bytes[8]!&0x3f)|0x80;
 const hex=bytes.toString('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** 번들 CLI의 JSON Schema 검증기는 draft-7을 사용하며 출력 루트는 현재 단계의 object로 한정합니다. */
export function contentSchemaFor(phase:EngineContext['phase'],request?:Pick<RevisionRequest,'scope'> & Partial<Pick<RevisionRequest,'cardIds'>>,revisionProtocol?:2){
 if(phase==='factReview')return FactProposalDraftSchema;
 if(phase==='research')return contentSchema.options[0];
 if(phase==='editorial'||request?.scope==='storyboard')return contentSchema.options[1];
 if(phase==='revision'&&request&&revisionProtocol===2){
  const patch=RevisionPatchSchema.options.find(option=>option.shape.scope.value===request.scope);
  if(!patch||!request.cardIds?.length)return fail('PROVIDER_PROTOCOL_ERROR');
  const scoped=patch.extend({cardId:z.enum(request.cardIds as [string,...string[]])});
  // Native StructuredOutput requires a single object root. The strict union is
  // still checked here and by the shared normalizer; no app metadata is exposed.
  return z.strictObject({kind:z.literal('revision'),status:z.enum(['patch','needs_scope','no_change','unsupported','clarification']),patches:z.array(scoped).length(request.cardIds.length).refine(xs=>new Set(xs.map(x=>x.cardId)).size===xs.length).optional(),requestedScope:z.enum(['text','image','layout']).optional(),reason:z.string().min(1).max(2000).optional(),question:z.string().min(1).max(2000).optional()}).refine(value=>RevisionDecisionSchema.safeParse(value).success,'정상 수정 결정의 필드만 허용');
 }
 if(phase==='revision'&&request)return contentSchema.options[2];
 return fail('PROVIDER_PROTOCOL_ERROR');
}
export function validateContent(raw:unknown,snapshot:ProjectSnapshot,phase:EngineContext['phase'],request?:RevisionRequest,receipts:FetchReceipt[]=[],revisionProtocol?:2):EngineContent {
 if(phase==='factReview')return validateFactReview(raw,snapshot,receipts);
 if(phase==='revision'&&request&&request.scope!=='storyboard'&&revisionProtocol===2)return normalizeRevisionDecision(raw,snapshot,request);
 const parsed=contentSchema.safeParse(raw);if(!parsed.success)return fail('PROVIDER_PROTOCOL_ERROR');
 const out=parsed.data;
 const unique=(a:string[])=>new Set(a).size===a.length;
 const period=snapshot.period;
 if(period.to!==period.anchorAt || Date.parse(period.to)-Date.parse(period.from)!==period.days*86400000)fail('RESEARCH_FAILED');
 if(out.kind==='candidates'){
  if(phase!=='research'||out.researchVersion!==snapshot.researchVersion+1)fail('PROVIDER_PROTOCOL_ERROR');
  if(!unique(out.candidates.map(c=>c.candidateId))||!unique(out.sources.map(s=>s.sourceId)))fail('RESEARCH_FAILED');
  const sourceMap=new Map(out.sources.map(s=>[s.sourceId,s]));
  const inputSources=new Map(sourceMap);
  const candidateMap=new Map(out.candidates.map(c=>[c.candidateId,c]));
  for(const source of out.sources)if(!candidateMap.get(source.candidateId)?.sourceIds.includes(source.sourceId))fail('RESEARCH_FAILED');
  // A document may support multiple stories. Preserve its original owner and
  // facts while giving each additional candidate a consistent Source relation.
  for(const candidate of out.candidates){
   candidate.sourceIds=[...new Set(candidate.sourceIds.map(sourceId=>{
    const source=inputSources.get(sourceId);if(!source)fail('RESEARCH_FAILED');
    if(source.candidateId===candidate.candidateId)return sourceId;
    const aliasId=sourceRelationId(sourceId,candidate.candidateId);
    const alias={...source,sourceId:aliasId,candidateId:candidate.candidateId};
    const existing=sourceMap.get(aliasId);
    if(existing&&canonicalJson(existing)!==canonicalJson(alias))fail('RESEARCH_FAILED');
    if(!existing){
     if(out.sources.length>=RESEARCH_SOURCE_LIMIT)fail('RESEARCH_FAILED');
     out.sources.push(alias);sourceMap.set(aliasId,alias);
    }
    return aliasId;
   }))];
  }
  const groups=new Map<string,typeof out.candidates[number]>();
  const keepSources:typeof out.sources=[];
  for(const c of out.candidates){
   if(c.researchVersion!==out.researchVersion||!c.sourceIds.length||c.sourceIds.some(id=>sourceMap.get(id)?.candidateId!==c.candidateId))fail('RESEARCH_FAILED');
   const end=period.to.slice(0,10),start=period.from.slice(0,10);
   if([c.eventDate,c.publishedDate].some(d=>d!==null&&d>end))fail('RESEARCH_FAILED');
   // 최근 게시된 회고 기사라도 오래된 사건이면 새 소식으로 세지 않습니다.
   if(c.eventDate!==null&&c.eventDate<start)continue;
   if(c.eventDate===null&&!c.uncertainties.includes('사건일 미확인: 최근 소식으로 확정하지 않았습니다.'))c.uncertainties.push('사건일 미확인: 최근 소식으로 확정하지 않았습니다.');
   if(c.publishedDate===null)c.uncertainties=[...new Set([...c.uncertainties,'게시일 미확인'])];
   const previous=groups.get(c.eventKey);
   if(previous){
    if(previous.eventDate&&c.eventDate&&previous.eventDate!==c.eventDate)fail('RESEARCH_FAILED');
    previous.sourceIds.push(...c.sourceIds);previous.uncertainties=[...new Set([...previous.uncertainties,...c.uncertainties])];
   }else groups.set(c.eventKey,c);
   for(const id of c.sourceIds)keepSources.push({...sourceMap.get(id)!,candidateId:previous?.candidateId??c.candidateId});
  }
  const candidates=[...groups.values()];
  if(candidates.length>12)fail('RESEARCH_FAILED');
  const confirmed=candidates.filter(c=>c.eventDate!==null).length;
  const shortageReason=confirmed<7?`기간 내 사건일 확인 후보 ${confirmed}개, 전체 ${candidates.length}개. ${period.days===7?'30일로 넓힐지는 사용자가 선택해야 합니다.':'30일 범위에서도 부족합니다.'}${out.shortageReason?` ${out.shortageReason}`:''}`:out.shortageReason;
  return {...out,candidates,sources:keepSources,shortageReason};
 }
 if(phase==='research')fail('PROVIDER_PROTOCOL_ERROR');
 if(out.kind==='cards'){
  if(phase!=='revision'||!snapshot.result)fail('PROVIDER_PROTOCOL_ERROR');
  for(const card of out.cards)if(!snapshot.result!.cards.some(c=>c.cardId===card.cardId)||card.sourceIds.some(id=>!snapshot.sources.some(s=>s.sourceId===id&&snapshot.selectedCandidateIds.includes(s.candidateId))))fail('PROVIDER_PROTOCOL_ERROR');
  if(request){
   if(!unique(out.cards.map(c=>c.cardId))||out.cards.length!==request.cardIds.length||out.cards.some(c=>!request.cardIds.includes(c.cardId)))fail('PROVIDER_PROTOCOL_ERROR');
   for(const card of out.cards){const old=snapshot.result!.cards.find(c=>c.cardId===card.cardId)!;
    if(request.scope==='layout'){
     if(!card.layout||canonicalJson(card.layout)===canonicalJson(old.layout??{fontScale:'normal',textAlign:'left',placement:'bottom'}))fail('PROVIDER_PROTOCOL_ERROR');
     const {layout:_old,...before}=old,{layout:_next,...after}=card;
     if(canonicalJson(before)!==canonicalJson(after))fail('PROVIDER_PROTOCOL_ERROR');
    }else if(canonicalJson(old.layout??null)!==canonicalJson(card.layout??null))fail('PROVIDER_PROTOCOL_ERROR');
   }
  }
  return out;
 }
 const selected=new Set(snapshot.selectedCandidateIds);
 if(selected.size<1||selected.size>3||out.storyboard.approvedVersion!==null)fail('RESEARCH_FAILED');
 if(!unique(out.sources.map(s=>s.sourceId)))fail('RESEARCH_FAILED');
 // 모델이 보존 목적으로 되돌려준 미선택 기존 원문은 변경 불가 데이터로만 인정합니다.
 const existing=new Map(snapshot.sources.map(s=>[s.sourceId,s]));
 for(const source of out.sources)if(!selected.has(source.candidateId)){
  const old=existing.get(source.sourceId);if(!old||canonicalJson(old)!==canonicalJson(source))fail('RESEARCH_FAILED');
 }
 const selectedSources=out.sources.filter(s=>selected.has(s.candidateId));
 const sources=new Map(selectedSources.map(s=>[s.sourceId,s]));
 for(const source of selectedSources)if(source.access==='opened'&&(!source.evidence||!source.accessedAt))fail('RESEARCH_FAILED');
 for(const claim of out.claims){
  if(!claim.sourceIds.length||claim.sourceIds.some(id=>!sources.has(id)))fail('RESEARCH_FAILED');
  if(claim.kind==='verified'&&claim.sourceIds.some(id=>sources.get(id)!.access!=='opened'||!sources.get(id)!.evidence))fail('RESEARCH_FAILED');
  // 독립 검증/성능 등 의미적 진실 판정은 원문 대조 live gate; 구조로 사실을 꾸미지 않습니다.
 }
 for(const card of out.storyboard.cards)if(!card.sourceIds.length||card.sourceIds.some(id=>!sources.has(id)))fail('RESEARCH_FAILED');
 for(const id of selected)if(!out.sources.some(s=>s.candidateId===id&&s.primary)&&!out.sources.some(s=>s.candidateId===id&&s.limitations.length))fail('RESEARCH_FAILED');
 if(out.storyboard.version!==(snapshot.storyboard?.version??0)+1||snapshot.storyboard?.size&&out.storyboard.size!==snapshot.storyboard.size)fail('PROVIDER_PROTOCOL_ERROR');
 return {...out,sources:selectedSources};
}

/** 저장 응답의 명시적 unsupported만 재생합니다. 새 SDK 출력의 fallback이 아닙니다.
 * 모델 error 설명/조치/승인값은 신뢰하거나 전파하지 않고 앱 소유 정상 결과로 바꿉니다. */
export function normalizeStoredUnsupportedRevision(raw:unknown,snapshot:ProjectSnapshot,request:RevisionRequest):RevisionDecision{
 const envelope=z.strictObject({kind:z.literal('cards'),cards:z.array(z.record(z.string(),z.unknown())).min(1).max(20),factsCheck:z.enum(['pending','passed','failed']),visualCheck:z.enum(['pending','passed','failed'])}).safeParse(raw);
 const result=snapshot.result;
 if(!envelope.success||!result||request.scope==='storyboard'||request.renderOnly||!request.cardIds.length||new Set(request.cardIds).size!==request.cardIds.length||request.cardIds.some(id=>!result.cards.some(c=>c.cardId===id)))return fail('PROVIDER_PROTOCOL_ERROR');
 const output=envelope.data;
 if(output.factsCheck!==result.factsCheck||output.visualCheck!==result.visualCheck||output.cards.length!==result.cards.length||new Set(output.cards.map(c=>c.cardId)).size!==result.cards.length)return fail('PROVIDER_PROTOCOL_ERROR');
 let recognized=false;
 for(const returned of output.cards){
  const old=result.cards.find(c=>c.cardId===returned.cardId);if(!old)return fail('PROVIDER_PROTOCOL_ERROR');
  const candidate=structuredClone(returned);
  if(request.cardIds.includes(old.cardId)&&candidate.error&&typeof candidate.error==='object'){
   const parsedError=AppErrorSchema.safeParse(candidate.error);if(!parsedError.success)return fail('PROVIDER_PROTOCOL_ERROR');
   const error=parsedError.data;
   if(error.code==='REVISION_SCOPE_UNSUPPORTED'||error.code==='PROVIDER_PROTOCOL_ERROR'&&error.details.reason==='REVISION_SCOPE_UNSUPPORTED'){
    recognized=true;candidate.error=old.error;
   }
  }
  const before={...old,layout:old.layout??DEFAULT_CARD_LAYOUT,sourceIds:[...old.sourceIds].sort()};
  if(Array.isArray(candidate.sourceIds))candidate.sourceIds=[...candidate.sourceIds].sort();
  if(candidate.layout===undefined)candidate.layout=DEFAULT_CARD_LAYOUT;
  if(canonicalJson(candidate)!==canonicalJson(before))return fail('PROVIDER_PROTOCOL_ERROR');
 }
 if(!recognized)return fail('PROVIDER_PROTOCOL_ERROR');
 return normalizeRevisionDecision({kind:'revision',status:'unsupported',reason:'저장된 응답은 요청 범위에서 지원하지 않는 수정이라고 명시했습니다. 기존 카드·PNG·승인은 변경하지 않았습니다.'},snapshot,request);
}
export {normalizeStoredUnsupportedRevision as normalizeLegacyRevisionResponse};
