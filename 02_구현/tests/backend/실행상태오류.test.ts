import {it,expect,vi} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const denied=vi.hoisted(()=>({code:'EACCES'}));
vi.mock('node:fs',async()=>{const actual=await vi.importActual<typeof import('node:fs')>('node:fs');return {...actual,openSync:(path:Parameters<typeof actual.openSync>[0],...args:any[])=>{if(String(path).endsWith('작업자상태.json.lock'))throw Object.assign(Error('LOCK_IO_FAILURE'),{code:denied.code});return (actual.openSync as any)(path,...args);}};});
import {createWorkerHealth} from '../../src/backend/실행상태.js';
it('health 소유권 대기는 실제 lock 존재만 사용하고 IO 접근 실패를 조용히 대기로 바꾸지 않는다',()=>{
 const dir=resolve('실행데이터/실사용검수복구/작업자회귀',randomUUID()),health=createWorkerHealth(dir,'isolated-test-owner',()=>new Date().toISOString());
 denied.code='EACCES';expect(()=>health.update('ready')).toThrow(expect.objectContaining({code:'EACCES'}));
 denied.code='EEXIST';expect(health.update('ready')).toBe(false);
});
