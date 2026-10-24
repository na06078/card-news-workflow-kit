import {test,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {trackOwnedChild,childrenReport,bounded} from '../../src/providers/정리증거.js';
test('내가 만든 node toy의 실제 신원과 close를 확인하며 미추적 후손은 unknown으로 남긴다',async()=>{
 const dir=resolve('실행데이터/W1',`프로세스-${randomUUID()}`);await mkdir(dir,{recursive:true});const path=resolve(dir,'테스트자식.mjs');await copyFile(resolve('tests/worker/테스트자식.mjs'),path);
 const child=spawn(process.execPath,[path],{cwd:dir,shell:false,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});const owned=trackOwnedChild(child);
 try{await bounded(new Promise<void>((r,reject)=>{child.once('message',()=>r());child.once('error',reject);}));const evidence=await owned.cleanup();expect(evidence.pid).toBe(child.pid);expect(evidence.parentPid).toBe(process.pid);expect(evidence.executablePath?.toLowerCase()).toBe(process.execPath.toLowerCase());expect(evidence.createdAt).toBeTruthy();expect(evidence.identityVerified).toBe(true);expect(evidence.exitConfirmed).toBe(true);expect(evidence.evidence).toBe('actual_os');expect(evidence.descendantsConfirmed).toBeNull();const report=childrenReport('controlled-toy',[evidence]);expect(report.status).toBe('unknown');await writeFile(resolve(dir,'종료증거.json'),JSON.stringify({script:path,report},null,2));expect(await owned.cleanup()).toEqual(evidence);
 }finally{await owned.cleanup();}
},20000);
