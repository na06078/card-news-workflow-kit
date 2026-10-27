import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {진행상태,nextText} from '../../src/frontend/컴포넌트/진행상태.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {Run,ProjectSnapshot} from '../../src/shared/포트.js';
import type {WorkspaceClient} from '../../src/shared/작업공간계약.js';
afterEach(()=>{cleanup();history.replaceState(null,'','/');});
const data={refreshing:false,models:{status:'ready' as const,checkedAt:null,models:[],error:null},providers:[]};
const workspace={listProjects:vi.fn(async()=>({projects:[]})),providerStatus:vi.fn(async()=>data),refreshProviders:vi.fn(async()=>data),setProjectModel:vi.fn(),deleteProject:vi.fn()} as WorkspaceClient;
const connections={list:vi.fn(async()=>({connections:[]})),act:vi.fn()};
it.each([['factReview','사실 재검증'],['factApply','사실 수정 적용']] as const)('%s 실행·이력·다음 행동에 새 enum의 의미를 표시한다',(kind,label)=>{
 const p=createMockSnapshot('question');p.activeRun={...p.activeRun!,kind,phase:kind,status:'running'};const run=p.activeRun!;
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={[{seq:1,projectId:p.projectId,runId:run.runId,attempt:1,at:run.createdAt,type:'result',kind:'factReview',version:1}]}/>);
 expect(screen.getByText(`시도 1 · ${label}`)).toBeVisible();expect(screen.getByText(new RegExp(label+'.*진행'))).toBeVisible();fireEvent.click(screen.getByText('시간순 작업 이력 · 1건'));expect(screen.getByText(/사실 재검증 제안 결과 저장/)).toBeVisible();
 expect(nextText.reverify_facts).toMatch(/사실.*재검증/);expect(nextText.apply_fact_proposal).toMatch(/제안.*적용/);expect(nextText.rebuild_exports).toMatch(/파일.*다시/);
});
it('worker 불가는 원시 reason을 숨기고 조사 버튼 옆에 명시한다',async()=>{
 const p=createMockSnapshot('selection');p.execution={worker:{state:'unavailable',reason:'C:/secret/token',checkedAt:null},queue:null};
 render(<App client={createMockClient(p)} workspaceClient={workspace} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});await userEvent.setup().click(screen.getByRole('button',{name:/주제·조사/}));const button=screen.getByRole('button',{name:'자료 조사 시작'});expect(button).toBeDisabled();expect(button.closest('section')).toHaveTextContent('작업 처리기를 사용할 수 없습니다');expect(document.body).not.toHaveTextContent('secret');
});
it('실제 worker 종료 정리 실패 코드를 일반 불가로 숨기지 않는다',async()=>{
 const p=createMockSnapshot('selection');p.execution={worker:{state:'unavailable',reason:'CANCEL_CLEANUP_FAILED',checkedAt:null},queue:null};
 render(<App client={createMockClient(p)} workspaceClient={workspace} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});
 expect(screen.getByRole('region',{name:'실행 환경 상태'})).toHaveTextContent('하위 작업의 종료·정리를 확인하지 못했습니다');
});
it('대기 프로젝트 링크도 불명 요청의 이동 잠금을 우회하지 않는다',async()=>{
 const p=createMockSnapshot('question'),other='22222222-2222-4222-8222-222222222222';p.execution={worker:{state:'busy',reason:null,checkedAt:null},queue:{blockingProjectId:other,reason:'running'}};const c=createMockClient(p);vi.spyOn(c,'getProject');c.mutate=vi.fn(async()=>{throw {status:503,error:{code:'UNKNOWN',message:'유실',nextActions:[],details:{requestOutcome:'unknown'}}};});
 render(<App client={c} workspaceClient={workspace} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'작업 취소 요청'}));await waitFor(()=>expect(screen.getByRole('link',{name:'대기 원인 프로젝트 열기'})).toHaveAttribute('aria-disabled','true'));await user.click(screen.getByRole('link',{name:'대기 원인 프로젝트 열기'}));expect(c.getProject).not.toHaveBeenCalledWith(other);expect(location.search).toContain(p.projectId);await user.click(screen.getByRole('button',{name:'같은 요청 다시 보내기'}));expect(vi.mocked(c.mutate).mock.calls[1]).toEqual(vi.mocked(c.mutate).mock.calls[0]);
});
it.each([['running','다른 프로젝트의 작업 실행'],['waiting_for_user','다른 프로젝트의 질문 답변'],['cancel_requested','다른 프로젝트의 취소 정리']] as const)('전역 %s 대기는 worker 장애와 구분하고 대상 프로젝트를 연결한다',async(reason,label)=>{
 const p=createMockSnapshot('question'),other='22222222-2222-4222-8222-222222222222';p.execution={worker:{state:'busy',reason:null,checkedAt:null},queue:{blockingProjectId:other,reason}};
 render(<App client={createMockClient(p)} workspaceClient={workspace} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});expect(screen.getByText(new RegExp(label))).toBeVisible();expect(screen.getByRole('link',{name:'대기 원인 프로젝트 열기'})).toHaveAttribute('href',`?project=${other}`);expect(screen.queryByText(/작업 처리기를 사용할 수 없습니다/)).not.toBeInTheDocument();
});
