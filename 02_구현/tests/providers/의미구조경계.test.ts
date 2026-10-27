import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {captureFetchReceipt,validateFactReview} from '../../src/providers/사실재검증.js';
import {beginFactReview,validateFactScope} from '../../src/backend/사실복구.js';
import type {FactProposalDraft,ProjectSnapshot} from '../../src/shared/포트.js';
const at='2026-10-26T00:00:00Z',id='11111111-1111-4111-8111-111111111111';
function fixture(){
 const p=createMockSnapshot('storyboard');p.claims=[{text:'기존 합성 주장',kind:'uncertain',sourceIds:[I.source],availability:'unknown',conditions:[]}];p.factReview=beginFactReview(p,{requestId:I.run,version:p.projectVersion,claimIndices:[0],cardIds:[I.card]},I.run);
 const quote='In Italia dieci persone; a Roma nel 2025.';
 const source={...p.sources[0]!,sourceId:id,publisher:'Al Jazeera (AFP)',access:'opened' as const,accessedAt:at,evidence:quote};
 const text='알자지라가 전한 이탈리아의 열 명 집계다.';
 const draft:FactProposalDraft={kind:'factReview',sources:[source],cards:[{cardId:I.card,title:'번역',body:text,sourceIds:[id]}],findings:[{claimIndex:0,cardIds:[I.card],classification:'supported',reason:'합성 번역 후보',afterClaim:{...p.claims[0]!,text,sourceIds:[id],kind:'publisher_claim'},comparisons:[{sourceId:id,country:'Italy',event:null,period:'2025년',population:null,metric:null,unit:'명',value:'10',aggregation:'point_in_time',provisional:false}]}]};
 const receipts=[captureFetchReceipt('fake-http',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:quote,durationMs:1},false,at)];
 return {p,draft,receipts};
}
it('국가·집계·숫자 번역은 정확한 인용을 바꾸지 않고 독립 검수 입력 후보가 된다',()=>{
 const {p,draft,receipts}=fixture(),before=structuredClone(draft);const out=validateFactReview(draft,p,receipts);expect(out.kind).toBe('factReview');if(out.kind!=='factReview')throw Error('candidate');
 expect(out.sources[0]!.evidence).toBe(before.sources[0]!.evidence);expect(out.sources[0]!.publisher).toBe('Al Jazeera (AFP)');expect(out.findings[0]!.comparisons[0]!.country).toBe('Italy');expect(out.semanticReview).toBeUndefined();expect(()=>validateFactScope(p,p.factReview!,out)).not.toThrow();
});
it('범위 차이는 서로 다른 메타데이터를 유지하되 한국어 문장에 원문 토큰을 요구하지 않는다',()=>{
 const {p,draft,receipts}=fixture(),second='22222222-2222-4222-8222-222222222222';const s={...draft.sources[0]!,sourceId:second,url:'https://example.org/second',evidence:'France vingt personnes.'};draft.sources.push(s);receipts.push(captureFetchReceipt('fake-second',s.url,{url:s.url,code:200,codeText:'OK',bytes:100,result:s.evidence,durationMs:1},false,at));
 const f=draft.findings[0]!;f.classification='scope_difference';f.afterClaim.text='이탈리아와 프랑스의 서로 다른 집계다.';f.afterClaim.sourceIds.push(second);f.comparisons.push({...f.comparisons[0]!,sourceId:second,country:'France',value:'20'});draft.cards[0]!.body=f.afterClaim.text;draft.cards[0]!.sourceIds.push(second);
 const out=validateFactReview(draft,p,receipts);if(out.kind!=='factReview')throw Error('candidate');expect(()=>validateFactScope(p,p.factReview!,out)).not.toThrow();
});
it('실제 요청4 후보 재생: HTTP 메타데이터 미복원과 명시 합성 2xx 양성 대조군을 구분한다',()=>{
 const file=new URL('../../실행데이터/실사용검수복구/수집재생/023c9bab-ba33-4949-acf1-24f3f4655639/검증입력.json',import.meta.url);
 const record=JSON.parse(readFileSync(file,'utf8')) as {snapshot:ProjectSnapshot;draft:FactProposalDraft;receipts:ReturnType<typeof captureFetchReceipt>[];receiptLimit:string};
 expect(record.receiptLimit).toContain('strips native HTTP metadata');expect(()=>validateFactReview(record.draft,record.snapshot,record.receipts)).toThrow(expect.objectContaining({code:'FACT_REVIEW_FAILED'}));
 // getSessionMessages에서 200/bytes를 복원한 것이 아닙니다. 저장된 실제 후보/인용 + 합성 HTTP envelope만 사용합니다.
 const synthetic=record.draft.sources.map((s,i)=>captureFetchReceipt(`synthetic-http-${i}`,s.url,{url:s.url,code:s.evidence?200:403,codeText:s.evidence?'OK':'Forbidden',bytes:s.evidence?100:0,result:s.evidence??'',durationMs:1},false,at));
 const out=validateFactReview(record.draft,record.snapshot,synthetic);if(out.kind!=='factReview')throw Error('candidate');expect(out.semanticReview).toBeUndefined();expect(out.sources.some(s=>s.publisher==='Al Jazeera (AFP)')).toBe(true);expect(()=>validateFactScope(record.snapshot,record.snapshot.factReview!,out)).not.toThrow();
});
