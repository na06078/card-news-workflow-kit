import {describe,it,expect,vi} from 'vitest';
import {createHttpClient} from '../../src/frontend/클라이언트.js';
import {MOCK_IDS,createMockSnapshot} from '../../src/shared/모의자료.js';

describe('실제 HTTP 경계',()=>{
 it('bootstrap 쿠키와 CSRF를 사용하고 선택 요청의 조사 버전을 그대로 보낸다',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),init});return new Response(JSON.stringify({data:calls.length===1?{csrfToken:'local-token',contractVersion:'CN-1'}:{projectId:MOCK_IDS.project,projectVersion:3,runId:MOCK_IDS.run,status:'queued',accepted:true,selectedCandidateIds:[MOCK_IDS.candidate]}}),{status:200});});
  const client=createHttpClient({fetch:fetcher});await client.bootstrap();
  await client.mutate('selection',{projectId:MOCK_IDS.project},{requestId:MOCK_IDS.question,version:1,candidateIds:[MOCK_IDS.candidate]});
  expect(calls[1]?.url).toBe(`/api/projects/${MOCK_IDS.project}/selection`);
  expect(calls[1]?.init?.credentials).toBe('include');expect(new Headers(calls[1]?.init?.headers).get('X-CSRF-Token')).toBe('local-token');
  expect(JSON.parse(String(calls[1]?.init?.body)).version).toBe(1);
 });
 it('서버 오류를 보존하며 모의 데이터로 대체하지 않는다',async()=>{
  const error={code:'LOGIN_REQUIRED',message:'공식 로그인 필요',retryable:false,nextActions:['check_login'],projectId:null,runId:null,currentVersion:null,details:{}};
  const client=createHttpClient({fetch:vi.fn(async()=>new Response(JSON.stringify({error}),{status:409}))});
  await expect(client.getProject(MOCK_IDS.project)).rejects.toEqual({status:409,error});
 });
 it('공유 스키마로 응답을 검사한다',async()=>{
  const client=createHttpClient({fetch:vi.fn(async()=>new Response(JSON.stringify({data:{...createMockSnapshot(),projectVersion:0}})))});
  await expect(client.getProject(MOCK_IDS.project)).rejects.toMatchObject({error:{code:'CLIENT_PROTOCOL_ERROR'}});
 });
});
