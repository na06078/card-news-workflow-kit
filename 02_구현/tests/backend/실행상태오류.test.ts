import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createWorkerHealth} from '../../src/backend/실행상태.js';
it('잘못된 SQLite 파일 오류는 경합 false로 은폐하지 않고 반복 시도에도 그대로 전파한다',()=>{
 const dir=resolve('실행데이터/리뷰보강/잠금',randomUUID()),health=createWorkerHealth(dir,'isolated-test-owner',()=>new Date().toISOString());
 mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'작업자상태.잠금.sqlite'),'invalid database'.repeat(100));
 for(let i=0;i<3;i++)expect(()=>health.update('ready')).toThrow(expect.objectContaining({code:'SQLITE_NOTADB'}));
});
