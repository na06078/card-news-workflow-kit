import {describe,it,expect,expectTypeOf} from 'vitest';
import {z} from 'zod';
import * as V from '../../src/shared/검증.js';
import type * as C from '../../src/shared/계약.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';
type SameShape<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
const id=MOCK_IDS.project;
describe('전체 DTO/오류/렌더 회귀',()=>{
 it('DTO와 runtime 출력 타입이 양방향으로 일치한다',()=>{
   expectTypeOf<SameShape<z.output<typeof V.ProjectSnapshotSchema>,C.ProjectSnapshot>>().toEqualTypeOf<true>();
   expectTypeOf<SameShape<z.output<typeof V.RenderInputSchema>,C.RenderInput>>().toEqualTypeOf<true>();
   expectTypeOf<SameShape<z.output<typeof V.RenderOutputSchema>,C.RenderOutput>>().toEqualTypeOf<true>();
   expectTypeOf<SameShape<z.output<typeof V.EngineContextSchema>,C.EngineContext>>().toEqualTypeOf<true>();
   expectTypeOf<SameShape<z.output<typeof V.EngineEventSchema>,C.EngineEvent>>().toEqualTypeOf<true>();
   expectTypeOf<SameShape<z.output<typeof V.AppErrorSchema>,C.AppError>>().toEqualTypeOf<true>();
 });
 it('버전별 receipt/event/error를 JSON 왕복한다',()=>{
   const error:C.AppError={code:'AUTH_MODE_UNKNOWN',message:'인증 미검증',retryable:false,nextActions:['check_login'],projectId:id,runId:null,currentVersion:1,details:{reason:'양성 근거 없음'}};
   expect(V.FailureSchema.parse(JSON.parse(JSON.stringify({error})))).toEqual({error});
   const receipt={projectId:id,projectVersion:1,runId:MOCK_IDS.run,status:'queued',accepted:true};
   expect(V.MutationReceiptSchema.parse(receipt)).toEqual(receipt);
   expect(V.MutationReceiptSchema.safeParse({...receipt,status:null}).success).toBe(false);
   const event={seq:1,projectId:id,runId:MOCK_IDS.run,attempt:1,at:'2026-10-23T00:00:00Z',type:'result',kind:'storyboard',version:1};
   expect(V.EngineEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
   expect(V.EngineEventSchema.safeParse({...event,session_id:'공개금지'}).success).toBe(false);
 });
 it('ready/최종승인·근거·교차 프로젝트 불변 조건을 검사한다',()=>{
   const p=createMockSnapshot('export');
   expect(V.ProjectSnapshotSchema.safeParse(p).success).toBe(true);
   const stale=structuredClone(p);stale.result!.version=2;
   expect(V.ProjectSnapshotSchema.safeParse(stale).success).toBe(false);
   const missingEvidence=createMockSnapshot('review');
   missingEvidence.claims=[{text:'근거 없는 모의 사실',sourceIds:[MOCK_IDS.source],kind:'verified',availability:'unknown',conditions:[]}];
   expect(V.ProjectSnapshotSchema.safeParse(missingEvidence).success).toBe(false);
   missingEvidence.sources[0]!.access='opened';missingEvidence.sources[0]!.evidence='모의 원문 근거';
   expect(V.ProjectSnapshotSchema.safeParse(missingEvidence).success).toBe(true);
   missingEvidence.lastRun!.projectId=MOCK_IDS.candidate;
   expect(V.ProjectSnapshotSchema.safeParse(missingEvidence).success).toBe(false);
 });
 it.each(['1080x1080','1080x1350'] as const)('render 입력과 출력 크기를 왕복한다: %s',size=>{
   const p=createMockSnapshot('review');const card=p.result!.cards[0]!;
   const input:C.RenderInput={projectId:id,runId:MOCK_IDS.run,attempt:1,resultVersion:1,card,size,image:{assetId:MOCK_IDS.image,absolutePath:'C:/모의/image.png',sha256:'a'.repeat(64)},researchAt:p.period.anchorAt,sourceLabels:[{sourceId:MOCK_IDS.source,label:'모의 출처',url:'https://example.org/mock-report'}],font:{family:'Noto Sans KR',absolutePath:'C:/모의/NotoSansKR.woff2',licenseAssetId:MOCK_IDS.image},templateVersion:'cn-basic-1',outputPath:'C:/모의/preview.png'};
   expect(V.RenderInputSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
   const output:C.RenderOutput={projectId:id,resultVersion:1,cardId:card.cardId,cardRevision:1,path:input.outputPath,mimeType:'image/png',width:1080,height:size==='1080x1080'?1080:1350,sha256:'b'.repeat(64),bytes:100,checks:{fontLoaded:true,imageDecoded:true,overflow:false},warnings:[]};
   expect(V.RenderOutputSchema.parse(output)).toEqual(output);
   expect(V.RenderOutputSchema.safeParse({...output,width:540}).success).toBe(false);
 });
 it.each(['not a url','javascript:alert(1)','https://[::1]','https://localhost/','https://x.internal/'])('잘못된 원문 URL을 예외 없이 거절한다: %s',url=>{
   expect(()=>V.PublicUrlSchema.safeParse(url)).not.toThrow();
   expect(V.PublicUrlSchema.safeParse(url).success).toBe(false);
 });
 it('CN-1은 아직 내용이 없는 cards 배열도 DTO로 표현한다',()=>{
   const p=createMockSnapshot('storyboard');p.storyboard!.cards=[];
   expect(V.StoryboardSchema.safeParse(p.storyboard).success).toBe(true);
   const r=createMockSnapshot('review').result!;r.cards=[];
   expect(V.ResultVersionSchema.safeParse(r).success).toBe(true);
 });
 it('순환 JSON과 sparse 배열을 거절한다',()=>{
   const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
   expect(()=>V.canonicalJson(cyclic)).toThrow();
   expect(()=>V.canonicalJson(Array(2))).toThrow();
 });
});
