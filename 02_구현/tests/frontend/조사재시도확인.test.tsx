// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {DomainError} from '../../src/backend/도메인.js';
afterEach(cleanup);
function fixture(){
 const p=createMockSnapshot('question');
 p.lastRun={...p.activeRun!,kind:'research',phase:'research',status:'failed',attempt:3,questionId:null,error:new DomainError('SESSION_RECOVERY_UNVERIFIED').error,externalOutcome:'not_started',retryAllowed:true,retryRequiresUnknownConfirmation:true};
 p.activeRun=null;p.question=null;p.status='error';p.stage='research';p.allowedActions=['retry'];
 return p;
}
test('최신 조사가 미시작이어도 이전 결과 불명 확인 전에는 재시도하지 않는다',async()=>{
 const p=fixture(),send=vi.fn(async()=>{}),user=userEvent.setup();
 render(<진행상태 p={p} busy={false} send={send} events={[]}/>);
 const retry=screen.getByRole('button',{name:'실패·중단 작업 재시도'});
 expect(retry).toBeDisabled();await user.click(retry);expect(send).not.toHaveBeenCalled();
 await user.click(screen.getByRole('checkbox',{name:'외부 실행 결과가 불명확하여 중복 호출될 수 있음을 확인했습니다'}));
 expect(retry).toBeEnabled();await user.click(retry);
 expect(send).toHaveBeenCalledExactlyOnceWith('retry',{confirmUnknownOutcome:true});
});
test('실행 번호가 바뀌면 이전 중복 호출 확인을 다음 실행에 재사용하지 않는다',async()=>{
 const p=fixture(),send=vi.fn(async()=>{}),user=userEvent.setup();
 const view=render(<진행상태 p={p} busy={false} send={send} events={[]}/>);
 const label='외부 실행 결과가 불명확하여 중복 호출될 수 있음을 확인했습니다';
 await user.click(screen.getByRole('checkbox',{name:label}));
 expect(screen.getByRole('button',{name:'실패·중단 작업 재시도'})).toBeEnabled();
 const next={...p,lastRun:{...p.lastRun!,runId:'d2222222-2222-4222-8222-222222222222',attempt:4}};
 view.rerender(<진행상태 p={next} busy={false} send={send} events={[]}/>);
 expect(screen.getByRole('checkbox',{name:label})).not.toBeChecked();
 const retry=screen.getByRole('button',{name:'실패·중단 작업 재시도'});
 expect(retry).toBeDisabled();await user.click(retry);expect(send).not.toHaveBeenCalled();
});
