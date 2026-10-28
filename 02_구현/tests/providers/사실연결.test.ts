import {it,expect,vi} from 'vitest';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {contentSchemaFor,validateContent} from '../../src/providers/조사검증.js';
import {captureFetchReceipt} from '../../src/providers/사실재검증.js';
import {buildSemanticReviewInput,semanticInputHash,validateSemanticReport} from '../../src/providers/검수내용.js';
import {DEFAULT_FACT_REVIEWER,type SemanticReviewReport} from '../../src/shared/포트.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../src/providers/클로드.js';
import type {EngineContext,EngineContent,ProviderBridge,EventDraft,EngineEvent,FactProposalDraft} from '../../src/shared/포트.js';
const at='2026-10-26T00:00:00Z',id='11111111-1111-4111-8111-111111111111',url='https://example.com/report',text='공식 수치는 10이다.';
function fixture(){const s=createMockSnapshot('storyboard');s.claims=[{text:'수치는 20이다.',sourceIds:[I.source],kind:'uncertain',availability:'released',conditions:[]}];s.factReview={runId:I.run,baseVersion:s.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[I.card],state:'pending',readyVersion:null,proposal:null};
const source={...s.sources[0]!,sourceId:id,url,publisher:'기관',access:'opened' as const,accessedAt:at,evidence:text};
const draft:FactProposalDraft={kind:'factReview' as const,sources:[source],findings:[{claimIndex:0,cardIds:[I.card],classification:'factual_error' as const,reason:'관측 자료로 정정',afterClaim:{...s.claims[0]!,text,sourceIds:[id],kind:'verified' as const},comparisons:[]}],cards:[{cardId:I.card,title:'정정',body:text,sourceIds:[id]}]};return {s,draft};}

function scopeFixture(){const {s,draft}=fixture();const second='22222222-2222-4222-8222-222222222222';draft.sources.push({...draft.sources[0]!,sourceId:second,url:'https://example.com/second',evidence:'한국 2025 누적 20'});draft.sources[0]!.evidence='미국 2026 시점 10';
 const comparison={sourceId:id,country:'미국',event:null,period:'2026',population:null,metric:null,unit:null,value:'10',aggregation:'unknown' as const,provisional:null};
 const comparisons=[comparison,{...comparison,sourceId:second,country:'한국',period:'2025',value:'20'}];
 const f=draft.findings[0]!;f.classification='scope_difference' as never;f.comparisons=comparisons;f.afterClaim.text='미국 2026 10과 한국 2025 20은 범위가 다르다.';f.afterClaim.sourceIds.push(second);draft.cards[0]!.body=f.afterClaim.text;draft.cards[0]!.sourceIds.push(second);
 const rs=[captureFetchReceipt('f1',url,{url,code:200,codeText:'OK',bytes:30,result:draft.sources[0]!.evidence,durationMs:1},false,at),captureFetchReceipt('f2',draft.sources[1]!.url,{url:draft.sources[1]!.url,code:200,codeText:'OK',bytes:30,result:draft.sources[1]!.evidence,durationMs:1},false,at)];return {s,draft,rs};}
