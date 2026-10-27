import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Store} from '../../src/shared/포트.js';
import {createProviderService} from '../../src/backend/제공자상태.js';
const fake=vi.hoisted(()=>({start:vi.fn(),createRunner:vi.fn(),metadata:vi.fn(),activeRuns:vi.fn(()=>false)}));
vi.mock('../../src/backend/연결네이티브.js',()=>({createNativeConnectionRunner:fake.createRunner}));
vi.mock('../../src/backend/연결작업경계.js',()=>({hasActiveConnectionRuns:fake.activeRuns}));
vi.mock('../../src/providers/사용량.js',()=>({METADATA_ERROR:'조회 실패',readProviderMetadata:fake.metadata}));
import {startServer} from '../../src/server-main.js';

test('정상 서버 조립은 로그인·계정변경·로그아웃을 캐시 무효화에 연결하며 시작/GET은 무호출이다',async()=>{
 fake.createRunner.mockReturnValue({start:fake.start});
 fake.start.mockImplementation((_provider:string,action:string)=>({
  done:Promise.resolve(action==='logout'?{connected:false,version:'1',loggedOut:true}:{connected:true,version:'1',accountId:'account@example.test'}),
  cancel:vi.fn(),code:vi.fn(),
 }));
 const reader=vi.fn(async()=>({models:{status:'ready' as const,checkedAt:'2026-10-24T00:00:00.000Z',models:[{value:'old',displayName:'Old',description:''}],error:null},providers:[]}));
 const providers=createProviderService({reader}),invalidate=vi.spyOn(providers,'invalidate');
 const dataDir=resolve(process.env.TMPDIR!,randomUUID());
 const host=await startServer({dataDir,port:0,store:{} as Store,providers});
 try{
  expect(fake.start).not.toHaveBeenCalled();expect(fake.metadata).not.toHaveBeenCalled();expect(reader).not.toHaveBeenCalled();
  expect(fake.createRunner).toHaveBeenCalledWith(expect.objectContaining({cwd:dataDir}));
  const boot=await fetch(host.url+'/api/bootstrap'),cookie=boot.headers.get('set-cookie')!.split(';')[0],csrf=(await boot.json()).data.csrfToken;
  const get=(path:string)=>fetch(host.url+path,{headers:{Cookie:cookie}});
  const post=(path:string,body:unknown)=>fetch(host.url+path,{method:'POST',headers:{Cookie:cookie,Origin:host.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
  await get('/api/connections');await get('/api/providers/status');expect(fake.start).not.toHaveBeenCalled();expect(invalidate).not.toHaveBeenCalled();expect(reader).not.toHaveBeenCalled();
  await post('/api/providers/refresh',{requestId:randomUUID()});await new Promise(r=>setTimeout(r,0));expect(providers.status().models.status).toBe('ready');
  expect((await post('/api/connections/claude/login',{requestId:randomUUID()})).status).toBe(202);
  expect(invalidate).toHaveBeenCalledTimes(2);expect(providers.status().models).toMatchObject({status:'unknown',checkedAt:null,models:[]});
  await post('/api/connections/claude/check',{requestId:randomUUID()});expect(invalidate).toHaveBeenCalledTimes(2);
  await post('/api/providers/refresh',{requestId:randomUUID()});await new Promise(r=>setTimeout(r,0));
  expect((await post('/api/connections/claude/logout',{requestId:randomUUID(),confirm:true,expectedAccountId:'account@example.test'})).status).toBe(202);
  expect(invalidate).toHaveBeenCalledTimes(4);expect(providers.status().models).toMatchObject({status:'unknown',checkedAt:null,models:[]});
  expect(fake.metadata).not.toHaveBeenCalled();expect(fake.activeRuns).toHaveBeenCalledWith(resolve(dataDir,'카드뉴스.sqlite'));
 }finally{await host.close();await providers.dispose();}
});
