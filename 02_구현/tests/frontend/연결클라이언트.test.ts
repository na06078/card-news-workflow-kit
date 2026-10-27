import {it,expect,vi} from 'vitest';
import {createConnectionClient} from '../../src/frontend/연결클라이언트.js';
const state={provider:'agy',status:'unknown',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'미확인',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'not_checked'};
it('로그아웃은 정확한 확인 payload와 CSRF·쿠키를 보내고 202 상태를 검증한다',async()=>{
 const pending={...state,status:'logout_pending',accountId:null};
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{csrfToken:'csrf-test',contractVersion:'CN-1'}}))).mockResolvedValueOnce(new Response(JSON.stringify({data:pending}),{status:202}));
 const c=createConnectionClient(fetcher);const input={requestId:'11111111-1111-4111-8111-111111111111',confirm:true as const,expectedAccountId:'fake@example.test'};
 expect(await c.act('agy','logout',input)).toEqual(pending);expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[1]).toEqual(['/api/connections/agy/logout',{method:'POST',credentials:'include',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':'csrf-test'},body:JSON.stringify(input)}]);
});
it('조회는 GET뿐이며 POST는 bootstrap CSRF와 원래 requestId를 보낸다',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{csrfToken:'csrf-test',contractVersion:'CN-1'}}))).mockResolvedValueOnce(new Response(JSON.stringify({data:{connections:[state]}}))).mockResolvedValueOnce(new Response(JSON.stringify({data:state})));
 const c=createConnectionClient(fetcher);await c.list();expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0]?.[0]).toBe('/api/bootstrap');expect(fetcher.mock.calls[0]?.[1].method).toBe('GET');expect(fetcher.mock.calls[1]?.[1].method).toBe('GET');
 await c.act('agy','login',{requestId:'11111111-1111-4111-8111-111111111111'});
 expect(fetcher.mock.calls[1]?.[0]).toBe('/api/connections');expect(fetcher.mock.calls[2]?.[1].headers['X-CSRF-Token']).toBe('csrf-test');expect(JSON.parse(fetcher.mock.calls[2]?.[1].body).requestId).toBe('11111111-1111-4111-8111-111111111111');
});