it('scope_difference는 관측한 범위 차이를 발행 문장에 보존한다',()=>{const {s,draft,rs}=scopeFixture();expect(validateContent(draft,s,'factReview',undefined,rs).kind).toBe('factReview');});
it.each(['one-source','unknown','same'])('scope_difference 라벨만으로 통과 금지 %s',mode=>{const {s,draft,rs}=scopeFixture(),f=draft.findings[0]!;
 if(mode==='one-source')f.comparisons.pop();
 if(mode==='unknown')for(const c of f.comparisons){c.country=null;c.period=null;}
 if(mode==='same')f.comparisons[1]={...f.comparisons[0]!,sourceId:draft.sources[1]!.sourceId};
 expect(()=>validateContent(draft,s,'factReview',undefined,rs)).toThrow();
});
it.each(['invisible','invented','no-attribution','missing-value'])('의미 차이 %s 후보는 독립 검수 전 사실 통과로 승격하지 않는다',mode=>{const {s,draft,rs}=scopeFixture(),f=draft.findings[0]!;
 if(mode==='invisible')f.afterClaim.text='수치가 서로 다르다.';
 if(mode==='invented')f.comparisons[1]!.country='독일';
 if(mode==='no-attribution'||mode==='missing-value'){f.classification='explained_discrepancy';f.afterClaim.kind='publisher_claim';f.afterClaim.text=mode==='no-attribution'?'미국 2026 10 한국 2025 20이다.':'기관 발표 수치는 10이다.';}
 draft.cards[0]!.body=f.afterClaim.text;const candidate=validateContent(draft,s,'factReview',undefined,rs);expect(candidate.kind).toBe('factReview');if(candidate.kind!=='factReview')throw Error('TEST_FACT_CANDIDATE_REQUIRED');expect(candidate.semanticReview).toBeUndefined();
 const input=buildSemanticReviewInput(s,candidate);expect(()=>validateSemanticReport(undefined,input,DEFAULT_FACT_REVIEWER)).toThrow(expect.objectContaining({code:'FACT_REVIEW_FAILED'}));
});
it.each(['verified'])('발표자 주장/상충 수치 설명 경계 %s',mode=>{const {s,draft,rs}=scopeFixture(),f=draft.findings[0]!;f.classification='explained_discrepancy' as never;f.afterClaim.kind='publisher_claim' as never;f.afterClaim.text='기관 발표에 따르면 미국 2026 10, 한국 2025 20이다.';
 if(mode==='verified')f.afterClaim.kind='verified';draft.cards[0]!.body=f.afterClaim.text;
 expect(()=>validateContent(draft,s,'factReview',undefined,rs)).toThrow();
});


it.each(['orphan','ok','wrong-id','wrong-url','missing-receipt','failed','empty','text-only','question','app-fields','duplicate-result','detached','illegal-stream','ambiguous-results'])('fake SDK→adapter→factReview 연결 %s',async mode=>{
 const {s,draft}=fixture();if(mode==='orphan'){const second={...s.storyboard!.cards[0]!,cardId:'22222222-2222-4222-8222-222222222222',order:2};s.storyboard!.cards.push(second);s.factReview!.cardIds.push(second.cardId);draft.cards.push({...draft.cards[0]!,cardId:second.cardId});}const before=JSON.stringify(s);const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'factReview',baseProjectVersion:s.projectVersion};
 let seq=0;const event=(d:EventDraft)=>({...d,seq:++seq,projectId:I.project,runId:I.run,attempt:1,at}) as EngineEvent;
 const bridge={saveFactCheckpoint:vi.fn(async()=>{}),progress:vi.fn(async(_c,d)=>event(d)),saveSession:vi.fn(async()=>{}),publishResult:vi.fn(async(_c,content:EngineContent)=>event(content.kind==='revision'?{type:'progress',phase:'revision',message:'수정 결정 준비',completed:null,total:null}:{type:'result',kind:content.kind,version:1})),publishError:vi.fn(async(_c,error)=>event({type:'error',error})),openQuestion:vi.fn(),waitForAnswer:vi.fn(),status:vi.fn()} satisfies ProviderBridge;
 const output={url:mode==='wrong-url'?'https://example.com/wrong':url,code:200,codeText:'OK',bytes:mode==='empty'?0:24,result:text,durationMs:1};
 let opts:any,promptText='';const query:QueryFactory=({prompt,options})=>{opts=options;return Object.assign((async function*(){if(typeof prompt!=='string')for await(const m of prompt)promptText+=m.message.content;yield {type:'system',subtype:'init',session_id:id,cwd:process.cwd(),tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'} as any;
 if(mode==='question'){expect(await options!.canUseTool!('AskUserQuestion',{}, {signal:new AbortController().signal,toolUseID:'q',requestId:'q'})).toMatchObject({behavior:'deny'});}
 if(mode==='illegal-stream')yield {type:'assistant',session_id:id,message:{content:[{type:'tool_use',id:'q1',name:'AskUserQuestion',input:{}}]}} as any;
 yield {type:'assistant',session_id:id,message:{content:[{type:'tool_use',id:'f1',name:'WebFetch',input:{url}}]}} as any;
 yield {type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:mode==='wrong-id'?'other':'f1',is_error:mode==='failed',content:JSON.stringify(output)},...(mode==='ambiguous-results'?[{type:'tool_result',tool_use_id:'other',content:'other'}]:[])]},tool_use_result:mode==='missing-receipt'?undefined:mode==='detached'?{...output,detachedToolCall:true}:mode==='text-only'?JSON.stringify(output):output} as any;
 if(mode==='duplicate-result')yield {type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:'f1',content:'duplicate'}]},tool_use_result:output} as any;
 yield {type:'result',subtype:'success',session_id:id,is_error:false,permission_denials:[],structured_output:mode==='app-fields'?{...draft,observations:[]}:draft} as any;
 })(),{close:vi.fn()});};
 const adapter=createOfflineClaudeAdapter({bridge,clock:()=>at,livePermission:{inference:false,search:false,image:false}},query);const events=[];for await(const e of adapter.start(context,{snapshot:s}))events.push(e);await adapter.dispose();
 const success=mode==='ok'||mode==='question'||mode==='duplicate-result';expect(events.at(-1)?.type).toBe(success?'result':'error');
 if(success){expect(bridge.publishResult).toHaveBeenCalledWith(context,expect.objectContaining({kind:'factReview',observations:[expect.objectContaining({toolUseId:'f1',requestedUrl:url,outcome:'opened'})]}));expect(opts.tools).toEqual(['WebSearch','WebFetch']);expect(promptText).toContain('factReview');expect(promptText).toContain('observations');expect(bridge.openQuestion).not.toHaveBeenCalled();}else expect(bridge.publishResult).not.toHaveBeenCalled();
 if(mode==='orphan')expect(bridge.saveFactCheckpoint).toHaveBeenCalledWith(context,expect.objectContaining({step:'links',draft,receipts:[expect.objectContaining({result:text})],issues:[expect.objectContaining({code:'FACT_CARD_LINK_MISSING'})]}));
 expect(JSON.stringify(s)).toBe(before);expect(JSON.stringify(events)).not.toContain(text);
});


