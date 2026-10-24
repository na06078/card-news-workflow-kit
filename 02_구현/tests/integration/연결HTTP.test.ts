import {test,expect,vi} from 'vitest';import request from 'supertest';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';
import {listenLocal} from '../backend/HTTP도움.js';import {createStore} from '../../src/backend/저장소.js';import {createApp} from '../../src/backend/앱.js';
import {createConnectionService,type NativeResult} from '../../src/backend/연결.js';
import {startServer} from '../../src/server-main.js';
import {hasActiveConnectionRuns} from '../../src/backend/연결작업경계.js';
test('정상 server-main 조립에서도 GET은 인증 호출 없이 연결 상태를 제공한다',async()=>{
 const host=await startServer({dataDir:resolve('실행데이터/웹연결개선/연결',randomUUID()),port:0});
 try{const boot=await fetch(host.url+'/api/bootstrap');const cookie=boot.headers.get('set-cookie')!.split(';')[0]!;
 const res=await fetch(host.url+'/api/connections',{headers:{Cookie:cookie}});expect(res.status).toBe(200);
 expect((await res.json()).data.connections.map((s:{status:string})=>s.status)).toEqual(['unknown','unknown']);
 }finally{await host.close();}
});
test('연결 HTTP: GET 무호출, 보안, 202, 재생, 새로고침, 활성 run 가드와 취소',async()=>{
 const dataDir=resolve('실행데이터/웹연결개선/연결',randomUUID()),dbPath=resolve(dataDir,'검사.sqlite');
 const store=await createStore({dataDir,dbPath,dataMode:'mock'});
 let finish!:(r:NativeResult)=>void;
 const task={done:new Promise<NativeResult>(r=>finish=r),cancel:vi.fn(()=>finish({connected:false,version:null,errorCode:'CANCELED'})),code:vi.fn()};
 const start=vi.fn(()=>task),connections=createConnectionService({runner:{start},hasActiveRuns:()=>hasActiveConnectionRuns(dbPath)});
 const server=await listenLocal(createApp({store,connections,dataDir,allowedHosts:['127.0.0.1:8765'],allowedOrigins:['http://127.0.0.1:8765']}));
 try{
 const boot=await request(server).get('/api/bootstrap').set('Host','127.0.0.1:8765');const cookie=boot.headers['set-cookie'],csrf=boot.body.data.csrfToken;
 const get=()=>request(server).get('/api/connections').set('Host','127.0.0.1:8765').set('Cookie',cookie);
 const post=(path:string)=>request(server).post(path).set('Host','127.0.0.1:8765').set('Origin','http://127.0.0.1:8765').set('Cookie',cookie).set('X-CSRF-Token',csrf);
 expect((await get()).body.data.connections[0].status).toBe('unknown');expect(start).not.toHaveBeenCalled();
 expect((await request(server).post('/api/connections/claude/login').set('Host','127.0.0.1:8765').send({requestId:randomUUID()})).status).toBe(403);
 expect((await post('/api/connections/claude/login').send({requestId:randomUUID(),command:'bad'})).status).toBe(422);
 const input={requestId:randomUUID()},accepted=await post('/api/connections/claude/login').send(input);
 expect(accepted.status).toBe(202);expect((await get()).body.data.connections[0].operationId).toBe(accepted.body.data.operationId);
 const replay=await post('/api/connections/claude/login').send(input);expect(replay.body).toEqual(accepted.body);expect(replay.headers['idempotency-replayed']).toBe('true');
 const created=await post('/api/projects').send({topic:'연결 격리 검증',createRequestId:randomUUID()});const pid=created.body.data.projectId;
 expect((await post(`/api/projects/${pid}/research`).send({requestId:randomUUID(),version:1})).status).toBe(409);
 expect((await post('/api/connections/claude/cancel').send({requestId:randomUUID(),operationId:accepted.body.data.operationId})).status).toBe(200);
 expect((await post(`/api/projects/${pid}/research`).send({requestId:randomUUID(),version:1})).status).toBe(202);
 expect(hasActiveConnectionRuns(dbPath)).toBe(true);
 expect((await post('/api/connections/agy/check').send({requestId:randomUUID()})).status).toBe(409);expect(start).toHaveBeenCalledTimes(1);
 }finally{await connections.dispose();await store.close();}
});
