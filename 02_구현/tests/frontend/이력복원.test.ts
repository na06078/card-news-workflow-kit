import {it,expect,vi} from 'vitest';
import {createController} from '../../src/frontend/상태.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';
import type {FrontendClient,EngineEvent} from '../../src/shared/포트.js';
const event=(seq:number):EngineEvent=>({seq,projectId:MOCK_IDS.project,runId:MOCK_IDS.run,attempt:1,at:'2026-10-23T00:00:00Z',type:'result',kind:'cards',version:seq});
it('종료 프로젝트도 여러 페이지의 저장 이력을 순서대로 중복 없이 복원한다',async()=>{
 const p=createMockSnapshot('review');p.activeRun=null;
 const getEvents=vi.fn().mockResolvedValueOnce({events:[event(2),event(1)],nextSeq:2,hasMore:true}).mockResolvedValueOnce({events:[event(2),event(3)],nextSeq:3,hasMore:false});
 const c={bootstrap:vi.fn(),getProject:vi.fn(async()=>p),getEvents} as unknown as FrontendClient;
 const ctl=createController(c);await ctl.open(p.projectId);
 expect(ctl.getState().events.map(e=>e.seq)).toEqual([1,2,3]);expect(getEvents.mock.calls[1]).toEqual([p.projectId,2]);
});
it('이전 프로젝트의 늦은 이력 응답이 새 프로젝트에 섞이지 않는다',async()=>{
 const p=createMockSnapshot('review'),other={...p,projectId:'22222222-2222-4222-8222-222222222222'};
 let finish!:(value:any)=>void;
 const c={bootstrap:vi.fn(),getProject:vi.fn(async(id:string)=>id===p.projectId?p:other),getEvents:vi.fn((id:string)=>id===p.projectId?new Promise(r=>{finish=r;}):Promise.resolve({events:[],nextSeq:0,hasMore:false}))} as unknown as FrontendClient;
 const ctl=createController(c),first=ctl.open(p.projectId);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 await ctl.open(other.projectId);finish({events:[event(1)],nextSeq:1,hasMore:false});await first;
 expect(ctl.getState().snapshot?.projectId).toBe(other.projectId);expect(ctl.getState().events).toEqual([]);
});
it('종료 상태로 바뀐 조회에서 이력 실패가 나도 다음 조회 대상으로 남긴다',async()=>{
 const p=createMockSnapshot('review');p.activeRun=null;
 const c={bootstrap:vi.fn(),getProject:vi.fn(async()=>p),getEvents:vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({events:[event(1)],nextSeq:1,hasMore:false})} as unknown as FrontendClient;
 const ctl=createController(c);await ctl.open(p.projectId);expect(ctl.getState().historyMore).toBe(true);
 await ctl.poll();expect(ctl.getState().events).toHaveLength(1);expect(ctl.getState().historyMore).toBe(false);
});
it('요청 직후 실패 스냅샷이면 오래된 접수 안내를 남기지 않는다',async()=>{
 const p=createMockSnapshot('selection'),failed={...p,status:'error' as const,lastRun:{...createMockSnapshot('review').lastRun!,status:'failed' as const}};
 const c={bootstrap:vi.fn(),getProject:vi.fn().mockResolvedValueOnce(p).mockResolvedValue(failed),getEvents:vi.fn(async()=>({events:[],nextSeq:0,hasMore:false})),mutate:vi.fn(async()=>({projectVersion:p.projectVersion}))} as unknown as FrontendClient;
 const ctl=createController(c);await ctl.open(p.projectId);await ctl.send('research');expect(ctl.getState().notice).not.toContain('접수');
});
it('20페이지씩 나눠 가져와 마지막 페이지까지 이력을 버리지 않는다',async()=>{
 const p=createMockSnapshot('review');let n=0;
 const c={bootstrap:vi.fn(),getProject:vi.fn(async()=>p),getEvents:vi.fn(async()=>{n++;return {events:[event(n)],nextSeq:n,hasMore:n<23};})} as unknown as FrontendClient;
 const ctl=createController(c);await ctl.open(p.projectId);expect(n).toBe(20);expect(ctl.getState().historyMore).toBe(true);
 await ctl.poll();expect(n).toBe(23);expect(ctl.getState().events).toHaveLength(23);expect(ctl.getState().historyMore).toBe(false);
});
it('새 프로젝트로 전환한 뒤 이전 mutation 실패가 현재 화면 오류를 덮지 않는다',async()=>{
 const p=createMockSnapshot('selection'),other={...p,projectId:'22222222-2222-4222-8222-222222222222'};let reject!:(e:unknown)=>void;
 const c={bootstrap:vi.fn(),getProject:vi.fn(async(id:string)=>id===p.projectId?p:other),getEvents:vi.fn(async()=>({events:[],nextSeq:0,hasMore:false})),mutate:vi.fn(()=>new Promise((_,r)=>{reject=r;}))} as unknown as FrontendClient;
 const ctl=createController(c);await ctl.open(p.projectId);const sending=ctl.send('research');await ctl.open(other.projectId);reject(new Error('old failure'));await sending;
 expect(ctl.getState().error).toBeNull();expect(ctl.getState().pendingRetry).toBe(false);
});
