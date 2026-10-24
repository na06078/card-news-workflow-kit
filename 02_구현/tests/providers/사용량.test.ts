import {describe,it,expect,vi} from 'vitest';
import {parseClaudeUsage,parseAgyUsage,parseModels,readProviderMetadata} from '../../src/providers/사용량.js';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const at='2026-10-24T00:00:00.000Z';
function fakeChild(){const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),pid:123,exitCode:null,signalCode:null,kill:vi.fn(()=>true)});return c;}
describe('metadata parsers',()=>{
 it('미적용 null 한도 창은 표시하지 않고 값이 없는 실제 창은 미확인으로 남긴다',()=>{
  const p=parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:5},seven_day:{utilization:null},seven_day_opus:null,seven_day_sonnet:null}},at);
  expect(p.metrics.map(m=>m.id)).toEqual(['five_hour','seven_day']);
  expect(p.metrics.map(m=>m.remainingPercent)).toEqual([95,null]);
 });
 it('blocks default real runners under offline guard',async()=>{
 const result=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd()});expect(result.models.status).toBe('error');expect(result.providers.every(p=>p.status==='error')).toBe(true);
 });
 it('does not treat malformed or missing quota windows as success',()=>{
 expect(parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:null},at).status).toBe('error');
 expect(parseAgyUsage({command:{data:{groups:[{name:'Gemini',buckets:null}]}}},at).status).toBe('error');
 });
 it('bounds child cleanup and does not claim success without close',async()=>{
 const child=fakeChild();const result=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),timeoutMs:10,cleanupMs:5,dependencies:{open:()=>({initializationResult:async()=>({account:{apiProvider:'firstParty',subscriptionType:'team'}}),accountInfo:async()=>({apiProvider:'firstParty',subscriptionType:'team'}),supportedModels:async()=>[],usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:async()=>({}),close:vi.fn()}),spawnProcess:vi.fn(()=>child) as any}});
 expect(child.kill).toHaveBeenCalled();expect(result.providers[1].status).toBe('error');
 });
 it('keeps returned scoped labels and normalizes microsecond UTC resets',()=>{
 const result=parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:{model_scoped:[{display_name:'Fable',utilization:5,resets_at:'2026-10-24T16:19:59.992293+00:00'}]}},at);
 expect(result.metrics[0].label).toContain('Fable');expect(result.metrics[0].resetsAt).toBe('2026-10-24T16:19:59.992Z');
 });
 it('does not call usage after cancellation while models are pending',async()=>{
 const controller=new AbortController();const usage=vi.fn();const open=()=>({initializationResult:async()=>({account:{apiProvider:'firstParty' as const,subscriptionType:'team'}}),accountInfo:async()=>({apiProvider:'firstParty' as const,subscriptionType:'team'}),supportedModels:async()=>{controller.abort();return [];},usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:usage,close:vi.fn()});
 await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),signal:controller.signal,dependencies:{open,runAgy:async()=>({})}});expect(usage).not.toHaveBeenCalled();
 });
 it('spawns only known SDK and agy paths, waits for own close and uses no shell',async()=>{
 const sdk=fakeChild(),agy=fakeChild();const spawnProcess=vi.fn((command:string,args:string[],opts:any)=>{expect(opts.shell).toBe(false);expect(opts.windowsHide).toBe(true);if(command.endsWith('agy.EXE')){expect(args).toEqual(['--print','/usage','--output-format','json']);queueMicrotask(()=>{agy.stdout.end(JSON.stringify({command:{data:{groups:[]}}}));agy.emit('close',0);});return agy;}expect(command.replaceAll('\\','/')).toContain('@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe');return sdk;});
 const open=(args:any)=>{args.options.spawnClaudeCodeProcess({command:args.options.pathToClaudeCodeExecutable,args:[],cwd:process.cwd(),env:args.options.env});return {initializationResult:async()=>({account:{apiProvider:'firstParty' as const,subscriptionType:'team'}}),accountInfo:async()=>({apiProvider:'firstParty' as const,subscriptionType:'team'}),supportedModels:async()=>[],usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:async()=>({}),close:()=>{setTimeout(()=>sdk.emit('close',0),5);}};};
 const result=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),dependencies:{open,spawnProcess:spawnProcess as any}});expect(spawnProcess).toHaveBeenCalledTimes(2);expect(result.providers[1].status).toBe('ready');expect(sdk.kill).not.toHaveBeenCalled();
 });
 it('cancellation kills only its child and waits for confirmed close',async()=>{
 const controller=new AbortController(),child=fakeChild();child.kill.mockImplementation(()=>{queueMicrotask(()=>child.emit('close',null));return true;});const open=()=>({initializationResult:()=>new Promise<any>(()=>{}),accountInfo:async()=>({}),supportedModels:async()=>[],usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:async()=>({}),close:vi.fn()});
 const promise=readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),signal:controller.signal,dependencies:{open,spawnProcess:vi.fn(()=>child) as any}});controller.abort();const result=await promise;expect(child.kill).toHaveBeenCalledOnce();expect(result.providers[1].status).toBe('error');
 });
 it('uses held empty stream and metadata controls, closes query and preserves models on usage failure',async()=>{
 let next!:Promise<IteratorResult<unknown>>;const close=vi.fn();const usage=vi.fn(async()=>{throw Error('private');});
 const open=vi.fn((args:any)=>{next=args.prompt[Symbol.asyncIterator]().next();expect(args.options.tools).toEqual([]);expect(args.options.persistSession).toBe(false);return {initializationResult:async()=>({account:{apiProvider:'firstParty' as const,subscriptionType:'team'}}),accountInfo:async()=>({apiProvider:'firstParty' as const,subscriptionType:'team'}),supportedModels:async()=>[{value:'sonnet',displayName:'Sonnet',description:''}],usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:usage,close};});
 const runAgy=vi.fn(async()=>({command:{data:{groups:[]}}}));
 const result=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),dependencies:{open,runAgy}});
 expect(result.models.status).toBe('ready');expect(result.providers[0].status).toBe('error');expect(result.providers[1].status).toBe('ready');expect(usage).toHaveBeenCalledWith({skipBehaviors:true});expect(close).toHaveBeenCalledOnce();expect(await next).toEqual({done:true,value:undefined});expect(JSON.stringify(result)).not.toContain('private');
 });
 it('rejects Console before requesting models or usage',async()=>{
 const supportedModels=vi.fn();const close=vi.fn();const result=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),dependencies:{open:()=>({initializationResult:async()=>({account:{apiProvider:'firstParty' as const,subscriptionType:'Console'}}),accountInfo:async()=>({}),supportedModels,usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:vi.fn(),close}),runAgy:async()=>({})}});
 expect(supportedModels).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(result.models.status).toBe('error');
 });
 it('parses group buckets without calling a Gemini quota image quota',()=>{
 const result=parseAgyUsage({command:{data:{groups:[{name:'Gemini',buckets:[{window:'five_hour',remaining_fraction:0.42,reset_time:at},{window:'week',remaining_fraction:null,reset_time:'bad'}]}]}}},at);
 expect(result.status).toBe('ready');expect(result.metrics.map(m=>m.remainingPercent)).toEqual([42,null]);expect(result.metrics.every(m=>m.scope==='model')).toBe(true);
 expect(result.message).toContain('이미지');expect(parseAgyUsage({},at).status).toBe('error');
 });
 it('rejects nonnumbers and maps model-scoped windows without leaking names',()=>{
 const result=parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:'20'},seven_day:{utilization:101},model_scoped:[{display_name:'secret@example.com',utilization:40,resets_at:at}]}},at);
 expect(result.metrics.map(m=>m.remainingPercent)).toEqual([null,null,60]);expect(JSON.stringify(result)).not.toContain('@');
 expect(parseModels([{value:'claude-sonnet-4-6',displayName:'Claude Sonnet',description:'Model',email:'private'}],at).models).toEqual([{value:'claude-sonnet-4-6',displayName:'Claude Sonnet',description:'Model'}]);
 expect(parseModels([{value:'secret@example.com',displayName:'bad',description:''}],at).status).toBe('error');
 });
 it('converts only finite utilization, preserves unknowns, drops secrets',()=>{
 const result=parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:25,resets_at:at},seven_day:{utilization:null,resets_at:null}},email:'secret@example.com'},at);
 expect(result.status).toBe('ready');expect(result.metrics.map(m=>m.remainingPercent)).toEqual([75,null]);
 expect(JSON.stringify(result)).not.toContain('secret');
 });
});
