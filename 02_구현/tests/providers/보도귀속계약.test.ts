import {it,expect} from 'vitest';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {FactReviewContentSchema,type FactProposalDraft} from '../../src/shared/포트.js';
import {captureFetchReceipt,validateFactReview} from '../../src/providers/사실재검증.js';
import {validateFactScope} from '../../src/backend/사실복구.js';
const at='2026-10-26T00:00:00Z',id='11111111-1111-4111-8111-111111111111',url='https://example.org/attribution';
function fixture(){
 const p=createMockSnapshot('storyboard'),text='[합성] 수치는 10이다.',claim='매체 (통신사)의 보도에서는 합성 수치를 10으로 전한다.';p.claims=[{text:'합성 기존 문장',kind:'uncertain',sourceIds:[I.source],availability:'unknown',conditions:[]}];
 p.factReview={runId:I.run,baseVersion:p.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[I.card],state:'pending',readyVersion:null,proposal:null};
 const draft:FactProposalDraft={kind:'factReview',sources:[{...p.sources[0]!,sourceId:id,url,publisher:'매체 (통신사)',access:'opened',accessedAt:at,evidence:text}],findings:[{claimIndex:0,cardIds:[I.card],classification:'supported',reason:'합성 보도 귀속 표현',afterClaim:{text:claim,kind:'publisher_claim',sourceIds:[id],availability:'unknown',conditions:[]},comparisons:[]}],cards:[{cardId:I.card,title:'합성',body:claim,sourceIds:[id]}]};
 const receipt=captureFetchReceipt('f1',url,{url,code:200,codeText:'OK',bytes:30,result:text,durationMs:1},false,at),{result:_result,...observation}=receipt;
 return {p,draft,receipt,content:()=>FactReviewContentSchema.parse({...draft,observations:[{...observation,sourceId:id}]})};
}
it('수집 형식은 매체명과 보도 귀속을 보존한 문장을 의미 검수 전에 오차단하지 않는다',()=>{const f=fixture();expect(()=>validateFactReview(f.draft,f.p,[f.receipt])).not.toThrow();});
it('동일 보도 귀속 표현을 저장/적용 범위 검사도 받아들인다',()=>{const f=fixture();expect(()=>validateFactScope(f.p,f.p.factReview!,f.content())).not.toThrow();});
it.each(['Al Jazeera는 합성 수치를 열 명으로 전했다.','합성 수치는 10이다.'])('매체 별칭·귀속·숫자 표현의 의미는 독립 검수 대상으로 남긴다: %s',text=>{const f=fixture();f.draft.sources[0]!.publisher='Al Jazeera (AFP)';f.draft.findings[0]!.afterClaim.text=text;f.draft.cards[0]!.body=text;f.draft.findings[0]!.comparisons=[{sourceId:id,country:null,event:null,period:null,population:null,metric:null,unit:null,value:'10',aggregation:'unknown',provisional:null}];expect(validateFactReview(f.draft,f.p,[f.receipt])).toMatchObject({sources:[{publisher:'Al Jazeera (AFP)'}]});expect(()=>validateFactScope(f.p,f.p.factReview!,f.content())).not.toThrow();expect(f.content().semanticReview).toBeUndefined();});
