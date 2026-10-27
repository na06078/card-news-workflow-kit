import {it,expect,vi} from 'vitest';
import type {Options,SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import type {EngineContext,ProviderBridge,EngineEvent,EventDraft,FactProposalDraft} from '../../src/shared/포트.js';
const fake=vi.hoisted(()=>({query:vi.fn(),preflight:vi.fn(async()=>{}),metadata:vi.fn()}));
// 明示 DI: 실제 SDK query/계정 preflight/OS 프로세스 조회를 전부 대역으로 대체.
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:fake.query}));
vi.mock('../../src/providers/구독검증.js',()=>({subscriptionPreflight:fake.preflight,inspectAccountMetadata:fake.metadata}));
vi.mock('../../src/providers/프로세스격리.js',()=>({ownedDescendantsExited:async()=>true}));
import {createClaudeAdapter} from '../../src/providers/클로드.js';
it('production factory도 동일 factReview 연결을 사용한다 — SDK/계정/OS 전부 DI, 실호출 0',async()=>{
 const s=createMockSnapshot('storyboard'),at='2026-10-26T00:00:00Z',newId='11111111-1111-4111-8111-111111111111',url='https://example.com/report',text='발표된 수치는 10이다.';
 s.dataMode='real'; // production 입력 가드만 검사, 외부 의존성은 위의 명시 fake만 사용.
 s.claims=[{text:'원래 문장',sourceIds:[I.source],kind:'uncertain',availability:'unknown',conditions:[]}];s.factReview={runId:I.run,baseVersion:s.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[I.card],state:'pending',readyVersion:null,proposal:null};
 const draft:FactProposalDraft={kind:'factReview',sources:[{...s.sources[0]!,sourceId:newId,url,evidence:text}],findings:[{claimIndex:0,cardIds:[I.card],classification:'supported',reason:'관측 결과',afterClaim:{...s.claims[0]!,text,kind:'verified',sourceIds:[newId]},comparisons:[]}],cards:[{cardId:I.card,title:'제안',body:text,sourceIds:[newId]}]};
 const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'factReview',baseProjectVersion:s.projectVersion};let seq=0;
 const event=(d:EventDraft)=>({...d,seq:++seq,at,projectId:I.project,runId:I.run,attempt:1}) as EngineEvent;
 const bridge:ProviderBridge={progress:async(_c,d)=>event(d),saveSession:async()=>{},publishResult:vi.fn(async(_c,c)=>event({type:'result',kind:c.kind,version:1})),publishError:vi.fn(async(_c,error)=>event({type:'error',error})),openQuestion:vi.fn(),waitForAnswer:vi.fn(),status:vi.fn()};
 fake.query.mockImplementation(({prompt,options}:{prompt:AsyncIterable<any>;options:Options})=>Object.assign((async function*(){for await(const _ of prompt){};
 expect(options.tools).toEqual(['WebSearch','WebFetch']);expect(options.outputFormat!.schema).toMatchObject({type:'object',additionalProperties:false});
 yield {type:'system',subtype:'init',session_id:newId,cwd:process.cwd(),tools:['WebSearch','WebFetch','StructuredOutput'],mcp_servers:[],permissionMode:'default',apiKeySource:'none'};
 yield {type:'assistant',session_id:newId,message:{content:[{type:'tool_use',name:'WebFetch',id:'fetch',input:{url}}]}};
 yield {type:'user',session_id:newId,message:{content:[{type:'tool_result',tool_use_id:'fetch',content:'not raw html'}]},tool_use_result:{url,code:200,codeText:'OK',bytes:40,durationMs:2,result:text}};
 yield {type:'result',subtype:'success',session_id:newId,is_error:false,structured_output:draft};
 })() as AsyncGenerator<SDKMessage>,{close:vi.fn(),initializationResult:async()=>({account:{}}),accountInfo:async()=>({})}));
 const a=createClaudeAdapter({bridge,clock:()=>at,livePermission:{inference:false,search:false,image:false}});const events=[];for await(const e of a.start(context,{snapshot:s}))events.push(e);await a.dispose();
 expect(events.at(-1)).toMatchObject({type:'result',kind:'factReview'});expect(fake.query).toHaveBeenCalledOnce();expect(fake.preflight).toHaveBeenCalledOnce();expect(fake.metadata).toHaveBeenCalledTimes(2);expect(bridge.publishResult).toHaveBeenCalledWith(context,expect.objectContaining({observations:[expect.objectContaining({sourceId:newId,toolUseId:'fetch',outcome:'opened'})]}));
});
