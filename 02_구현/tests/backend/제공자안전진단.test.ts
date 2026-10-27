import {it,expect,vi} from 'vitest';
import {createProviderService} from '../../src/backend/제공자상태.js';
import {metadataDiagnostic,parseModels,parseClaudeUsage} from '../../src/providers/사용량.js';
import type {ProviderReading,MetadataErrorCode} from '../../src/shared/작업공간계약.js';
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw Error('UNMOCKED_NATIVE');})}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:vi.fn(()=>{throw Error('UNMOCKED_SDK');})}));
const at='2026-10-24T00:00:00.000Z';
const good:ProviderReading={models:parseModels([{value:'sonnet',displayName:'Sonnet',description:''}],at),providers:[parseClaudeUsage({subscription_type:'team',rate_limits_available:true,rate_limits:{five_hour:{utilization:25}}},at)]};
const flush=()=>new Promise(r=>setTimeout(r,0));

it('B17 deadline 뒤 소유 reader의 실패 진단만 반영하고 늦은 성공·이전 세대는 거절한다',async()=>{
 vi.useFakeTimers();try{
  let done!:(r:ProviderReading)=>void;
  const s=createProviderService({reader:()=>new Promise(r=>done=r),timeoutMs:5});
  const cleanup:ProviderReading={models:{status:'error',checkedAt:null,models:[],error:'private',errorCode:'METADATA_CLEANUP_UNCONFIRMED'},providers:[{provider:'claude',label:'Claude',status:'error',checkedAt:null,metrics:[],message:'private',errorCode:'METADATA_CLEANUP_UNCONFIRMED'}]};
  s.refresh('old');await vi.advanceTimersByTimeAsync(6);done(cleanup);await vi.advanceTimersByTimeAsync(0);
  expect(s.status().models.errorCode).toBe('METADATA_CLEANUP_UNCONFIRMED');expect(s.status().providers[0].errorCode).toBe('METADATA_CLEANUP_UNCONFIRMED');
  s.refresh('late-success');await vi.advanceTimersByTimeAsync(6);done(good);await vi.advanceTimersByTimeAsync(0);expect(s.status().models).toMatchObject({status:'error',models:[],errorCode:'METADATA_UNAVAILABLE'});
  s.refresh('invalidated');await vi.advanceTimersByTimeAsync(0);s.invalidate!();done(cleanup);await vi.advanceTimersByTimeAsync(0);expect(s.status().models).toMatchObject({status:'unknown',error:null});await s.dispose();
 }finally{vi.useRealTimers();}
});

it.each<MetadataErrorCode>(['AUTH_PATH_FORBIDDEN','AUTH_MODE_UNKNOWN','METADATA_CLEANUP_UNCONFIRMED','METADATA_UNAVAILABLE'])('B17 실패 %s는 이전 값·시각을 보존하며 새 안전 진단을 남긴다',async(errorCode)=>{
 const reader=vi.fn(async()=>good),s=createProviderService({reader});s.refresh('good');await flush();
 const dirty='SENSITIVE_TOKEN C:/private stdout';
 reader.mockResolvedValueOnce({models:{status:'error',checkedAt:null,models:[],error:dirty,errorCode},providers:[{provider:'claude',label:'Claude',status:'error',checkedAt:null,metrics:[],message:dirty,errorCode}]});
 s.refresh('bad');await flush();const r=s.status(),safe=metadataDiagnostic(errorCode);
 expect(r.models).toMatchObject({status:'error',models:good.models.models,checkedAt:at,errorCode,error:safe.message});
 expect(r.providers[0]).toMatchObject({status:'error',metrics:good.providers[0].metrics,checkedAt:at,errorCode,message:safe.message});
 expect(JSON.stringify(r)).not.toContain('SENSITIVE_TOKEN');expect(()=>s.assertModel('sonnet')).toThrow('모델 목록');
 reader.mockRejectedValueOnce(Error(dirty));s.refresh('generic');await flush();expect(s.status().models.errorCode).toBe('METADATA_UNAVAILABLE');
 s.refresh('recovered');await flush();expect(s.status().models.status).toBe('ready');expect(s.status().models).not.toHaveProperty('errorCode');await s.dispose();
});
