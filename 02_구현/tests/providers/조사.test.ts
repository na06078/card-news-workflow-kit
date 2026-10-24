import {describe,it,expect} from 'vitest';
import {validateContent, contentSchema} from '../../src/providers/조사검증.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
const snap=()=>createMockSnapshot('selection');
const research=()=>{const s=snap();return {kind:'candidates',researchVersion:2,candidates:s.candidates.map(c=>({...c,researchVersion:2,eventDate:'2026-10-21',publishedDate:'2026-10-22'})),sources:s.sources,shortageReason:null};};
describe('OFFLINE 합성 후보/원문 의미 검증 — 실제 조사 아님',()=>{
 it('7일 조사/게시일≠사건일/중복 그룹/부족·기간확장 신호',()=>{
  const s=snap(),r=research();
  r.candidates.push({...r.candidates[0],candidateId:'b2222222-2222-4222-8222-222222222222'});
  r.sources.push({...r.sources[0],sourceId:'c2222222-2222-4222-8222-222222222222',candidateId:r.candidates[1].candidateId});
  r.candidates[1].sourceIds=[r.sources[1].sourceId];
  const out=validateContent(r,s,'research');
  expect(out.kind).toBe('candidates');if(out.kind!=='candidates')return;
  expect(out.candidates).toHaveLength(1);expect(out.candidates[0].sourceIds).toHaveLength(2);
  expect(out.sources.every(x=>x.candidateId===I.candidate)).toBe(true);
  expect(out.shortageReason).toContain('30일');
  const old=research();old.candidates[0].eventDate='2020-01-01';
  expect((validateContent(old,s,'research') as typeof old).candidates).toHaveLength(0);
 });
 it('미확인 날짜는 최신으로 확정하지 않고 불확실성으로 보존',()=>{
  const r=research();r.candidates[0].eventDate=null!;r.candidates[0].publishedDate=null!;
  const out=validateContent(r,snap(),'research');if(out.kind!=='candidates')return;
  expect(out.candidates[0].uncertainties.join(' ')).toContain('사건일');expect(out.shortageReason).not.toBeNull();
 });
 it('기간 자체의 임의 확장·미래·출처 누락·잘못된 출력 거절',()=>{
  const bad=research();bad.candidates[0].eventDate='2099-01-01';
  expect(()=>validateContent(bad,snap(),'research')).toThrow();
  const s=snap();s.period.from='2020-01-01T00:00:00Z';expect(()=>validateContent(research(),s,'research')).toThrow();
  expect(()=>validateContent({...research(),sources:[]},snap(),'research')).toThrow();
  expect(contentSchema.safeParse({kind:'result',text:'성공'}).success).toBe(false);
 });
 it('선택한 후보만 원문·주장·카드 근거 허용, 근거 없는 verified 거절',()=>{
  const s=createMockSnapshot('storyboard');
  const result={kind:'storyboard',storyboard:{...s.storyboard!,version:2},sources:s.sources,claims:[{text:'[합성] 발표자 주장',sourceIds:[I.source],kind:'publisher_claim',availability:'announced',conditions:['미검증']}]};
  expect(validateContent(result,s,'editorial')).toMatchObject({claims:[{kind:'publisher_claim',availability:'announced'}]});
  expect(()=>validateContent({...result,claims:[{...result.claims[0],kind:'verified'}]},s,'editorial')).toThrow();
  expect(()=>validateContent({...result,sources:[{...s.sources[0],candidateId:'b2222222-2222-4222-8222-222222222222'}]},s,'editorial')).toThrow();
 });
 it('기획에서 미선택 기존 출처의 그대로인 echo만 제거하고 수정/주장 참조는 거절한다',()=>{
  const s=createMockSnapshot('storyboard');const other={...s.sources[0],sourceId:'c2222222-2222-4222-8222-222222222222',candidateId:'b2222222-2222-4222-8222-222222222222'};
  s.sources.push(other);s.candidates.push({...s.candidates[0],candidateId:other.candidateId,eventKey:'다른-사건',sourceIds:[other.sourceId]});
  const result={kind:'storyboard',storyboard:{...s.storyboard!,version:2},sources:s.sources,claims:[]};
  expect(validateContent(result,s,'editorial')).toMatchObject({sources:s.sources.filter(x=>x.candidateId!==other.candidateId)});
  const changed={...result,sources:s.sources.map(x=>x.sourceId===other.sourceId?{...x,title:'미선택 원문 수정'}:x)};
  expect(()=>validateContent(changed,s,'editorial')).toThrow();
  expect(()=>validateContent({...result,claims:[{text:'다른 소식',sourceIds:[other.sourceId],kind:'publisher_claim',availability:'announced',conditions:[]}]},s,'editorial')).toThrow();
 });
 it('사용자가 정한 출력 크기를 공급자가 임의 변경할 수 없음',()=>{
  const s=createMockSnapshot('storyboard');
  expect(()=>validateContent({kind:'storyboard',storyboard:{...s.storyboard!,version:2,size:'1080x1350'},sources:s.sources,claims:[]},s,'editorial')).toThrowError(expect.objectContaining({code:'PROVIDER_PROTOCOL_ERROR'}));
 });
});
