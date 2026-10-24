// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {DomainError} from '../../src/backend/도메인.js';
afterEach(cleanup);

test.each([
 ['research','자료 조사를 진행하고 있습니다.'],
 ['editorial','선택한 소식의 근거 확인과 기획을 진행하고 있습니다.'],
 ['production','실제 이미지 생성과 카드 렌더링을 진행하고 있습니다.'],
 ['revision','저장된 수정 요청을 처리하고 있습니다.'],
 ['export','PNG·ZIP·기록 파일을 준비하고 있습니다.'],
] as const)('실행 중인 %s는 저장 확인이 아닌 실제 작업 단계를 설명한다',async(kind,text)=>{
 const p=createMockSnapshot('question');p.question=null;p.activeRun={...p.activeRun!,kind,status:'running',questionId:null};p.status='working';
 render(<진행상태 p={p} busy={false} send={vi.fn(async()=>{})} events={[]}/>);
 expect(screen.getByText(text)).toBeVisible();expect(screen.queryByText('서버 저장 상태를 확인하고 있습니다.')).not.toBeInTheDocument();
});

test('실패 부제는 실행 종료를 알리고 결과 불명 재시도는 명시 확인 전까지 비활성이다',async()=>{
 const p=createMockSnapshot('question');
 p.lastRun={...p.activeRun!,status:'failed',questionId:null,error:new DomainError('TOOL_PERMISSION_DENIED').error,externalOutcome:'unknown',retryAllowed:true};
 p.activeRun=null;p.question=null;p.status='error';p.allowedActions=['retry'];
 const send=vi.fn(async()=>{}),user=userEvent.setup();
 const view=render(<진행상태 p={p} busy={false} send={send} events={[]}/>);
 expect(screen.getByRole('heading',{name:'작업 실패'})).toBeVisible();
 expect(screen.queryByText('서버 저장 상태를 확인하고 있습니다.')).not.toBeInTheDocument();
 expect(screen.getByText('작업이 실패했습니다. 오류와 저장된 기록을 확인한 뒤 재시도 여부를 결정하세요.')).toBeVisible();
 const retry=screen.getByRole('button',{name:'실패·중단 작업 재시도'});
 expect(retry).toBeDisabled();await user.click(retry);expect(send).not.toHaveBeenCalled();
 await user.click(screen.getByRole('checkbox',{name:'외부 실행 결과가 불명확하여 중복 호출될 수 있음을 확인했습니다'}));
 expect(retry).toBeEnabled();
 view.rerender(<진행상태 p={p} busy={true} send={send} events={[]}/>);expect(retry).toBeDisabled();
 view.rerender(<진행상태 p={p} busy={false} send={send} events={[]}/>);
 await user.click(retry);expect(send).toHaveBeenCalledExactlyOnceWith('retry',{confirmUnknownOutcome:true});
});
