import {test,expect,vi} from 'vitest';
import type {Options,SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import type {EngineContext,ProviderBridge,EngineEvent,EventDraft} from '../../src/shared/포트.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import {createOfflineClaudeAdapter,type QueryFactory} from '../../src/providers/클로드.js';
test.each(['throw','result'] as const)('명시 모델 접근 거절은 안전한 모델 오류로 끝나며 fallback query가 없다 (%s)',async(mode)=>{
 process.env.CARDNEWS_LIVE_CALLS='forbidden';const b=bridge();const fake:QueryFactory=vi.fn(()=>{const message='There is an issue with the selected model (SECRET). It may not exist or you may not have access to it.';if(mode==='throw')throw Error(message);return Object.assign((async function*(){yield {type:'result',subtype:'error_during_execution',session_id:session,errors:[message],is_error:true} as unknown as SDKMessage;})(),{close(){}});});
 const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},fake);try{const events=[];for await(const e of a.start({...context,requestedModel:'model-a'},{snapshot:createMockSnapshot('selection')}))events.push(e);expect(events.at(-1)).toMatchObject({type:'error',error:{code:'MODEL_UNAVAILABLE'}});expect(JSON.stringify(events)).not.toContain('SECRET');expect(fake).toHaveBeenCalledOnce();}finally{await a.dispose();}
});
const context:EngineContext={projectId:I.project,runId:I.run,attempt:1,engine:'claude-agent-sdk',engineSessionId:null,cwd:process.cwd(),phase:'research',baseProjectVersion:2};
const permission={inference:false,search:false,image:false} as const;
const session='11111111-1111-4111-8111-111111111111';
function bridge(){let seq=0;const event=(draft:EventDraft):EngineEvent=>({...draft,seq:++seq,projectId:I.project,runId:I.run,attempt:1,at:'2026-10-24T00:00:00Z'});
 return {progress:vi.fn(async(_c,d)=>event(d)),openQuestion:vi.fn(),waitForAnswer:vi.fn(),publishResult:vi.fn(),publishError:vi.fn(async(_c,e)=>event({type:'error',error:e})),saveSession:vi.fn(async()=>{}),status:vi.fn()} satisfies ProviderBridge;
}
test('고정된 요청 모델만 SDK 옵션에 전달하고 init 관측 모델을 별도로 중계한다',async()=>{
 process.env.CARDNEWS_LIVE_CALLS='forbidden';
 for(const model of ['model-a',null,undefined]){
 let captured:Options|undefined;const b=bridge();
 const fake:QueryFactory=({options})=>{captured=options;return Object.assign((async function*(){yield {type:'system',subtype:'init',session_id:session,cwd:process.cwd(),tools:['WebSearch','WebFetch'],mcp_servers:[],permissionMode:'default',apiKeySource:'none',model:'model-a-resolved',claude_code_version:'offline',slash_commands:[],output_style:'default',skills:[],plugins:[],uuid:'11111111-1111-4111-8111-111111111112'} as SDKMessage;})(),{close(){}});};
 const a=createOfflineClaudeAdapter({bridge:b,livePermission:permission},fake);
 try{for await(const _ of a.start({...context,requestedModel:model},{snapshot:createMockSnapshot('selection')})){}
 if(model)expect(captured?.model).toBe(model);else expect(captured).not.toHaveProperty('model');expect(captured).not.toHaveProperty('fallbackModel');
 expect(b.progress.mock.calls.some(([,d])=>d.type==='progress'&&d.actualModel==='model-a-resolved')).toBe(true);
 const hook=captured!.hooks!.PreModelSwitch![0]!.hooks[0]!;expect(await hook({hook_event_name:'PreModelSwitch'} as never,undefined,{signal:new AbortController().signal})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 }finally{await a.dispose();}
 }
});
