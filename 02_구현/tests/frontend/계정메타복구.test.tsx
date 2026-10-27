import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {계정연결} from '../../src/frontend/컴포넌트/계정연결.js';
import {사용량패널} from '../../src/frontend/컴포넌트/사용량패널.js';
import type {ConnectionState} from '../../src/shared/연결계약.js';
import type {ProviderDashboard} from '../../src/shared/작업공간계약.js';
afterEach(cleanup);
it('정리 미확인은 native 시작·검사를 막지만 읽기 재조회는 허용하고 정확한 창을 설명한다',async()=>{
 const c:ConnectionState={provider:'agy',status:'error',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'정리 확인 필요',errorCode:'NATIVE_CLEANUP_UNCONFIRMED',operationId:null,loginUrl:null,needsCode:false,verification:'not_checked'};
 const client={list:vi.fn(async()=>({connections:[c]})),act:vi.fn()};render(<계정연결 client={client}/>);
 expect(await screen.findByRole('button',{name:'Google/agy 로그인 시작'})).toBeDisabled();expect(screen.getByRole('button',{name:'Google/agy 연결 확인'})).toBeDisabled();expect(screen.getByText(/계정 연결 전용 창·하위 프로세스/)).toBeVisible();await userEvent.setup().click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));expect(client.list).toHaveBeenCalledTimes(2);expect(client.act).not.toHaveBeenCalled();
});
it('native 시작 응답의 정리 오류도 다음 로그인·검사를 잠근다',async()=>{
 const c:ConnectionState={provider:'agy',status:'unknown',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'미확인',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'not_checked'};
 const client={list:vi.fn(async()=>({connections:[c]})),act:vi.fn(async()=>{throw {status:503,error:{code:'NATIVE_CLEANUP_UNCONFIRMED',message:'정리 미확인',details:{}}};})};render(<계정연결 client={client}/>);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Google/agy 로그인 시작'}));
 expect(await screen.findByRole('button',{name:'Google/agy 로그인 시작'})).toBeDisabled();expect(screen.getByRole('button',{name:'Google/agy 연결 확인'})).toBeDisabled();expect(client.act).toHaveBeenCalledTimes(1);
});
it('사용량 조회의 안전 코드 원인을 요약 근처에도 표시하며 과거 수치를 보존한다',()=>{
 const data:ProviderDashboard={refreshing:false,models:{status:'unknown',checkedAt:null,models:[],error:null},providers:[{provider:'claude',label:'Claude',status:'error',checkedAt:'2026-10-24T00:00:00Z',message:null,errorCode:'AUTH_PATH_FORBIDDEN',metrics:[{id:'week',label:'주간',remainingPercent:42,resetsAt:null,scope:'account',source:'SDK'}]}]};
 render(<사용량패널 data={data} error="" refresh={vi.fn()}/>);expect(screen.getAllByText('42%')[0]).toBeVisible();expect(screen.getAllByText(/허용되지 않은 인증 경로/)[0]).toBeVisible();
});
