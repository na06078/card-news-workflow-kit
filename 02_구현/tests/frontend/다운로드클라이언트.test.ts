import {describe,expect,it,vi} from 'vitest';
import {createHttpClient} from '../../src/frontend/클라이언트.js';
import {MOCK_IDS} from '../../src/shared/모의자료.js';

function client(reply:()=>Response){
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith('/api/bootstrap')
  ?new Response(JSON.stringify({data:{csrfToken:'local-test',contractVersion:'CN-1'}}),{headers:{'Content-Type':'application/json'}})
  :reply());
 return {api:createHttpClient({fetch:fetcher as typeof fetch}),fetcher};
}

describe('실제 HTTP 다운로드 클라이언트 경계',()=>{
 it('PNG를 JSON으로 읽지 않고 세션 포함 GET으로 Blob을 반환한다',async()=>{
  const {api,fetcher}=client(()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}}));
  expect(typeof api.downloadExport).toBe('function');
  const blob=await api.downloadExport!(MOCK_IDS.project,MOCK_IDS.export);
  expect(blob.size).toBe(3);
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/exports/'+MOCK_IDS.export+'/download');
  expect(fetcher).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({method:'GET',credentials:'include'}));
 });
 it('다운로드 거절의 AppError를 파일로 저장하지 않고 화면에 전달한다',async()=>{
  const failure={code:'EXPORT_STALE',message:'현재 버전을 다시 승인해 주세요.',retryable:false,nextActions:['approve_final'],projectId:MOCK_IDS.project,runId:null,currentVersion:2,details:{}};
  const {api}=client(()=>new Response(JSON.stringify({error:failure}),{status:409,headers:{'Content-Type':'application/json'}}));
  expect(typeof api.downloadExport).toBe('function');
  await expect(api.downloadExport!(MOCK_IDS.project,MOCK_IDS.export)).rejects.toMatchObject({status:409,error:failure});
 });
 it('정상 JSON 기록 파일은 허용하고 HTML/빈 성공 응답은 거절한다',async()=>{
  const records=client(()=>new Response('{"sources":[]}',{headers:{'Content-Type':'application/json'}}));
  expect(typeof records.api.downloadExport).toBe('function');
  expect((await records.api.downloadExport!(MOCK_IDS.project,MOCK_IDS.export)).size).toBeGreaterThan(0);
  for(const response of [()=>new Response('<html>bad</html>',{headers:{'Content-Type':'text/html'}}),()=>new Response(new Uint8Array(),{headers:{'Content-Type':'image/png'}})]){
   const {api}=client(response);
   await expect(api.downloadExport!(MOCK_IDS.project,MOCK_IDS.export)).rejects.toMatchObject({error:{code:'CLIENT_PROTOCOL_ERROR'}});
  }
 });
});
