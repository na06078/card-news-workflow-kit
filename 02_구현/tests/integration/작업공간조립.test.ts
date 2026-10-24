import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../../src/server-main.js';
import type {ProviderDashboard,ProviderService} from '../../src/shared/작업공간계약.js';

describe('실제 서버 작업공간 조립',()=>{
 it('시작/GET은 조회를 시작하지 않고 명시 refresh만 주입 서비스를 호출한다',async()=>{
  const base=resolve('실행데이터/작업공간개선/통합');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'조립-'));
  let reads=0,disposed=0;
  const dashboard:ProviderDashboard={refreshing:false,models:{status:'unknown',models:[],checkedAt:null,error:null},providers:[]};
  const providers:ProviderService={status:()=>dashboard,refresh:()=>{reads++;return {...dashboard,refreshing:true};},assertModel:()=>{},dispose:async()=>{disposed++;}};
  const host=await startServer({dataDir:dir,port:0,providers});
  try{
   expect(reads).toBe(0);
   const bootstrap=await fetch(host.url+'/api/bootstrap');const cookie=bootstrap.headers.get('set-cookie')!.split(';')[0]!;
   const {data:{csrfToken}}=await bootstrap.json();
   const state=await fetch(host.url+'/api/providers/status',{headers:{cookie}});
   expect(state.status).toBe(200);expect(await state.json()).toEqual({data:dashboard});expect(reads).toBe(0);
   const request=await fetch(host.url+'/api/providers/refresh',{method:'POST',headers:{cookie,Origin:host.url,'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({requestId:randomUUID()})});
   expect(request.status).toBe(202);expect(reads).toBe(1);
  }finally{await host.close();await rm(dir,{recursive:true,force:true});}
  // Injected service belongs to the caller, not server.close().
  expect(disposed).toBe(0);
 });
});
