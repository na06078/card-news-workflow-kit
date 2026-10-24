import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {WorkerOptions,EngineContent} from '../../src/shared/포트.js';
import {createWorker} from '../../src/worker/작업자.js';
const fixture=createMockSnapshot('selection');
export async function setup(){const dataDir=resolve('실행데이터/W1',randomUUID());const store=await createStore({dataDir,dbPath:resolve(dataDir,'worker.sqlite'),dataMode:'mock'});const reply=await store.createProject({topic:'오프라인 작업자',createRequestId:randomUUID()});if(!('data'in reply.body))throw Error('create');return {store,dataDir,pid:reply.body.data.projectId};}
export function options(s:Awaited<ReturnType<typeof setup>>):WorkerOptions{
 return {store:s.store,dataDir:s.dataDir,ownerId:randomUUID(),dataMode:'mock',claudeOptions:{livePermission:{inference:false,search:false,image:false}},
 createClaudeAdapter:({bridge})=>({async *start(c){yield await bridge.publishResult(c,{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>({runId:id,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'TEST_DOUBLE',children:[]}),dispose:async()=>[]}),
 agy:{generate:vi.fn(),cancel:async id=>({runId:id,status:'confirmed',verifiedAt:new Date().toISOString(),reason:'TEST_DOUBLE',children:[]}),dispose:async()=>[]},renderCard:vi.fn(),buildExport:vi.fn(),font:{family:'Noto Sans KR',absolutePath:resolve('assets/render/NotoSansKR.woff2'),licenseAssetId:randomUUID()},fontLicensePath:resolve('assets/render/OFL.txt'),pollMs:5,heartbeatMs:10,leaseMs:1000};
}
test('tick는 실제 B1 queued research를 한 번 claim하고 commit event를 이중 append하지 않는다',async()=>{
 const s=await setup(),o=options(s),w=createWorker(o),other=createWorker({...o,ownerId:randomUUID()});
 try{await s.store.mutate('research',{projectId:s.pid},{version:1,requestId:randomUUID()});const results=await Promise.all([w.tick(),other.tick()]);expect(results.sort()).toEqual([false,true]);const p=await s.store.getProject(s.pid);expect(p.stage).toBe('selection');expect(p.lastRun?.status).toBe('succeeded');expect((await s.store.getEvents(s.pid,0)).events.filter(e=>e.type==='result')).toHaveLength(1);expect(await w.tick()).toBe(false);}finally{await w.dispose();await other.dispose();await s.store.close();}
});
