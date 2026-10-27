import {describe,it,expect} from 'vitest';
import {validateContent,contentSchema} from '../../src/providers/조사검증.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
function fixture(){
 const snapshot=createMockSnapshot('selection');
 const version=snapshot.researchVersion+1;
 const first={...snapshot.candidates[0],researchVersion:version,eventDate:snapshot.period.to.slice(0,10),publishedDate:snapshot.period.to.slice(0,10)};
 const second={...first,sourceIds:[...first.sourceIds],candidateId:'a2000002-0000-4000-8000-000000000002',eventKey:'shared-event-two'};
 const third={...first,sourceIds:[...first.sourceIds],candidateId:'a2000003-0000-4000-8000-000000000003',eventKey:'shared-event-three'};
 const raw={kind:'candidates' as const,researchVersion:version,candidates:[first,second,third],sources:structuredClone(snapshot.sources),shortageReason:null};
 return {snapshot,raw};
}
describe('OFFLINE 합성 공통 출처 관계 — 실제 새 조사 아님',()=>{
 it('같은 출처를 공유하는 후보는 원문/근거를 보존한 후보별 별칭으로 연결한다',()=>{
  const {snapshot,raw}=fixture(),before=structuredClone(raw);
  const result=validateContent(raw,snapshot,'research');
  expect(result.kind).toBe('candidates');if(result.kind!=='candidates')return;
  expect(result.candidates).toHaveLength(3);expect(result.sources).toHaveLength(raw.sources.length+2);
  for(const candidate of result.candidates){
   const source=result.sources.find(s=>s.sourceId===candidate.sourceIds[0])!;
   expect(source.candidateId).toBe(candidate.candidateId);
   const {sourceId,candidateId,...fields}=source;
   const {sourceId:_originalId,candidateId:_originalCandidate,...original}=raw.sources[0];
   expect(fields).toEqual(original);
  }
  expect(result.candidates[0].sourceIds).toEqual(raw.candidates[0].sourceIds);
  expect(raw).toEqual(before);
  expect(contentSchema.safeParse(result).success).toBe(true);
  expect(validateContent(raw,snapshot,'research')).toEqual(result);
 });
 it('알 수 없는 출처와 소유 후보 없는 출처를 임의 복구하지 않는다',()=>{
  const missing=fixture();missing.raw.candidates[1].sourceIds=['b2999999-0000-4000-8000-000000000099'];
  expect(()=>validateContent(missing.raw,missing.snapshot,'research')).toThrow();
  const owner=fixture();owner.raw.sources[0].candidateId='a2999999-0000-4000-8000-000000000099';
  expect(()=>validateContent(owner.raw,owner.snapshot,'research')).toThrow();
 });
 it('원래 소유 후보가 참조하지 않은 출처와 중복 ID를 계속 거절한다',()=>{
  const missing=fixture();missing.raw.candidates[0].sourceIds=[];
  expect(()=>validateContent(missing.raw,missing.snapshot,'research')).toThrow();
  const duplicate=fixture();duplicate.raw.sources.push({...duplicate.raw.sources[0],title:'충돌'});
  expect(()=>validateContent(duplicate.raw,duplicate.snapshot,'research')).toThrow();
 });
 it('정규화 후에도 미래 날짜와 기간 불일치를 허용하지 않는다',()=>{
  const future=fixture();future.raw.candidates[0].eventDate='2099-01-01';
  expect(()=>validateContent(future.raw,future.snapshot,'research')).toThrow();
  const period=fixture();period.snapshot.period.from='2000-01-01T00:00:00.000Z';
  expect(()=>validateContent(period.raw,period.snapshot,'research')).toThrow();
 });
 it('생성될 별칭을 추측한 미지 출처나 다른 내용의 별칭 충돌을 허용하지 않는다',()=>{
  const original=fixture(),result=validateContent(original.raw,original.snapshot,'research');
  if(result.kind!=='candidates')throw Error('fixture');
  const alias=result.candidates[1].sourceIds[0];
  const missing=fixture();missing.raw.candidates[2].sourceIds=[alias];
  expect(()=>validateContent(missing.raw,missing.snapshot,'research')).toThrow();
  const collision=fixture();
  collision.raw.sources.push({...collision.raw.sources[0],sourceId:alias,candidateId:collision.raw.candidates[1].candidateId,title:'충돌하는 다른 원문'});
  collision.raw.candidates[1].sourceIds.push(alias);
  expect(()=>validateContent(collision.raw,collision.snapshot,'research')).toThrow();
 });
 it('별칭 추가로 기존 출처 상한100을 넘으면 기존 자료를 자르지 않고 거절한다',()=>{
  const {raw,snapshot}=fixture();
  for(let i=1;i<100;i++){
   const sourceId=`b3000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`;
   raw.sources.push({...raw.sources[0],sourceId});raw.candidates[0].sourceIds.push(sourceId);
  }
  expect(()=>validateContent(raw,snapshot,'research')).toThrow();
 });
});
