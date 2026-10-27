import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ProviderDashboard,WorkspaceClient} from '../../src/shared/작업공간계약.js';
const dashboard:ProviderDashboard={refreshing:false,models:{status:'ready',checkedAt:null,error:null,models:[{value:'explicit-model',displayName:'확인된 모델',description:''}]},providers:[]};
const workspace=(data=dashboard):WorkspaceClient=>({listProjects:vi.fn(async()=>({projects:[]})),providerStatus:vi.fn(async()=>data),refreshProviders:vi.fn(async()=>data),setProjectModel:vi.fn(),deleteProject:vi.fn()});
const connections={list:vi.fn(async()=>({connections:[]})),act:vi.fn()};
afterEach(()=>{cleanup();history.replaceState(null,'','/');});
it('이미 SDK 기본값인 새 프로젝트는 목록 미확인만으로 추가 확인을 강제하지 않는다',async()=>{
 const user=userEvent.setup(),c=createMockClient();c.createProject=vi.fn(c.createProject);const data={...dashboard,models:{...dashboard.models,status:'error' as const,models:[],error:'조회 실패'}};
 history.replaceState(null,'','/?view=new');render(<App client={c} workspaceClient={workspace(data)} connectionClient={connections}/>);await user.type(screen.getByLabelText('조사 주제'),'새 주제');
 const form=screen.getByLabelText('조사 주제').closest('form')!;expect(within(form).getByRole('button')).toBeEnabled();expect(c.createProject).not.toHaveBeenCalled();
 await user.click(within(form).getByRole('button'));await waitFor(()=>expect(c.createProject).toHaveBeenCalledWith(expect.objectContaining({claudeModel:null})));
});
it('잠긴 단계 탭은 바로 옆에 선행 단계 안내를 제공한다',async()=>{
 const p=createMockSnapshot('selection');render(<App client={createMockClient(p)} workspaceClient={workspace()} connectionClient={connections} initialProjectId={p.projectId}/>);
 const nav=await screen.findByRole('navigation',{name:'제작 단계'});expect(within(nav).getByRole('button',{name:/제작·검수/})).toBeDisabled();expect(nav).toHaveTextContent('기획 승인 후 제작 단계에서 열립니다');
});
it('불명 요청은 모델 변경·이동을 막고 이유와 동일 요청 확인을 제시한다',async()=>{
 const p=createMockSnapshot('selection'),c=createMockClient(p);c.mutate=vi.fn(async()=>{throw {status:503,error:{code:'UNKNOWN',message:'응답 유실',details:{requestOutcome:'unknown'},nextActions:[]}};});
 render(<App client={c} workspaceClient={workspace()} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});await userEvent.setup().click(screen.getByRole('button',{name:/주제·조사/}));await userEvent.setup().click(screen.getByRole('button',{name:'자료 조사 시작'}));
 expect(screen.getByRole('button',{name:'프로젝트 목록'})).toBeDisabled();expect(screen.getByLabelText('Claude 모델')).toBeDisabled();expect(screen.getAllByText(/요청 결과가 미확정/)[0]).toBeVisible();expect(screen.getByRole('button',{name:'같은 요청 다시 보내기'})).toBeEnabled();
});
it('이미 기획이 있는 조사 버튼은 정확한 차단 이유를 옆에 표시한다',async()=>{
 const p=createMockSnapshot('storyboard');render(<App client={createMockClient(p)} workspaceClient={workspace()} connectionClient={connections} initialProjectId={p.projectId}/>);await screen.findByRole('heading',{name:p.topic});await userEvent.setup().click(screen.getByRole('button',{name:/주제·조사/}));
 const button=screen.getByRole('button',{name:'자료 조사 시작'});expect(button).toBeDisabled();expect(button.closest('section')).toHaveTextContent('기획이 이미 저장되어 재조사를 시작할 수 없습니다');
});
