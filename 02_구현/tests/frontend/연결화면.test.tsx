// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,waitFor,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {계정연결} from '../../src/frontend/컴포넌트/계정연결.js';
afterEach(cleanup);
const state={provider:'agy',status:'unknown',version:null,authMethod:'unknown',checkedAt:null,lastActivityAt:null,message:'아직 확인하지 않았습니다.',errorCode:null,operationId:null,loginUrl:null,needsCode:false,verification:'not_checked'};
it('프로젝트 생성 전 연결 화면은 GET만 실행하고 명시 로그인은 중복 시작하지 않는다',async()=>{
 const connectionClient={list:vi.fn(async()=>({connections:[state]})),act:vi.fn(async()=>({...state,status:'login_pending',operationId:'op'}))};
 render(<App client={createMockClient()} connectionClient={connectionClient as any}/>);
 expect(connectionClient.list).not.toHaveBeenCalled();
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'계정 연결'}));
 expect(await screen.findByRole('heading',{name:'Google/agy'})).toBeVisible();
 expect(connectionClient.act).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Google/agy 로그인 시작'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Google/agy 로그인 시작'})).toBeDisabled());
 expect(connectionClient.act).toHaveBeenCalledTimes(1);
});
it('공식 코드가 필요한 경우만 입력을 보이며 전송 직후 비우고 취소를 제공한다',async()=>{
 const pending={...state,status:'login_pending',operationId:'op',needsCode:true};
 const c={list:vi.fn(async()=>({connections:[pending]})),act:vi.fn((_provider:string,_action:string,_input:unknown)=>new Promise<any>(()=>{}))};
 render(<계정연결 client={c as any}/>);const user=userEvent.setup();
 const input=await screen.findByLabelText('공식 로그인 인증 코드');await user.type(input,'test-code');await user.click(screen.getByRole('button',{name:'인증 코드 전달'}));
 expect(input).toHaveValue('');expect(c.act.mock.calls[0]?.[1]).toBe('code');
 expect(screen.getByRole('button',{name:'Google/agy 연결 작업 취소'})).toBeVisible();
});
it('로그인 코드 필요 상태가 사라지면 메모리의 이전 코드도 지운다',async()=>{
 let pending={...state,status:'login_pending',operationId:'op',needsCode:true};
 const c={list:vi.fn(async()=>({connections:[pending]})),act:vi.fn()};
 render(<계정연결 client={c as any}/>);const user=userEvent.setup();
 await user.type(await screen.findByLabelText('공식 로그인 인증 코드'),'obsolete');
 pending={...pending,needsCode:false};await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));
 await waitFor(()=>expect(screen.queryByLabelText('공식 로그인 인증 코드')).not.toBeInTheDocument());
 pending={...pending,needsCode:true,operationId:'new-op'};await user.click(screen.getByRole('button',{name:'연결 상태 다시 조회'}));
 expect(await screen.findByLabelText('공식 로그인 인증 코드')).toHaveValue('');
});
it('제작 중 agy 확인도 공식 로그인을 열 수 있어 차단한다',async()=>{
 const c={list:vi.fn(async()=>({connections:[state]})),act:vi.fn()};
 render(<계정연결 client={c as any} working/>);
 expect(await screen.findByRole('button',{name:'Google/agy 연결 확인'})).toBeDisabled();
});
it('대기 중 같은 조회 오류가 연속 발생해도 GET 재확인을 계속하며 POST를 만들지 않는다',async()=>{
 vi.useFakeTimers();
 try{
 const c={list:vi.fn().mockResolvedValueOnce({connections:[{...state,status:'login_pending'}]}).mockRejectedValue(new Error('offline')),act:vi.fn()};
 render(<계정연결 client={c as any}/>);await act(async()=>{});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
 expect(c.list).toHaveBeenCalledTimes(4);expect(c.act).not.toHaveBeenCalled();
  }finally{cleanup();vi.useRealTimers();}
});
it('공식 호스트가 아닌 로그인 URL은 링크로 노출하지 않는다',async()=>{
 const c={list:vi.fn(async()=>({connections:[{...state,status:'login_pending',loginUrl:'https://example.org/login'}]})),act:vi.fn()};
 render(<계정연결 client={c as any}/>);await screen.findByRole('heading',{name:'Google/agy'});
 expect(screen.queryByRole('link',{name:'Google/agy 공식 로그인 열기'})).not.toBeInTheDocument();
});
it('Claude 공식 링크와 취소는 현재 operationId를 사용하며 구독 한도를 만들지 않는다',async()=>{
 const pending={...state,provider:'claude',status:'login_pending',operationId:'11111111-1111-4111-8111-111111111111',loginUrl:'https://claude.ai/oauth/authorize'};
 const c={list:vi.fn(async()=>({connections:[pending]})),act:vi.fn(async(_p:string,_a:string,_i:unknown)=>({...pending,status:'login_required',loginUrl:null}))};
 render(<계정연결 client={c as any}/>);const user=userEvent.setup();
 expect(await screen.findByRole('link',{name:'Claude Agent SDK 공식 로그인 열기'})).toHaveAttribute('href',pending.loginUrl);
 expect(screen.queryByLabelText('공식 로그인 인증 코드')).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Claude Agent SDK 연결 작업 취소'}));
 expect(c.act).toHaveBeenCalledWith('claude','cancel',expect.objectContaining({operationId:pending.operationId,requestId:expect.any(String)}));
 expect(await screen.findByText('로그인 필요')).toBeVisible();
 expect(screen.getByRole('button',{name:'Claude Agent SDK 로그인 시작'})).toBeEnabled();
});
