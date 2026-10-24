import type {z} from 'zod';
import {BootstrapSchema,FailureSchema,successSchema} from '../shared/포트.js';
import {DeleteProjectRequestSchema,DeleteProjectResponseSchema,ProjectListSchema,ModelSelectionRequestSchema,ModelSelectionResponseSchema,ProviderDashboardSchema,ProviderRefreshRequestSchema,type WorkspaceClient} from '../shared/작업공간계약.js';
import {clientError} from './클라이언트.js';
export function createWorkspaceClient(fetcher:typeof fetch=globalThis.fetch.bind(globalThis),sharedBootstrap?:()=>Promise<ReturnType<typeof BootstrapSchema.parse>>):WorkspaceClient {
 let csrf:string|null=null,boot:Promise<void>|null=null;
 async function request<T>(path:string,schema:z.ZodType<T>,input?:unknown):Promise<T>{
  let response:Response;try{response=await fetcher(path,{method:input===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:input===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':csrf??''},...(input===undefined?{}:{body:JSON.stringify(input)})});}catch{throw clientError('NETWORK_ERROR','서버에 연결하지 못했습니다. 다시 조회하세요. 모의 데이터로 대체하지 않습니다.');}
  let body:unknown;try{body=await response.json();}catch{throw clientError('CLIENT_PROTOCOL_ERROR','서버 응답을 읽지 못했습니다.');}
  if(!response.ok){const failure=FailureSchema.safeParse(body);if(failure.success)throw {status:response.status,error:failure.data.error};throw clientError('CLIENT_PROTOCOL_ERROR',`서버 응답 오류 (HTTP ${response.status})`);}
  const result=successSchema(schema).safeParse(body);if(!result.success)throw clientError('CLIENT_PROTOCOL_ERROR','작업 공간 응답 형식이 일치하지 않습니다.');return result.data.data;
 }
 async function bootstrap(){if(csrf)return;if(!boot)boot=(sharedBootstrap?sharedBootstrap():request('/api/bootstrap',BootstrapSchema)).then(data=>{csrf=data.csrfToken;}).finally(()=>{boot=null;});await boot;}
 return {async deleteProject(id,input){await bootstrap();return request(`/api/projects/${encodeURIComponent(id)}/delete`,DeleteProjectResponseSchema,DeleteProjectRequestSchema.parse(input));},async listProjects(){await bootstrap();return request('/api/projects',ProjectListSchema);},async providerStatus(){await bootstrap();return request('/api/providers/status',ProviderDashboardSchema);},async refreshProviders(requestId){await bootstrap();return request('/api/providers/refresh',ProviderDashboardSchema,ProviderRefreshRequestSchema.parse({requestId}));},async setProjectModel(id,input){await bootstrap();return request(`/api/projects/${encodeURIComponent(id)}/model`,ModelSelectionResponseSchema,ModelSelectionRequestSchema.parse(input));}};
}
