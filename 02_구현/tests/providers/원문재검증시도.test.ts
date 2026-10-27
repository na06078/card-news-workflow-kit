import {it,expect,vi} from 'vitest';
import {resolve} from 'node:path';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../src/providers/클로드.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import type {EngineContext,EventDraft,EngineEvent,FactProposalDraft,ProviderBridge} from '../../src/shared/포트.js';
const at='2026-10-26T00:00:00Z',sid='11111111-1111-4111-8111-111111111111';
async function run(attempted:boolean){
 const p=createMockSnapshot('storyboard');p.sources[0]!.evidence='[합성] 이전 실행에서만 읽은 문장';p.sources[0]!.access='opened';p.sources[0]!.accessedAt=at;p.claims=[{text:'원문을 확인할 주장',sourceIds:[I.source],kind:'uncertain',availability:'unknown',conditions:[]}];
 p.factReview={runId:I.run,baseVersion:p.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[I.card],state:'pending',readyVersion:null,proposal:null};
 const draft:FactProposalDraft={kind:'factReview',sources:[],cards:[],findings:[{claimIndex:0,cardIds:[],classification:'unverifiable',reason:'새 관측 없음',afterClaim:{...p.claims[0]!,sourceIds:[]},comparisons:[]}]};
 let seq=0,promptText='';const event=(e:EventDraft)=>({...e,seq:++seq,projectId:I.project,runId:I.run,attempt:1,at}) as EngineEvent;
 const bridge:ProviderBridge={progress:vi.fn(async(_c,e)=>event(e)),publishResult:vi.fn(async(_c,c)=>event({type:'result',kind:c.kind,version:1})),publishError:vi.fn(async(_c,error)=>event({type:'error',error})),saveSession:vi.fn(async()=>{}),openQuestion:vi.fn(),waitForAnswer:vi.fn(),status:vi.fn()};
 const query:QueryFactory=({prompt,options})=>Object.assign((async function*(){
  if(typeof prompt!=='string')for await(const m of prompt)promptText+=m.message.content;
  yield {type:'system',subtype:'init',session_id:sid,cwd:options!.cwd,tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'} as any;
  if(attempted){const url=p.sources[0]!.url;yield {type:'assistant',session_id:sid,message:{content:[{type:'tool_use',name:'WebFetch',id:'f1',input:{url}}]}} as any;yield {type:'user',session_id:sid,message:{content:[{type:'tool_result',tool_use_id:'f1',is_error:true,content:'공식 도구의 접근 거절 대역'}]},tool_use_result:{url,code:403,codeText:'Forbidden',bytes:9,result:'blocked',durationMs:1}} as any;}
  yield {type:'result',subtype:'success',session_id:sid,is_error:false,permission_denials:[],structured_output:draft} as any;
 })(),{close:vi.fn()});
 const a=createOfflineClaudeAdapter({bridge,clock:()=>at,livePermission:{inference:false,search:false,image:false}},query);const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:resolve('.'),phase:'factReview',baseProjectVersion:p.projectVersion};
 const events=[];try{for await(const e of a.start(context,{snapshot:p}))events.push(e);}finally{await a.dispose();}
 return {events,bridge,promptText,url:p.sources[0]!.url,originalSource:p.sources[0]};
}
it('원문 도구0회로 만든 전체 확인 불가 후보는 다음 의미 검수용 성공으로 넘기지 않는다',async()=>{
 const {events,bridge}=await run(false);expect(events.at(-1)).toMatchObject({type:'error',error:{code:'FACT_FETCH_NOT_ATTEMPTED'}});expect(bridge.publishResult).not.toHaveBeenCalled();
});
it('실제로 원문 확인이 거절된 경우는 시도 부재와 구분하고 확인 불가를 보존한다',async()=>{
 const {events,bridge}=await run(true);expect(events.at(-1)).toMatchObject({type:'result',kind:'factReview'});expect(bridge.publishResult).toHaveBeenCalledOnce();
});
it('원문 재확인은 제공된 관측을 기다리는 작업이 아니라 명시 WebFetch 선행 작업이다',async()=>{
 const {promptText,url}=await run(true);expect(promptText).toContain('먼저 WebFetch');expect(promptText).toContain(url);expect(promptText).toContain('HTTP 상태·bytes는 앱이');
});
it('이전 인용을 새 관측으로 복사하지 못하도록 조사 입력에서만 비우고 엄격한 출력 형식을 명시한다',async()=>{
 const {promptText,originalSource,url}=await run(true),projected=JSON.parse(promptText.slice(promptText.lastIndexOf('\n')+1));
 expect(projected.snapshot.sources[0]).toMatchObject({evidence:null,access:'not_opened',accessedAt:null,url});expect(originalSource).toMatchObject({evidence:'[합성] 이전 실행에서만 읽은 문장',access:'opened',accessedAt:at});
 expect(promptText).toContain('WebFetch 처리 결과 전체를 그대로');expect(promptText).toContain('매체명 표기·번역 국가명의 문자 일치로 의미를 판정하지 않습니다');expect(promptText).toContain('unverifiable 항목의 comparisons는 빈 배열');
});
