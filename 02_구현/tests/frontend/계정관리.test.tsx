// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,waitFor,act,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ConnectionState,ConnectionProvider} from '../../src/shared/연결계약.js';
import type {ConnectionClient} from '../../src/frontend/연결클라이언트.js';
import {계정연결} from '../../src/frontend/컴포넌트/계정연결.js';
afterEach(()=>{cleanup();vi.useRealTimers();});
const state=(provider:ConnectionProvider='agy',extra:Partial<ConnectionState>={}):ConnectionState=>({provider,status:'connected',version:null,authMethod:provider==='agy'?'google_account':'subscription',checkedAt:null,lastActivityAt:null,message:'확인됨',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'metadata',accountId:provider+'@example.test',...extra});
const fake=(connections:ConnectionState[])=>({list:vi.fn(async()=>({connections})),act:vi.fn<ConnectionClient['act']>()});
it('자동 확인 중에는 수동 완료를 요구하지 않고 웹 관측만 기다린다',async()=>{
 const c=fake([state('agy',{status:'login_pending',externalConsole:true,autoConfirm:true} as Partial<ConnectionState>&{autoConfirm:boolean})]);
 render(<계정연결 client={c}/>);
 expect(await screen.findByRole('button',{name:'계정 자동 확인 중'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'로그인 완료 후 연결 확인'})).not.toBeInTheDocument();
 expect(screen.getByText(/웹에 자동 반영되고 연결 창은 닫힙니다/)).toBeVisible();
 expect(c.act).not.toHaveBeenCalled();
});
it('로그아웃 외부 창은 자동 완료 표시와 무관하게 수동 확인을 유지한다',async()=>{
 const c=fake([state('agy',{status:'logout_pending',externalConsole:true,autoConfirm:true,accountId:null})]);
 render(<계정연결 client={c}/>);
 expect(await screen.findByRole('button',{name:'로그아웃 진행 확인'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'계정 자동 확인 중'})).not.toBeInTheDocument();
 expect(c.act).not.toHaveBeenCalled();
});
it('명시 dialog 취소는 요청0이며 확인만 현재 ID와 confirm true를 보내고 실제 결과로 ID를 지운다',async()=>{
 const c=fake([state()]);c.act.mockResolvedValue(state('agy',{status:'login_required',accountId:null}));render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 로그아웃'}));
 let dialog=screen.getByRole('dialog',{name:'Google/agy 로그아웃 확인'});
 expect(within(dialog).getByText('agy@example.test')).toBeVisible();expect(dialog).toHaveTextContent('CLI/SDK/Antigravity App/IDE');expect(dialog).toHaveTextContent('프로젝트·카드·결과물은 삭제되지 않습니다');
 await user.click(within(dialog).getByRole('button',{name:'취소'}));expect(c.act).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Google/agy 로그아웃'}));dialog=screen.getByRole('dialog');
 await user.click(within(dialog).getByRole('button',{name:'로그아웃 확인'}));
 expect(c.act).toHaveBeenCalledExactlyOnceWith('agy','logout',{requestId:expect.any(String),confirm:true,expectedAccountId:'agy@example.test'});
 await waitFor(()=>expect(screen.queryByText('agy@example.test')).not.toBeInTheDocument());expect(await screen.findByText('로그인 필요')).toBeVisible();
});
it('외부 공식 콘솔 대기 중 신뢰·Google 로그인 안내와 명시 연결 확인을 제공한다',async()=>{
 const c=fake([state('agy',{status:'login_pending',externalConsole:true})]);c.act.mockResolvedValue(state());render(<계정연결 client={c}/>);const user=userEvent.setup();
 const check=await screen.findByRole('button',{name:'로그인 완료 후 연결 확인'});expect(check).toBeEnabled();expect(screen.getByText(/워크스페이스 신뢰/)).toBeVisible();
 expect(c.act).not.toHaveBeenCalled();await user.click(check);expect(c.act).toHaveBeenCalledExactlyOnceWith('agy','check',{requestId:expect.any(String)});
});
it('logout_pending도 1.5초 GET polling하고 POST를 자동 전송하지 않는다',async()=>{
 vi.useFakeTimers();const c=fake([state('agy',{status:'logout_pending',accountId:null})]);render(<계정연결 client={c}/>);await act(async()=>{});
 expect(screen.getByText('로그아웃 확인 중')).toBeVisible();await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(c.list).toHaveBeenCalledTimes(3);expect(c.act).not.toHaveBeenCalled();
});
it('확인창 중 현재 계정이 바뀌면 닫고 이전 계정 로그아웃을 요청하지 않는다',async()=>{
 let current=state();const c=fake([]);c.list.mockImplementation(async()=>({connections:[current]}));render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 로그아웃'}));current=state('agy',{accountId:'changed@example.test'});
 await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(c.act).not.toHaveBeenCalled();
});
it('제작이 시작되거나 검증되지 않은 상태에서는 로그아웃하지 않는다',async()=>{
 const c=fake([state(),state('claude',{verification:'not_checked'})]);const v=render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 로그아웃'}));expect(screen.getByRole('button',{name:'Claude Agent SDK 로그아웃'})).toBeDisabled();v.rerender(<계정연결 client={c} working/>);
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(screen.getByRole('button',{name:'Google/agy 로그아웃'})).toBeDisabled();expect(c.act).not.toHaveBeenCalled();
});
it('전송 중 중복 로그아웃을 막고 실패를 성공처럼 숨기지 않는다',async()=>{
 const c=fake([state()]);let reject!:(e:unknown)=>void;c.act.mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 로그아웃'}));await user.click(screen.getByRole('button',{name:'로그아웃 확인'}));
 expect(screen.getByRole('button',{name:'Google/agy 로그아웃'})).toBeDisabled();expect(screen.getByText('agy@example.test')).toBeVisible();
 await act(async()=>reject({status:502,error:{code:'EXTERNAL_OUTCOME_UNKNOWN',message:'실제 로그아웃 결과 미확인'}}));expect(await screen.findByRole('alert')).toHaveTextContent('실제 로그아웃 결과 미확인');expect(c.act).toHaveBeenCalledTimes(1);expect(screen.getByText('agy@example.test')).toBeVisible();
});
it('클라이언트 교체 후 이전 작업의 늦은 응답이 새 계정을 덮어쓰지 않는다',async()=>{
 const old=fake([state()]);let resolve!:(s:ConnectionState)=>void;old.act.mockImplementation(()=>new Promise(r=>{resolve=r;}));const v=render(<계정연결 client={old}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 연결 확인'}));const next=fake([state('agy',{accountId:'new@example.test'})]);v.rerender(<계정연결 client={next}/>);await screen.findByText('new@example.test');
 await act(async()=>resolve(state()));expect(screen.queryByText('agy@example.test')).not.toBeInTheDocument();expect(screen.getByText('new@example.test')).toBeVisible();
});
it('인증 작업 ID가 바로 교체되어도 이전 입력 코드를 새 작업에 보존하지 않는다',async()=>{
 let current=state('claude',{status:'login_pending',operationId:'old',needsCode:true});const c=fake([]);c.list.mockImplementation(async()=>({connections:[current]}));render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.type(await screen.findByLabelText('공식 로그인 인증 코드'),'fake-test-code');current={...current,operationId:'new'};await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));await waitFor(()=>expect(screen.getByLabelText('공식 로그인 인증 코드')).toHaveValue(''));
});
it('늦은 GET은 명시 로그아웃 결과를 덮어쓰지 않는다',async()=>{
 const c=fake([state()]);c.act.mockResolvedValue(state('agy',{status:'login_required',accountId:null}));render(<계정연결 client={c}/>);const user=userEvent.setup();await screen.findByText('agy@example.test');
 let resolve!:(s:{connections:ConnectionState[]})=>void;c.list.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));
 await user.click(screen.getByRole('button',{name:'Google/agy 로그아웃'}));await user.click(screen.getByRole('button',{name:'로그아웃 확인'}));await act(async()=>resolve({connections:[state()]}));expect(screen.queryByText('agy@example.test')).not.toBeInTheDocument();
});
it('같은 계정의 GET 갱신은 유효한 확인을 무효화하지 않는다',async()=>{
 const c=fake([]);c.list.mockImplementation(async()=>({connections:[state()]}));c.act.mockResolvedValue(state('agy',{status:'logout_pending',accountId:null}));render(<계정연결 client={c}/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Google/agy 로그아웃'}));await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));await waitFor(()=>expect(c.list).toHaveBeenCalledTimes(2));await user.click(screen.getByRole('button',{name:'로그아웃 확인'}));expect(c.act).toHaveBeenCalledTimes(1);
});
it('두 제공자의 현재 전체 계정 ID를 표시하며 ID 미제공은 확인 필요로 구분한다',async()=>{
 const c=fake([state(),state('claude')]);const view=render(<계정연결 client={c}/>);
 expect(await screen.findByText('agy@example.test')).toBeVisible();expect(screen.getByText('claude@example.test')).toBeVisible();
 const unknown=fake([state('agy',{accountId:null})]);view.rerender(<계정연결 client={unknown}/>);
 expect(await screen.findByText('계정 ID 확인 필요')).toBeVisible();expect(screen.getByRole('button',{name:'Google/agy 로그아웃'})).toBeDisabled();
});
