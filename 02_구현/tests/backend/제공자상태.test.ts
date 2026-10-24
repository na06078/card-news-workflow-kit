import {it,expect,vi} from 'vitest';
import {createProviderService} from '../../src/backend/제공자상태.js';
import type {ProviderReading} from '../../src/shared/작업공간계약.js';
const good:ProviderReading={models:{status:'ready',checkedAt:'2026-10-24T00:00:00.000Z',models:[{value:'sonnet',displayName:'Sonnet',description:''}],error:null},providers:[{provider:'claude',label:'Claude',status:'ready',checkedAt:'2026-10-24T00:00:00.000Z',metrics:[{id:'five_hour',label:'5시간',remainingPercent:75,resetsAt:null,scope:'account',source:'SDK'}],message:null}]};
it('aborts on deadline and disposal, rejects late updates and isolates snapshots',async()=>{
 vi.useFakeTimers();try{
 let signal:AbortSignal|undefined;let done!:(r:ProviderReading)=>void;
 const reader=vi.fn((s?:AbortSignal)=>{signal=s;return new Promise<ProviderReading>(r=>done=r);});
 const service=createProviderService({reader,timeoutMs:20});service.refresh('x');await vi.advanceTimersByTimeAsync(21);
 expect(signal?.aborted).toBe(true);expect(service.status().refreshing).toBe(false);expect(service.status().models.status).toBe('error');done(good);await vi.advanceTimersByTimeAsync(0);expect(service.status().models.models).toEqual([]);
 service.refresh('y');await vi.advanceTimersByTimeAsync(0);const disposing=service.dispose();expect(signal?.aborted).toBe(true);done(good);await disposing;expect(service.status().models.models).toEqual([]);
 const snap=service.status();snap.models.models.push(good.models.models[0]);expect(service.status().models.models).toEqual([]);
 }finally{vi.useRealTimers();}
});
it('annotates model validation errors with the frozen HTTP contract',async()=>{
 const service=createProviderService({reader:async()=>good});
 try{service.assertModel('sonnet');throw Error('not rejected');}catch(e){expect(e).toMatchObject({status:503,code:'MODEL_CATALOG_UNAVAILABLE'});}
 service.refresh('a');await flush();try{service.assertModel('unknown');throw Error('not rejected');}catch(e){expect(e).toMatchObject({status:422,code:'MODEL_UNAVAILABLE'});}await service.dispose();
});
it('clears service deadlines even when a reader ignores abort during disposal',async()=>{
 vi.useFakeTimers();try{const service=createProviderService({reader:()=>new Promise(()=>{})});service.refresh('hang');await vi.advanceTimersByTimeAsync(0);const pending=service.dispose();await vi.advanceTimersByTimeAsync(6001);await pending;expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
const flush=()=>new Promise(r=>setTimeout(r,0));
it('reads only on refresh, dedupes busy requests and preserves stale success on failure',async()=>{
 let finish!:(v:ProviderReading)=>void;const reader=vi.fn(()=>new Promise<ProviderReading>(r=>finish=r));const service=createProviderService({reader});
 expect(service.status().refreshing).toBe(false);expect(reader).not.toHaveBeenCalled();expect(service.refresh('one').refreshing).toBe(true);service.refresh('two');await flush();expect(reader).toHaveBeenCalledTimes(1);
 finish(good);await flush();expect(service.status().models.status).toBe('ready');expect(()=>service.assertModel('sonnet')).not.toThrow();expect(()=>service.assertModel('other')).toThrow();
 reader.mockRejectedValueOnce(new Error('secret@example.com'));service.refresh('three');await flush();expect(service.status().providers[0].metrics[0].remainingPercent).toBe(75);expect(service.status().providers[0].checkedAt).toBe(good.providers[0].checkedAt);expect(service.status().models.status).toBe('error');expect(JSON.stringify(service.status())).not.toContain('secret');expect(()=>service.assertModel('sonnet')).toThrow();expect(()=>service.assertModel(null)).not.toThrow();await service.dispose();
});
