import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';
test('동시 같은 요청은 단일 research run, 다른 payload 충돌, 다른 ID 중복 작업 거절',async()=>{
 const dataDir=resolve('실행데이터/B1',randomUUID());const s=await createStore({dataDir,dbPath:resolve(dataDir,'검사.sqlite'),dataMode:'mock'});
 const c=await s.createProject({topic:'동시성',createRequestId:randomUUID()});if(!('data' in c.body))throw Error('create');const target={projectId:c.body.data.projectId};const v={requestId:randomUUID(),version:1};
 const [a,b]=await Promise.all([s.mutate('research',target,v),s.mutate('research',target,v)]);expect(a.status).toBe(202);expect(b.body).toEqual(a.body);expect(b.replayed).toBe(true);
 expect((await s.mutate('research',target,{...v,version:2})).status).toBe(409);
 const p=await s.getProject(target.projectId);expect(p.activeRun?.kind).toBe('research');
 const other=await s.mutate('research',target,{requestId:randomUUID(),version:p.projectVersion});expect(other.status).toBe(409);if('error' in other.body)expect(other.body.error.code).toBe('RUN_ACTIVE');
 const f=await s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});expect(f?.run.status).toBe('running');expect(await s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'})).toBe(null);await s.close();
});
