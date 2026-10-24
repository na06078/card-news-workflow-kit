import type {z} from 'zod';
import {BootstrapSchema,CreateProjectRequestSchema,CreateProjectResponseSchema,ProjectSnapshotSchema,RunSchema,EventPageSchema,ExportListSchema,FailureSchema,RequestSchemas,ResponseSchemas,successSchema,type FrontendClient,type MutationName,type MutationTarget,type RequestByMutation,type ResponseByMutation,type AppError} from '../shared/포트.js';

export function clientError(code:string,message:string):{status:number;error:AppError} {
 return {status:0,error:{code,message,retryable:true,nextActions:[],projectId:null,runId:null,currentVersion:null,details:{}}};
}
export function mutationPath(name:MutationName,target:MutationTarget):string {
 const p=`/api/projects/${encodeURIComponent(target.projectId)}`;
 if(name==='cancel'||name==='retry') {
  if(!target.runId) throw clientError('CLIENT_INPUT_ERROR','작업 ID가 없습니다. 상태를 새로고침해 주세요.');
  return `/api/runs/${encodeURIComponent(target.runId)}/${name}`;
 }
 if(name==='cardApprove') {
  if(!target.cardId) throw clientError('CLIENT_INPUT_ERROR','카드 ID가 없습니다.');
  return `${p}/cards/${encodeURIComponent(target.cardId)}/approve`;
 }
 return `${p}/${name}`;
}
/** 기본 same-origin(Vite proxy 포함). cross-origin 조립 시 baseUrl을 명시합니다. */
export function createHttpClient(options:{baseUrl?:string;fetch?:typeof fetch}={}):FrontendClient {
 const fetcher=options.fetch??globalThis.fetch.bind(globalThis);const base=options.baseUrl??'';
 let csrf:string|null=null;
 let bootstrapRequest:Promise<ReturnType<typeof BootstrapSchema.parse>>|null=null;
 async function request<T>(path:string,schema:z.ZodType<T>,input?:unknown):Promise<T>{
  let response:Response;
  try { response=await fetcher(base+path,{method:input===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:input===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':csrf??''},...(input===undefined?{}:{body:JSON.stringify(input)})}); }
  catch {throw clientError('NETWORK_ERROR','서버에 연결하지 못했습니다. 로컬 서버 상태를 확인한 뒤 같은 요청을 다시 보내세요. 모의 모드로 대체하지 않습니다.');}
  let body:unknown;try {body=await response.json();} catch {throw clientError('CLIENT_PROTOCOL_ERROR','서버 JSON 응답을 확인하지 못했습니다. 상태를 다시 불러오세요.');}
  if(!response.ok){const parsed=FailureSchema.safeParse(body);if(parsed.success)throw {status:response.status,error:parsed.data.error};throw clientError('CLIENT_PROTOCOL_ERROR',`서버 응답 형식 오류 (HTTP ${response.status})`);}
  const parsed=successSchema(schema).safeParse(body);
  if(!parsed.success)throw clientError('CLIENT_PROTOCOL_ERROR','CN-1 응답 형식이 일치하지 않습니다. 완료로 표시하지 않습니다.');
  return parsed.data.data;
 }
 async function bootstrap(){
  // 초기 병렬 로딩의 쿠키와 CSRF가 서로 다른 세션으로 갈라지지 않도록 합칩니다.
  if(!bootstrapRequest)bootstrapRequest=request('/api/bootstrap',BootstrapSchema).then(b=>{csrf=b.csrfToken;return b;}).finally(()=>{bootstrapRequest=null;});
  return bootstrapRequest;
 }
 async function post<T>(path:string,schema:z.ZodType<T>,input:unknown){if(!csrf)await bootstrap();return request(path,schema,input);}
 return {bootstrap,
  createProject:input=>post('/api/projects',CreateProjectResponseSchema,CreateProjectRequestSchema.parse(input)),
  getProject:id=>request(`/api/projects/${encodeURIComponent(id)}`,ProjectSnapshotSchema),
  async mutate<K extends MutationName>(name:K,target:MutationTarget,input:RequestByMutation[K]):Promise<ResponseByMutation[K]> {
   const payload=RequestSchemas[name].parse(input);
   return post(mutationPath(name,target),ResponseSchemas[name] as unknown as z.ZodType<ResponseByMutation[K]>,payload);
  },
  getRun:id=>request(`/api/runs/${encodeURIComponent(id)}`,RunSchema),
  getEvents:(id,after)=>request(`/api/projects/${encodeURIComponent(id)}/events?after=${after}`,EventPageSchema),
  getExports:id=>request(`/api/projects/${encodeURIComponent(id)}/exports`,ExportListSchema)
 };
}
export function assetUrl(projectId:string,assetId:string){return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;}
export function downloadUrl(projectId:string,exportId:string){return `/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportId)}/download`;}
