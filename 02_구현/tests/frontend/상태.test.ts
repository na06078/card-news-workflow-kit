import {describe,it,expect,vi} from 'vitest';
import {createController,versionFor,canFinalApprove} from '../../src/frontend/상태.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';
import type {FrontendClient} from '../../src/shared/포트.js';
function client(){return {bootstrap:vi.fn(async()=>({csrfToken:'x',contractVersion:'CN-1' as const})),getProject:vi.fn(async()=>createMockSnapshot('selection')),mutate:vi.fn(),getEvents:vi.fn(async()=>({events:[],nextSeq:0,hasMore:false})),getExports:vi.fn(),createProject:vi.fn(),getRun:vi.fn()} as unknown as FrontendClient;}
describe('원장 기반 화면 상태',()=>{
 it('중복 제출을 막고 응답 유실 재전송은 같은 requestId와 payload를 쓴다',async()=>{
  const c=client();let reject!:(x:unknown)=>void;
  const mutate=vi.mocked(c.mutate);mutate.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
  const ctl=createController(c);await ctl.open(MOCK_IDS.project);
  const first=ctl.send('selection',{candidateIds:[MOCK_IDS.candidate]});
  await ctl.send('selection',{candidateIds:[MOCK_IDS.candidate]});expect(mutate).toHaveBeenCalledTimes(1);
  reject({status:0,error:{code:'NETWORK_ERROR',message:'유실'}});await first;
  mutate.mockResolvedValueOnce({projectId:MOCK_IDS.project,projectVersion:3,runId:MOCK_IDS.run,status:'queued',accepted:true,selectedCandidateIds:[MOCK_IDS.candidate]});
  await ctl.retryPending();expect(mutate.mock.calls[1]?.[2]).toEqual(mutate.mock.calls[0]?.[2]);
 });
 it('충돌 후 GET을 갱신하고 자동 덮어쓰기/동일 충돌 재전송을 하지 않는다',async()=>{
  const c=client();vi.mocked(c.mutate).mockRejectedValue({status:409,error:{code:'VERSION_CONFLICT',message:'갱신 필요'}});
  const ctl=createController(c);await ctl.open(MOCK_IDS.project);await ctl.send('selection',{candidateIds:[MOCK_IDS.candidate]});
  expect(c.getProject).toHaveBeenCalledTimes(2);expect(ctl.getState().pendingRetry).toBe(false);expect(ctl.getState().error?.error.code).toBe('VERSION_CONFLICT');
 });
 it('늦게 도착한 이전 스냅샷으로 현재 버전을 되돌리지 않는다',async()=>{
  const c=client();const newer={...createMockSnapshot('selection'),projectVersion:8};
  const ctl=createController(c);vi.mocked(c.getProject).mockResolvedValueOnce(newer);await ctl.open(MOCK_IDS.project);await ctl.refresh();expect(ctl.getState().snapshot?.projectVersion).toBe(8);
 });
 it('대상별 버전을 사용하며 facts/visual 검사와 최종 승인을 구분한다',()=>{
  const p=createMockSnapshot('review');expect(versionFor(p,'selection')).toBe(p.researchVersion);expect(versionFor(p,'approve',{stage:'final'})).toBe(p.result?.version);
  expect(canFinalApprove(p)).toBe(true);p.result!.visualCheck='pending';expect(canFinalApprove(p)).toBe(false);
 });
});
