import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {모델선택} from '../../src/frontend/컴포넌트/모델선택.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ModelCatalog,WorkspaceClient} from '../../src/shared/작업공간계약.js';
afterEach(cleanup);
const catalog:ModelCatalog={status:'error',checkedAt:null,models:[],error:'조회 실패',errorCode:'METADATA_UNAVAILABLE'};
it('목록 실패는 기존 명시 모델을 유지하며 사용자 버튼만 기본 모델을 선택한다',async()=>{
 const onDefault=vi.fn(),user=userEvent.setup();render(<모델선택 p={null} catalog={catalog} client={undefined} value="saved-model" onDefault={onDefault} onLock={vi.fn()}/>);
 expect(screen.getByLabelText('Claude 모델')).toHaveValue('saved-model');expect(onDefault).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'SDK 기본 모델 사용 선택'}));expect(onDefault).toHaveBeenCalledExactlyOnceWith(null);expect(screen.getByText(/모델·사용량 정보를 조회하지 못했습니다/)).toBeVisible();
});
it('서버 미적용 증명 모델 오류는 잠금을 풀고 과거 모델을 유지한다',async()=>{
 const p={...createMockSnapshot('selection'),claudeModel:'saved-model'},onLock=vi.fn();const client={setProjectModel:vi.fn(async()=>{throw {status:503,error:{message:'목록 실패',details:{requestOutcome:'rejected'}}};})} as unknown as WorkspaceClient;
 render(<모델선택 p={p} catalog={catalog} client={client} value={null} onDefault={vi.fn()} onLock={onLock}/>);await userEvent.setup().click(screen.getByRole('button',{name:'SDK 기본 모델 사용 선택'}));
 await waitFor(()=>expect(onLock).toHaveBeenLastCalledWith(false));expect(screen.queryByRole('button',{name:'모델 설정 같은 요청 다시 보내기'})).not.toBeInTheDocument();expect(screen.getByLabelText('Claude 모델')).toHaveValue('saved-model');
});
it('실제 불명 모델 설정은 새 입력을 잠그고 재전송 ID·입력을 유지한다',async()=>{
 const p=createMockSnapshot('selection'),onLock=vi.fn(),send=vi.fn<WorkspaceClient['setProjectModel']>(async()=>{throw {status:503,error:{message:'불명',details:{requestOutcome:'unknown'}}};});
 render(<모델선택 p={p} catalog={catalog} client={{setProjectModel:send} as unknown as WorkspaceClient} value={null} onDefault={vi.fn()} onLock={onLock}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'SDK 기본 모델 사용 선택'}));await user.click(await screen.findByRole('button',{name:'모델 설정 같은 요청 다시 보내기'}));expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);expect(onLock).not.toHaveBeenCalledWith(false);expect(screen.getByText(/모델 설정 결과가 미확정/)).toBeVisible();
});