it('explained_discrepancy 비교 없는 라벨은 거절한다',()=>{const {s,draft}=fixture();const f=draft.findings[0]!;f.classification='explained_discrepancy' as never;f.afterClaim.kind='publisher_claim' as never;f.afterClaim.text='기관 발표에 따르면 10이다.';draft.cards[0]!.body=f.afterClaim.text;expect(()=>validateContent(draft,s,'factReview',undefined,[receipt()])).toThrow();});
it('관측한 서로 다른 발표 수치는 귀속을 보존한 publisher_claim만 허용한다',()=>{const {s,draft,rs}=scopeFixture();const f=draft.findings[0]!;f.classification='explained_discrepancy' as never;f.afterClaim.kind='publisher_claim' as never;f.afterClaim.text='기관 발표에 따르면 미국 2026 10, 한국 2025 20이다.';draft.cards[0]!.body=f.afterClaim.text;expect(validateContent(draft,s,'factReview',undefined,rs)).toMatchObject({findings:[{afterClaim:{kind:'publisher_claim'}}]});});
it('각 영수증은 자기 처리 결과와 인용이 일치해야 opened다',()=>{const {s,draft}=fixture();const r=captureFetchReceipt('f2',url,{url,code:200,codeText:'OK',bytes:5,result:'다른 내용',durationMs:1},false,at);const out=validateContent(draft,s,'factReview',undefined,[receipt(),r]);expect(out).toMatchObject({observations:[{toolUseId:'f1',outcome:'opened'},{toolUseId:'f2',outcome:'unconfirmed'}]});});

