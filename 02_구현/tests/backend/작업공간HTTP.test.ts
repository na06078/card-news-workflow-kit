import {test,expect} from 'vitest';
import request from 'supertest';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';import {createApp} from '../../src/backend/앱.js';
import type {ProviderService} from '../../src/shared/작업공간계약.js';
import {listenLocal} from './HTTP도움.js';
test('공급자 미주입은 unknown이며 명시 모델만 503으로 거절하고 null은 허용한다',async()=>{
 const dataDir=resolve('실행데이터/작업공간개선/저장소/임시',randomUUID());const s=await createStore({dataDir,dbPath:resolve(dataDir,'unknown.sqlite'),dataMode:'mock'});
 const server=await listenLocal(createApp({store:s,dataDir,allowedHosts:['127.0.0.1:8765'],allowedOrigins:['http://127.0.0.1:8765']}));try{
 const boot=await request(server).get('/api/bootstrap').set('Host','127.0.0.1:8765');const cookie=boot.headers['set-cookie'];
 const post=(url:string)=>request(server).post(url).set('Host','127.0.0.1:8765').set('Origin','http://127.0.0.1:8765').set('Cookie',cookie).set('X-CSRF-Token',boot.body.data.csrfToken);
 const status=await request(server).get('/api/providers/status').set('Host','127.0.0.1:8765').set('Cookie',cookie);expect(status.body.data.models.status).toBe('unknown');expect(status.body.data.providers.every((p:{status:string})=>p.status==='unknown')).toBe(true);
 expect((await post('/api/providers/refresh').send({requestId:randomUUID()})).status).toBe(503);
 expect((await post('/api/projects').send({createRequestId:randomUUID(),topic:'bad',claudeModel:'model-a'})).status).toBe(503);
 expect((await post('/api/projects').send({createRequestId:randomUUID(),topic:'default',claudeModel:null})).status).toBe(201);
 expect((await s.listProjects()).projects).toHaveLength(1);
 }finally{await s.close();}
});
test('HTTP 목록·모델 검증·재전송·공급자 조회는 주입 서비스만 사용한다',async()=>{
 const dataDir=resolve('실행데이터/작업공간개선/저장소/임시',randomUUID());const s=await createStore({dataDir,dbPath:resolve(dataDir,'http.sqlite'),dataMode:'mock'});
 let ready=true,refreshes=0;
 const dashboard={refreshing:false,models:{status:'ready' as const,checkedAt:null,models:[{value:'model-a',displayName:'A',description:''}],error:null},providers:[]};
 const providers:ProviderService={status:()=>dashboard,refresh:()=>{refreshes++;return dashboard;},assertModel(model){if(model===null)return;if(!ready)throw Object.assign(Error('SECRET'),{status:503,code:'MODEL_CATALOG_UNAVAILABLE'});if(model!=='model-a')throw Object.assign(Error('SECRET'),{status:422,code:'MODEL_UNAVAILABLE'});},async dispose(){}};
 const server=await listenLocal(createApp({store:s,dataDir,allowedHosts:['127.0.0.1:8765'],allowedOrigins:['http://127.0.0.1:8765'],providers}));
 try{const boot=await request(server).get('/api/bootstrap').set('Host','127.0.0.1:8765');const cookie=boot.headers['set-cookie'];const csrf=boot.body.data.csrfToken;
 const get=(url:string)=>request(server).get(url).set('Host','127.0.0.1:8765').set('Cookie',cookie);
 const post=(url:string)=>request(server).post(url).set('Host','127.0.0.1:8765').set('Origin','http://127.0.0.1:8765').set('Cookie',cookie).set('X-CSRF-Token',csrf);
 expect((await get('/api/projects')).body).toEqual({data:{projects:[]}});
 const input={createRequestId:randomUUID(),topic:'HTTP',claudeModel:'model-a'};const created=await post('/api/projects').send(input);expect(created.status).toBe(201);const pid=created.body.data.projectId;
 expect((await get('/api/projects')).body.data.projects).toHaveLength(1);
 expect((await get('/api/providers/status')).body.data).toEqual(dashboard);expect(refreshes).toBe(0);
 expect((await post('/api/providers/refresh').send({requestId:randomUUID()})).status).toBe(202);expect(refreshes).toBe(1);
 const model={requestId:randomUUID(),version:0,model:'model-a'};expect((await post(`/api/projects/${pid}/model`).send(model)).status).toBe(200);
 ready=false;expect((await post('/api/projects').send(input)).headers['idempotency-replayed']).toBe('true');expect((await post(`/api/projects/${pid}/model`).send(model)).headers['idempotency-replayed']).toBe('true');
 const failed=await post(`/api/projects/${pid}/model`).send({...model,requestId:randomUUID(),version:1});expect(failed.status).toBe(503);expect(failed.body.error.code).toBe('MODEL_CATALOG_UNAVAILABLE');expect(JSON.stringify(failed.body)).not.toContain('SECRET');
 ready=true;expect((await post(`/api/projects/${pid}/model`).send({...model,requestId:randomUUID(),version:1,model:'missing'})).status).toBe(422);
 expect((await post(`/api/projects/${pid}/model`).send({...model,requestId:randomUUID(),version:0})).status).toBe(409);
 expect((await post(`/api/projects/${pid}/model`).send({...model,requestId:randomUUID(),version:1,extra:true})).status).toBe(422);
 expect((await request(server).post(`/api/projects/${pid}/model`).set('Host','127.0.0.1:8765').send(model)).status).toBe(403);
 }finally{await s.close();}
});
