import {it,expect,vi} from 'vitest';
import {createController} from '../../src/frontend/상태.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
const p=createMockSnapshot('selection');
it('서버가 미적용을 증명한 503은 pending을 풀고 이동할 수 있다',async()=>{
 const c=createMockClient(p);c.mutate=vi.fn(async()=>{throw {status:503,error:{code:'MODEL_CATALOG_UNAVAILABLE',message:'미확인',details:{requestOutcome:'rejected'}}};});
 const ctl=createController(c);await ctl.open(p.projectId);await ctl.send('research');
 expect(ctl.getState().pendingRetry).toBe(false);ctl.reset();expect(ctl.getState().snapshot).toBeNull();
});
it('진짜 불명은 조회 성공 뒤에도 이전 오류와 동일 payload를 보호한다',async()=>{
 const c=createMockClient(p);c.mutate=vi.fn(async()=>{throw {status:503,error:{code:'UNKNOWN',message:'유실',details:{requestOutcome:'unknown'}}};});
 const ctl=createController(c);await ctl.open(p.projectId);await ctl.send('research');await ctl.refreshSafely();
 expect(ctl.getState().pendingRetry).toBe(true);expect(ctl.getState().notice).toMatch(/결과.*미확정/);ctl.reset();expect(ctl.getState().snapshot).not.toBeNull();await ctl.retryPending();
 expect(vi.mocked(c.mutate).mock.calls[1]).toEqual(vi.mocked(c.mutate).mock.calls[0]);
});
it('polling 회복도 과거 오류와 최신 저장 상태를 구분하고 unknown 잠금을 유지한다',async()=>{
 const c=createMockClient(p);c.mutate=vi.fn(async()=>{throw {status:503,error:{code:'UNKNOWN',message:'유실',details:{requestOutcome:'unknown'}}};});const ctl=createController(c);await ctl.open(p.projectId);await ctl.send('research');await ctl.poll();expect(ctl.getState().notice).toMatch(/결과.*미확정/);expect(ctl.getState().pendingRetry).toBe(true);
});
it('거절 후 조회가 회복되면 과거 요청 오류와 최신 상태를 구별한다',async()=>{
 const c=createMockClient(p);c.mutate=vi.fn(async()=>{throw {status:422,error:{code:'VALIDATION_ERROR',message:'이전 입력',details:{}}};});
 const ctl=createController(c);await ctl.open(p.projectId);await ctl.send('research');await ctl.refreshSafely();expect(ctl.getState().notice).toMatch(/이전 요청 오류/);expect(ctl.getState().error?.error.message).toBe('이전 입력');
});
