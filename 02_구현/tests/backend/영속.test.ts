import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';
test('SQLite 생성 원장은 재시작 후 같은 응답을 재생하며 다른 입력은 거절한다',async()=>{
 const dataDir=resolve('실행데이터/B1',randomUUID());await mkdir(dataDir,{recursive:true});
 const options={dbPath:resolve(dataDir,'검사.sqlite'),dataDir,dataMode:'mock' as const};
 let s=await createStore(options);const input={topic:'영속 검사',createRequestId:randomUUID()};
 const a=await s.createProject(input);expect(a.status).toBe(201);await s.close();s=await createStore(options);
 const b=await s.createProject(input);expect(b.body).toEqual(a.body);expect(b.replayed).toBe(true);
 expect((await s.createProject({...input,topic:'다른 입력'})).status).toBe(409);
 if('data' in a.body)expect((await s.getProject(a.body.data.projectId)).topic).toBe(input.topic);await s.close();
});
