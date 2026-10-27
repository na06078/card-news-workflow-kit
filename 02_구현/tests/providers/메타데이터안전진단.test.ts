import {it,expect,vi} from 'vitest';
import {readProviderMetadata,type MetadataQuery} from '../../src/providers/사용량.js';
import {ProviderFailure} from '../../src/providers/오류.js';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw Error('UNMOCKED_NATIVE');})}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:vi.fn(()=>{throw Error('UNMOCKED_SDK');})}));
const clean={apiProvider:'firstParty' as const,subscriptionType:'team'};
const raw='SENSITIVE_TOKEN C:/private stdout subscription quota';
function query(account:unknown=clean):MetadataQuery{return {initializationResult:async()=>({account:account as any}),accountInfo:async()=>account as any,supportedModels:vi.fn(async()=>[{value:'sonnet',displayName:'Sonnet',description:''}]),usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:vi.fn(async()=>({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:5}}})),close:vi.fn()};}
const read=(q:MetadataQuery,runAgy=async():Promise<unknown>=>({command:{data:{groups:[]}}}))=>readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),dependencies:{open:()=>q,runAgy}});
it.each([
 [{...clean,apiKeySource:'env'},'AUTH_PATH_FORBIDDEN','인증·과금 경로'],
 [{...clean,subscriptionType:'Console'},'AUTH_MODE_UNKNOWN','구독 인증'],
 [{...clean,subscriptionType:'free'},'AUTH_MODE_UNKNOWN','구독 인증'],
])('B17 확정된 인증 경계는 안전 코드로 구분하고 조회·추론하지 않는다 (%j)',async(account,code,text)=>{
 const q=query(account),r=await read(q);expect(r.models).toMatchObject({status:'error',errorCode:code,checkedAt:null,models:[]});
 expect(r.models.error).toContain(text);expect(r.providers[0]).toMatchObject({status:'error',errorCode:code,metrics:[]});
 expect(q.supportedModels).not.toHaveBeenCalled();expect(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET).not.toHaveBeenCalled();expect(q.close).toHaveBeenCalledOnce();
});
it('B17 자연어와 위조 code는 한도나 인증 근거가 아니며 원문은 사라진다',async()=>{
 const q=query();q.accountInfo=async()=>{throw Object.assign(Error(raw),{code:'AUTH_PATH_FORBIDDEN'});};
 const r=await read(q,async()=>{throw Error(raw);});expect(r.models.errorCode).toBe('METADATA_UNAVAILABLE');
 expect(r.providers.every(p=>p.errorCode==='METADATA_UNAVAILABLE')).toBe(true);expect(JSON.stringify(r)).not.toContain('SENSITIVE_TOKEN');expect(JSON.stringify(r)).not.toContain('SUBSCRIPTION_QUOTA');
});
it('B17 사용량 중 확정된 인증 오류는 먼저 읽은 모델까지 무효화한다',async()=>{
 const q=query();q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET=async()=>{throw new ProviderFailure('AUTH_PATH_FORBIDDEN');};
 const r=await read(q);expect(r.models).toMatchObject({status:'error',errorCode:'AUTH_PATH_FORBIDDEN',models:[]});expect(r.providers[0].errorCode).toBe('AUTH_PATH_FORBIDDEN');expect(q.close).toHaveBeenCalledOnce();
});

function child(){return Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>true)});}
it('B17 SDK 종료 미확인은 인증 오류보다 우선하며 소유 자식 정리를 계속한다',async()=>{
 const c=child(),q=query({...clean,apiKeySource:'env'});q.close=vi.fn(()=>{throw Error(raw);});
 const r=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),cleanupMs:5,dependencies:{runAgy:async()=>({}),spawnProcess:vi.fn(()=>c) as any,open:args=>{args.options.spawnClaudeCodeProcess!({command:args.options.pathToClaudeCodeExecutable!,args:[],cwd:process.cwd(),env:args.options.env!} as any);return q;}}});
 expect(c.kill).toHaveBeenCalled();expect(q.close).toHaveBeenCalledOnce();
 expect(r.models).toMatchObject({status:'error',errorCode:'METADATA_CLEANUP_UNCONFIRMED',models:[],checkedAt:null});
 expect(r.providers[0]).toMatchObject({errorCode:'METADATA_CLEANUP_UNCONFIRMED',metrics:[]});expect(r.models.error).toContain('종료');expect(JSON.stringify(r)).not.toContain('SENSITIVE_TOKEN');
});
it('B17 agy 소유 자식 종료 미확인을 자연어 오류와 구분한다',async()=>{
 const c=child();const r=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),timeoutMs:5,cleanupMs:5,dependencies:{open:()=>query(),spawnProcess:vi.fn(()=>c) as any}});
 expect(c.kill).toHaveBeenCalled();expect(r.providers[1]).toMatchObject({status:'error',errorCode:'METADATA_CLEANUP_UNCONFIRMED',checkedAt:null,metrics:[]});
});
it('B17 성공 응답 뒤 인증 경로가 변경되면 모델·사용량을 확정하지 않는다',async()=>{
 const q=query();q.accountInfo=vi.fn().mockResolvedValueOnce(clean).mockResolvedValueOnce({...clean,apiKeySource:'env'});
 const r=await read(q);expect(r.models).toMatchObject({status:'error',errorCode:'AUTH_PATH_FORBIDDEN',models:[]});expect(r.providers[0]).toMatchObject({errorCode:'AUTH_PATH_FORBIDDEN',metrics:[]});expect(q.close).toHaveBeenCalledOnce();
});
it('B17 정상 query close 뒤 실제 소유 close까지 확인해야 ready를 반환한다',async()=>{
 const c=child(),q=query();let closed=false;
 q.close=vi.fn(()=>{setTimeout(()=>{closed=true;c.emit('close',0);},5);});
 const r=await readProviderMetadata({appRoot:process.cwd(),cwd:process.cwd(),cleanupMs:20,dependencies:{runAgy:async()=>({}),spawnProcess:vi.fn(()=>c) as any,open:args=>{args.options.spawnClaudeCodeProcess!({command:args.options.pathToClaudeCodeExecutable!,args:[],cwd:process.cwd(),env:args.options.env!} as any);return q;}}});
 expect(closed).toBe(true);expect(r.models.status).toBe('ready');expect(c.kill).not.toHaveBeenCalled();
});