it('앱 결합 결과도 shared 관측 계약 상한을 지킨다',()=>{const {s,draft}=fixture();expect(()=>validateContent(draft,s,'factReview',undefined,Array.from({length:101},(_,i)=>({...receipt(),toolUseId:`f${i}`})))).toThrow();});
const receipt=()=>captureFetchReceipt('f1',url,{url,code:200,codeText:'OK',bytes:24,result:text,durationMs:1},false,at);
it('factReview는 strict object이며 앱 필드를 모델에서 받지 않는다',()=>{const {draft}=fixture();const schema=contentSchemaFor('factReview');expect(schema.safeParse(draft).success).toBe(true);expect(schema.safeParse({...draft,observations:[]}).success).toBe(false);});
it('관측 인용을 결합하되 원래 snapshot은 바꾸지 않는다',()=>{const {s,draft}=fixture(),before=JSON.stringify(s);const out=validateContent(draft,s,'factReview',undefined,[receipt()]);expect(out).toMatchObject({kind:'factReview',observations:[{sourceId:id,outcome:'opened'}]});expect(JSON.stringify(s)).toBe(before);});
it.each([
 {kind:'verified' as const,withComparison:false},
 {kind:'verified' as const,withComparison:true},
 {kind:'publisher_claim' as const,withComparison:false},
 {kind:'publisher_claim' as const,withComparison:true},
])('10의 검토 기록으로 999 발행문을 승인할 수 없다 $kind / 비교=$withComparison',({kind,withComparison})=>{
 const control=fixture(),candidate=validateContent(control.draft,control.s,'factReview',undefined,[receipt()]);expect(candidate.kind).toBe('factReview');
 if(candidate.kind!=='factReview')throw Error('TEST_FACT_CANDIDATE_REQUIRED');
 const input=buildSemanticReviewInput(control.s,candidate);
 const report:SemanticReviewReport={reviewer:{...DEFAULT_FACT_REVIEWER},actualModel:DEFAULT_FACT_REVIEWER.model,reviewedAt:at,inputHash:semanticInputHash(input),verdict:'supported',reviewedCardIds:input.cards.map(c=>c.cardId),reviewedClaimIndices:input.claims.map(c=>c.claimIndex),issues:[]};
 expect(validateSemanticReport(report,input,DEFAULT_FACT_REVIEWER)).toEqual(report);
 const {s,draft}=fixture(),finding=draft.findings[0]!;finding.afterClaim.kind=kind;finding.afterClaim.text=kind==='publisher_claim'?'기관 발표에 따르면 공식 수치는 999이다.':'공식 수치는 999이다.';draft.cards[0]!.body=finding.afterClaim.text;
 if(withComparison)finding.comparisons=[{sourceId:id,country:null,event:null,period:null,population:null,metric:null,unit:null,value:'10',aggregation:'unknown',provisional:null}];
 const changedCandidate=validateContent(draft,s,'factReview',undefined,[receipt()]);expect(changedCandidate.kind).toBe('factReview');
 // 후보의 스키마 통과는 의미 검수 완료가 아니다. 앱 소유 기록을 변경된 발행 내용에 재사용하지 못하게 한다.
 expect(()=>validateSemanticReport(report,buildSemanticReviewInput(s,draft),DEFAULT_FACT_REVIEWER)).toThrow(expect.objectContaining({code:'FACT_REVIEW_FAILED'}));
});
it.each(['missing','quote','old-id','candidate','index','duplicate','extra-card','unlinked','no-selection'])('근거/선택 경계 거절 %s',mode=>{
 const {s,draft}=fixture();let receipts=[receipt()];
 if(mode==='missing')receipts=[];
 if(mode==='quote')draft.sources[0]!.evidence='없는 인용';
 if(mode==='old-id')draft.sources[0]!.sourceId=I.source;
 if(mode==='candidate')draft.sources[0]!.candidateId=I.project;
 if(mode==='index')draft.findings[0]!.claimIndex=1;
 if(mode==='duplicate')draft.findings.push(draft.findings[0]!);
 if(mode==='extra-card')draft.cards[0]!.cardId=I.project;
 if(mode==='unlinked')draft.findings[0]!.cardIds=[];
 // '모호한 정정' 반례는 worker/부분복구의 semantic transport에 보존합니다.
 if(mode==='no-selection')delete s.factReview;
 expect(()=>validateContent(draft,s,'factReview',undefined,receipts)).toThrow();
});
it('실패/차단 영수증은 불확실한 제안에 남고 verified를 지원하지 않는다',()=>{
 const {s,draft}=fixture();const r=captureFetchReceipt('f1',url,{url,code:403,codeText:'Forbidden',bytes:10,result:'blocked',durationMs:1},false,at);
 expect(()=>validateContent(draft,s,'factReview',undefined,[r])).toThrow();
 draft.findings[0]!.classification='unverifiable' as never;draft.findings[0]!.afterClaim.kind='uncertain' as never;draft.cards=[];
 const out=validateContent(draft,s,'factReview',undefined,[r]);expect(out).toMatchObject({sources:[{access:'blocked',accessedAt:at,evidence:null}],observations:[{outcome:'blocked',evidenceSha256:null}]});
});

