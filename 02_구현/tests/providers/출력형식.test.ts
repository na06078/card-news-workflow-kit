import {afterEach,expect,it,vi} from 'vitest';
import type {Options} from '@anthropic-ai/claude-agent-sdk';
import type {EngineContext,EngineEvent,ProviderBridge} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../src/providers/클로드.js';

afterEach(()=>vi.unstubAllEnvs());
it('실제 조사 어댑터는 SDK가 수락하는 단일 루트 object 출력 형식을 전달한다 — 외부 호출 없음',async()=>{
 vi.stubEnv('CARDNEWS_LIVE_CALLS','forbidden');
 const snapshot=createMockSnapshot('selection');
 const context:EngineContext={projectId:MOCK_IDS.project,runId:MOCK_IDS.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'research',baseProjectVersion:snapshot.projectVersion};
 let seq=0;const base=()=>({seq:++seq,projectId:context.projectId,runId:context.runId,attempt:1,at:'2026-10-23T00:00:00Z'});
 const bridge:ProviderBridge={
  progress:async(_c,event)=>({...base(),...event}),
  openQuestion:async(_c,input)=>({...base(),type:'need_input',question:input.question}),
  waitForAnswer:async()=>[],
  publishResult:async(_c,content)=>content.kind==='revision'?({...base(),type:'progress',phase:'revision',message:'수정 결정 준비',completed:null,total:null}):({...base(),type:'result',kind:content.kind,version:1}),
  publishError:async(_c,error)=>({...base(),type:'error',error}),
  saveSession:async()=>{},status:vi.fn(),
 };
 let captured:Options|undefined;
 const fake:QueryFactory=({prompt,options})=>{
  captured=options;
  return Object.assign((async function*(){if(typeof prompt!=='string')for await(const _ of prompt){};})() as AsyncGenerator<never>,{close:()=>{}});
 };
 const adapter=createOfflineClaudeAdapter({bridge,livePermission:{inference:false,search:false,image:false}},fake);
 const events:EngineEvent[]=[];for await(const event of adapter.start(context,{snapshot}))events.push(event);
 await adapter.dispose();
 expect(captured).toBeDefined();
 const schema=captured!.outputFormat!.schema as Record<string,unknown>;
 expect(schema.type).toBe('object');
 expect(schema).not.toHaveProperty('oneOf');
 expect(schema).not.toHaveProperty('anyOf');
 expect((schema.properties as Record<string,{const?:string}>).kind.const).toBe('candidates');
});
