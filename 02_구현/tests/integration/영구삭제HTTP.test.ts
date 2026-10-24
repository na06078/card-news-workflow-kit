import {it,expect,vi} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/backend/앱.js';
import type {Store} from '../../src/shared/포트.js';
const id='25373064-8407-4435-942c-cef03c877c93',rid='4fb34940-c64e-4936-8b21-5ca0e8990821';
it('영구삭제는 확인/CSRF가 있는 POST만 저장소에 전달한다',async()=>{
 const remove=vi.fn(async()=>({status:200,body:{data:{projectId:id,deleted:true as const}},replayed:false}));
 const app=createApp({store:{deleteProject:remove} as unknown as Store,dataDir:'.',allowedHosts:['127.0.0.1:8765'],allowedOrigins:['http://127.0.0.1:8765']});
 const boot=await request(app).get('/api/bootstrap').set('Host','127.0.0.1:8765');
 const post=(body:Record<string,unknown>,csrf=true)=>request(app).post(`/api/projects/${id}/delete`).set('Host','127.0.0.1:8765').set('Origin','http://127.0.0.1:8765').set('Cookie',boot.headers['set-cookie']).set('X-CSRF-Token',csrf?boot.body.data.csrfToken:'bad').send(body);
 expect((await post({requestId:rid,version:1,confirm:true})).status).toBe(200);
 expect(remove).toHaveBeenCalledWith(id,{requestId:rid,version:1,confirm:true});
 expect((await post({requestId:rid,version:1,confirm:false})).status).toBe(422);
 expect((await post({requestId:rid,version:1,confirm:true},false)).status).toBe(403);
 expect((await request(app).get(`/api/projects/${id}/delete`).set('Host','127.0.0.1:8765').set('Cookie',boot.headers['set-cookie'])).status).toBe(404);
 expect(remove).toHaveBeenCalledTimes(1);
});
