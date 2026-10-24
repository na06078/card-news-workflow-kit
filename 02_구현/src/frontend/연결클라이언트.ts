import type {z} from 'zod';
import {ConnectionListSchema,ConnectionStateSchema,type ConnectionState,type ConnectionProvider} from '../shared/연결계약.js';
import {BootstrapSchema,FailureSchema,successSchema} from '../shared/포트.js';
import {clientError} from './클라이언트.js';
export type ConnectionAction='login'|'check'|'cancel'|'code';
export interface ConnectionClient {
 list():Promise<{connections:ConnectionState[]}>;
 act(provider:ConnectionProvider,action:ConnectionAction,input:{requestId:string;operationId?:string;authorizationCode?:string}):Promise<ConnectionState>;
}
export function createConnectionClient(fetcher:typeof fetch=globalThis.fetch.bind(globalThis)):ConnectionClient {
 let csrf:string|null=null;let bootstrapping:Promise<void>|null=null;
 async function request<T>(path:string,schema:z.ZodType<T>,input?:unknown):Promise<T>{
  let response:Response;
  try{response=await fetcher(path,{method:input===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:input===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':csrf??''},...(input===undefined?{}:{body:JSON.stringify(input)})});}
  catch{throw clientError('NETWORK_ERROR','연결 상태를 확인하지 못했습니다. 다시 조회한 뒤 진행하세요.');}
  let body:unknown;try{body=await response.json();}catch{throw clientError('CLIENT_PROTOCOL_ERROR','연결 응답을 읽지 못했습니다. 다시 조회하세요.');}
  if(!response.ok){const failure=FailureSchema.safeParse(body);if(failure.success)throw {status:response.status,error:failure.data.error};throw clientError('CLIENT_PROTOCOL_ERROR',`연결 요청 실패 (HTTP ${response.status})`);}
  const result=successSchema(schema).safeParse(body);if(!result.success)throw clientError('CLIENT_PROTOCOL_ERROR','연결 응답 형식이 일치하지 않습니다.');return result.data.data;
 }
 async function bootstrap(){if(csrf)return;if(!bootstrapping)bootstrapping=request('/api/bootstrap',BootstrapSchema).then(b=>{csrf=b.csrfToken;}).finally(()=>{bootstrapping=null;});await bootstrapping;}
 return {async list(){await bootstrap();return request('/api/connections',ConnectionListSchema);},async act(provider,action,input){
  await bootstrap();
  return request(`/api/connections/${provider}/${action}`,ConnectionStateSchema,input);
 }};
}
