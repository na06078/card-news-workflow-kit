import {test,expect,vi} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../src/backend/앱.js';
import {createConnectionService,type NativeResult} from '../../src/backend/연결.js';
import type {Store} from '../../src/shared/포트.js';
import {listenLocal} from './HTTP도움.js';

test('로그아웃 HTTP는 명시 확인·현재 계정·보안·재생을 지키며 GET은 실행하지 않는다',async()=>{
 let active=false;
 const tasks:Array<{finish:(result:NativeResult)=>void}>=[];
 const start=vi.fn(()=>{
  let finish!:(result:NativeResult)=>void;
  const done=new Promise<NativeResult>(resolve=>finish=resolve);tasks.push({finish});
  return {done,cancel:vi.fn(()=>finish({connected:false,version:null})),code:vi.fn()};
 });
 const connections=createConnectionService({runner:{start},hasActiveRuns:()=>active});
 const store={} as Store;
 const server=await listenLocal(createApp({store,connections,dataDir:'.',allowedHosts:['127.0.0.1:8765'],allowedOrigins:['http://127.0.0.1:8765']}));
 try{
  const boot=await request(server).get('/api/bootstrap').set('Host','127.0.0.1:8765');
  const cookie=boot.headers['set-cookie'],csrf=boot.body.data.csrfToken;
  const get=(path='/api/connections')=>request(server).get(path).set('Host','127.0.0.1:8765').set('Cookie',cookie);
  const post=(path:string)=>request(server).post(path).set('Host','127.0.0.1:8765').set('Origin','http://127.0.0.1:8765').set('Cookie',cookie).set('X-CSRF-Token',csrf);
  const path='/api/connections/claude/logout',input={requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'};
  expect((await get()).status).toBe(200);expect((await get(path)).status).toBe(404);expect(start).not.toHaveBeenCalled();
  expect((await request(server).post(path).set('Host','127.0.0.1:8765').send(input)).status).toBe(403);
  expect((await post(path).set('Origin','https://foreign.test').send(input)).status).toBe(403);
  expect((await post(path).set('X-CSRF-Token','wrong').send(input)).status).toBe(403);
  expect((await post(path).send({...input,confirm:false})).status).toBe(422);
  expect((await post(path).send({...input,expectedAccountId:''})).status).toBe(422);
  expect((await post(path).send({...input,command:'logout'})).status).toBe(422);
  expect((await post(path).send(input)).status).toBe(409);expect(start).not.toHaveBeenCalled();
  await post('/api/connections/claude/check').send({requestId:randomUUID()});tasks[0].finish({connected:true,version:'2',accountId:'account@example.test'});
  const current=await get();expect(current.body.data.connections[0].accountId).toBe(input.expectedAccountId);
  expect((await post(path).send({...input,expectedAccountId:'other@example.test'})).status).toBe(409);
  active=true;expect((await post(path).send(input)).status).toBe(409);active=false;
  const accepted=await post(path).send(input);expect(accepted.status).toBe(202);expect(accepted.body.data.status).toBe('logout_pending');
  expect((await get()).body.data.connections[0].operationId).toBe(accepted.body.data.operationId);
  const replay=await post(path).send(input);expect(replay.headers['idempotency-replayed']).toBe('true');expect(replay.body).toEqual(accepted.body);
  expect((await post(path).send({...input,expectedAccountId:'other@example.test'})).body.error.code).toBe('REQUEST_ID_CONFLICT');
  expect((await post('/api/projects/'+randomUUID()+'/research').send({requestId:randomUUID(),version:1})).status).toBe(409);
  expect((await post('/api/providers/refresh').send({requestId:randomUUID()})).status).toBe(409);
  expect(start).toHaveBeenCalledTimes(2);
  tasks[1].finish({connected:false,version:'2',loggedOut:true});
  expect((await get()).body.data.connections[0]).toMatchObject({status:'login_required',accountId:null,errorCode:null});
  const completedReplay=await post(path).send(input);expect(completedReplay.status).toBe(202);expect(completedReplay.body).toEqual(accepted.body);expect(start).toHaveBeenCalledTimes(2);
 }finally{await connections.dispose();}
});
