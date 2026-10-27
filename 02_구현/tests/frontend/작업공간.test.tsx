import '@testing-library/jest-dom/vitest';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,waitFor,act,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createController} from '../../src/frontend/상태.js';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {WorkspaceClient,ProviderDashboard} from '../../src/shared/작업공간계약.js';
const a=createMockSnapshot('selection'),b={...createMockSnapshot('selection'),projectId:'22222222-2222-4222-8222-222222222222',topic:'두 번째 프로젝트'};
a.topic='첫 번째 프로젝트';a.dataMode='real';b.dataMode='real';
const dashboard:ProviderDashboard={refreshing:false,models:{status:'ready',checkedAt:null,error:null,models:[{value:'sdk-exact-value',displayName:'SDK 표시 모델',description:'조회된 모델'}]},providers:[]};
function setup(){const client=createMockClient(a);client.getProject=vi.fn(async id=>structuredClone(id===b.projectId?b:a));const workspace:WorkspaceClient={deleteProject:vi.fn(),listProjects:vi.fn(async()=>({projects:[a,b].map(p=>({projectId:p.projectId,topic:p.topic,stage:p.stage,status:p.status,updatedAt:'2026-10-24T00:00:00Z',cardCount:0,activeRunId:null,claudeModel:null}))})),setProjectModel:vi.fn(async(id,input)=>({projectId:id,model:input.model,version:1,appliesTo:'next_run' as const})),providerStatus:vi.fn(async()=>dashboard),refreshProviders:vi.fn(async()=>dashboard)};return {client,workspace};}
async function openProject(user:ReturnType<typeof userEvent.setup>,topic:string){const back=screen.queryByRole('button',{name:'프로젝트 목록'});if(back)await user.click(back);await user.click(within(await screen.findByRole('row',{name:new RegExp(topic)})).getByRole('button',{name:'열기'}));}
afterEach(()=>{cleanup();vi.useRealTimers();sessionStorage.clear();history.replaceState(null,'','/');});
it('새 프로젝트 주제와 기간도 다른 프로젝트를 다녀온 뒤 보존한다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();render(<App client={client} workspaceClient={workspace}/>);
 await user.click(screen.getByRole('button',{name:'새 프로젝트'}));await user.type(screen.getByLabelText('조사 주제'),'아직 저장하지 않은 주제');await user.selectOptions(screen.getByLabelText('조사 기간'),'30');
 await openProject(user,a.topic);await screen.findByRole('heading',{name:a.topic});
 await user.click(screen.getByRole('button',{name:'프로젝트 목록'}));await user.click(screen.getByRole('button',{name:'새 프로젝트'}));
 expect(screen.getByLabelText('조사 주제')).toHaveValue('아직 저장하지 않은 주제');expect(screen.getByLabelText('조사 기간')).toHaveValue('30');
});
it('전환 후 돌아와도 후보 미제출 선택을 프로젝트별로 보존한다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);
 const choice=await screen.findByRole('checkbox',{name:/발표 후보/});await user.click(choice);await openProject(user,b.topic);await screen.findByRole('heading',{name:b.topic});expect(screen.getByRole('checkbox',{name:/발표 후보/})).not.toBeChecked();await openProject(user,a.topic);await screen.findByRole('heading',{name:a.topic});expect(screen.getByRole('checkbox',{name:/발표 후보/})).toBeChecked();
});
it.each(['question','storyboard','review'] as const)('전환 시 %s의 자유 입력을 버전별로 복원한다',async stage=>{
 const user=userEvent.setup(),{client,workspace}=setup();const first=createMockSnapshot(stage),second={...createMockSnapshot(stage),projectId:b.projectId,topic:b.topic};first.topic=a.topic;
 client.getProject=vi.fn(async id=>structuredClone(id===b.projectId?second:first));render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);await screen.findByRole('heading',{name:a.topic});
 const label=stage==='question'?'독자 자유 답변':stage==='storyboard'?'선택한 카드의 계획 변경 요청':'카드 1 제목';
 if(stage==='question')await user.click(screen.getByRole('radio',{name:'직접 입력'}));
 if(stage==='review')await user.click(screen.getByText('카드 1 원고 편집 · 저장된 원고'));const input=screen.getByLabelText(label);await user.clear(input);await user.type(input,'보존할 초안');
 await openProject(user,b.topic);await screen.findByRole('heading',{name:b.topic});
 await openProject(user,a.topic);await screen.findByRole('heading',{name:a.topic});if(stage==='review')await user.click(screen.getByText('카드 1 원고 편집 · 미제출 변경 있음'));expect(screen.getByLabelText(label)).toBeVisible();expect(screen.getByLabelText(label)).toHaveValue('보존할 초안');
});
it('새 프로젝트 모델을 생성 요청에 전달한다',async()=>{const client=createMockClient();client.createProject=vi.fn(client.createProject);const ctl=createController(client);await ctl.create('새 주제',7,'sdk-exact-value');expect(client.createProject).toHaveBeenCalledWith(expect.objectContaining({claudeModel:'sdk-exact-value'}));});
it('미확정 요청이 있으면 전환·초기화로 요청 ID를 잃지 않는다',async()=>{const {client}=setup();client.mutate=vi.fn(async()=>{throw {status:0,error:{message:'응답 유실',code:'NETWORK_ERROR'}};});const ctl=createController(client);await ctl.open(a.projectId);await ctl.send('selection',{candidateIds:[a.candidates[0]!.candidateId]});await ctl.open(b.projectId);ctl.reset();expect(ctl.getState().snapshot?.projectId).toBe(a.projectId);expect(ctl.getState().pendingRetry).toBe(true);});
it('기존 명시 모델을 SDK 기본값으로 저장하면 선택값도 비운다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();client.getProject=vi.fn(async()=>({...a,claudeModel:'sdk-exact-value'}));render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);await screen.findByRole('heading',{name:a.topic});await user.selectOptions(await screen.findByLabelText('Claude 모델'),'');await waitFor(()=>expect(workspace.setProjectModel).toHaveBeenCalled());expect(screen.getByLabelText('Claude 모델')).toHaveValue('');
});
it('메타데이터 첫 조회 중에는 수동 중복 조회를 막는다',async()=>{const {client,workspace}=setup();workspace.refreshProviders=vi.fn(()=>new Promise<ProviderDashboard>(()=>{}));render(<App client={client} workspaceClient={workspace}/>);expect(screen.getByRole('button',{name:/조회 중|사용량 새로고침/})).toBeDisabled();});
it('조회 진행 중 상태를 polling하고 보이는 탭의 60초 조회와 정리를 지킨다',async()=>{
 vi.useFakeTimers();const {client,workspace}=setup();workspace.refreshProviders=vi.fn(async()=>({...dashboard,refreshing:true}));const mounted=render(<App client={client} workspaceClient={workspace}/>);await act(async()=>{});expect(workspace.refreshProviders).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(workspace.providerStatus).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(59000);});expect(workspace.refreshProviders).toHaveBeenCalledTimes(2);mounted.unmount();await vi.advanceTimersByTimeAsync(120000);expect(workspace.refreshProviders).toHaveBeenCalledTimes(2);
});
it('뒤로·앞으로·URL 재진입은 저장 프로젝트만 읽고 작업을 생성하지 않는다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();vi.spyOn(client,'mutate');const mounted=render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);await screen.findByRole('heading',{name:a.topic});await openProject(user,b.topic);await screen.findByRole('heading',{name:b.topic});act(()=>history.back());await screen.findByRole('heading',{name:'프로젝트 목록'});act(()=>history.back());await screen.findByRole('heading',{name:a.topic});act(()=>history.forward());await screen.findByRole('heading',{name:'프로젝트 목록'});act(()=>history.forward());await screen.findByRole('heading',{name:b.topic});mounted.unmount();render(<App client={client} workspaceClient={workspace}/>);await screen.findByRole('heading',{name:b.topic});expect(client.mutate).not.toHaveBeenCalled();
});
it('A의 늦은 수동 새로고침 실패가 B 오류를 덮지 않는다',async()=>{const {client}=setup();const ctl=createController(client);await ctl.open(a.projectId);let reject!:(e:unknown)=>void;client.getProject=vi.fn(id=>id===a.projectId?new Promise<typeof a>((_,r)=>{reject=r;}):Promise.resolve(b));const refreshing=ctl.refreshSafely();await ctl.open(b.projectId);reject({status:0,error:{code:'NETWORK_ERROR',message:'A 실패'}});await refreshing;expect(ctl.getState().snapshot?.projectId).toBe(b.projectId);expect(ctl.getState().error).toBeNull();});
it('모델 저장 뒤 더 최신 서버 설정을 받으면 그 버전으로 다음 설정을 보낸다',async()=>{const user=userEvent.setup(),{client,workspace}=setup();let snapshot={...a,modelSettingsVersion:0};client.getProject=vi.fn(async()=>snapshot);render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);await screen.findByRole('heading',{name:a.topic});await user.selectOptions(screen.getByLabelText('Claude 모델'),'sdk-exact-value');await waitFor(()=>expect(workspace.setProjectModel).toHaveBeenCalledTimes(1));snapshot={...snapshot,modelSettingsVersion:3};await user.click(screen.getByRole('button',{name:'상태 새로고침'}));await user.selectOptions(screen.getByLabelText('Claude 모델'),'sdk-exact-value');await waitFor(()=>expect(workspace.setProjectModel).toHaveBeenLastCalledWith(a.projectId,expect.objectContaining({version:3})));});
it('조회된 모델 value를 프로젝트별로 저장하고 사용량 숫자와 미확인을 구분한다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();const d=structuredClone(dashboard);d.providers=[{provider:'claude',label:'Claude',status:'ready',checkedAt:'2026-10-24T00:00:00Z',message:null,metrics:[{id:'week',label:'주간',remainingPercent:42,resetsAt:null,scope:'account',source:'SDK'}]},{provider:'agy',label:'Antigravity',status:'unknown',checkedAt:null,message:null,metrics:[]}];workspace.refreshProviders=vi.fn(async()=>d);workspace.providerStatus=vi.fn(async()=>d);
 render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);await screen.findByRole('heading',{name:a.topic});
 await user.selectOptions(await screen.findByLabelText('Claude 모델'),'sdk-exact-value');await waitFor(()=>expect(workspace.setProjectModel).toHaveBeenCalledWith(a.projectId,expect.objectContaining({model:'sdk-exact-value',version:0})));
 expect((await screen.findAllByText('42%'))[0]).toBeVisible();await user.click(screen.getByText('사용량 상세'));expect(screen.getByText('이미지 전용 한도 미제공')).toBeVisible();expect(workspace.refreshProviders).toHaveBeenCalledTimes(1);
});
it('전체 프로젝트를 검색하고 선택하며 뒤로가기·새 프로젝트를 지원한다',async()=>{
 const user=userEvent.setup(),{client,workspace}=setup();render(<App client={client} workspaceClient={workspace} initialProjectId={a.projectId}/>);
 await screen.findByRole('heading',{name:a.topic});
 await openProject(user,b.topic);
 await screen.findByRole('heading',{name:b.topic});expect(location.search).toContain(b.projectId);
 await user.click(screen.getByRole('button',{name:'프로젝트 목록'}));await user.type(screen.getByRole('searchbox',{name:'프로젝트 검색'}),'두 번째');expect(screen.queryByRole('row',{name:new RegExp(a.topic)})).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'새 프로젝트'}));await screen.findByRole('heading',{name:'작은 소식을, 선명한 이야기로.'});
 expect(screen.queryByText('로컬 작업 공간 · 실제 HTTP')).not.toBeInTheDocument();
});
