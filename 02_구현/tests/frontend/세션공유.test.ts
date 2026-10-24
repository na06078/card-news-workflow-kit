import {describe,it,expect,vi} from 'vitest';
import {createHttpClient} from '../../src/frontend/클라이언트.js';
import {createWorkspaceClient} from '../../src/frontend/작업공간클라이언트.js';

describe('초기 쿠키 세션 경합 방지',()=>{
 it('동시에 요청한 기본 bootstrap은 한 번만 수행한다',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const fetcher=vi.fn(async()=>{await gate;return new Response(JSON.stringify({data:{csrfToken:'test-session',contractVersion:'CN-1'}}));});
  const client=createHttpClient({fetch:fetcher as typeof fetch});
  const first=client.bootstrap(),second=client.bootstrap();release();await Promise.all([first,second]);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('작업공간 POST도 기본 클라이언트가 발급받은 같은 CSRF를 사용한다',async()=>{
  const bootstrap=vi.fn(async()=>({csrfToken:'shared-test-session',contractVersion:'CN-1' as const}));
  const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   expect((init?.headers as Record<string,string>)['X-CSRF-Token']).toBe('shared-test-session');
   return new Response(JSON.stringify({data:{refreshing:true,models:{status:'unknown',checkedAt:null,models:[],error:null},providers:[]}}));
  });
  const client=createWorkspaceClient(fetcher as typeof fetch,bootstrap);
  await client.refreshProviders('7284bde0-73a1-4afd-b019-49706bb17e89');
  expect(bootstrap).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
