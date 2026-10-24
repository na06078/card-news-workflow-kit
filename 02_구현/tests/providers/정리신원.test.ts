import {test,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {trackOwnedChild,childrenReport} from '../../src/providers/정리증거.js';
// 순수 명시 대역. 이 파일은 실제 PID에 신호를 보내거나 프로세스를 열지 않습니다.
const original={pid:70001,parentPid:process.pid,executablePath:process.execPath,createdAt:'2026-10-23T00:00:00.000Z'};
for(const mode of ['mismatch','reused','missing','timeout'] as const)test(`cleanup producer ${mode}: 신원/종료 미확인을 confirmed로 올리지 않는다`,async()=>{
 let signals=0,probes=0;const child=Object.assign(new EventEmitter(),{pid:original.pid,spawnfile:process.execPath,kill(){signals++;return true;}}) as unknown as ChildProcess;
 const tracker=trackOwnedChild(child,{graceMs:15,probe:async()=>{probes++;if(mode==='mismatch')return {...original,parentPid:original.parentPid+1};if(mode==='reused'&&probes>1)return {...original,createdAt:'2026-10-23T00:01:00.000Z'};if(mode==='missing')return null;return original;}});
 const evidence=await tracker.cleanup();expect(evidence.evidence).toBe('test_double');expect(evidence.exitConfirmed).toBe(false);expect(signals).toBe(mode==='timeout'?1:0);expect(childrenReport('test',[evidence]).status).toBe(mode==='timeout'?'failed':'unknown');expect(await tracker.cleanup()).toEqual(evidence);child.emit('close');
});
