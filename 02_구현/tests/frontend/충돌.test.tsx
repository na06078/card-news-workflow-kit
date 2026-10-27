import '@testing-library/jest-dom/vitest';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {createMockSnapshot,MOCK_IDS} from '../../src/shared/모의자료.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
afterEach(()=>{cleanup();history.replaceState(null,'','/');});
const fault=(code:string,status=409)=>({status,error:{code,message:'실행 경계 테스트 오류',retryable:false,nextActions:['check_login'],projectId:MOCK_IDS.project,runId:MOCK_IDS.run,currentVersion:3,details:{}}});
function interrupted():ProjectSnapshot{const p=createMockSnapshot('review');p.lastRun={...p.lastRun!,status:'interrupted',kind:'production',externalOutcome:'unknown',retryAllowed:true,error:fault('EXTERNAL_OUTCOME_UNKNOWN').error as NonNullable<ProjectSnapshot['lastRun']>['error']};p.status='interrupted';p.allowedActions=['retry'];return p;}
describe('복원·충돌·오류 화면',()=>{
 it('답변 충돌은 현재 질문으로 재조회하며 자동 재답변하지 않는다',async()=>{
  const user=userEvent.setup(),client=createMockClient('question');const mutate=vi.spyOn(client,'mutate').mockRejectedValueOnce(fault('QUESTION_STALE'));
  const get=vi.spyOn(client,'getProject');render(<App client={client} initialProjectId={MOCK_IDS.project}/>);
  await user.click(await screen.findByRole('radio',{name:/일반 사용자/}));await user.click(screen.getByRole('button',{name:'답변 저장'}));
  await screen.findByText('QUESTION_STALE');expect(get).toHaveBeenCalledTimes(2);expect(mutate).toHaveBeenCalledTimes(1);expect(screen.getByText(/이전 입력을 자동으로 덮어쓰지/)).toBeVisible();
 });
 it('waiting은 오류가 아니며 취소 접수와 정리 완료를 구분한다',async()=>{
  const client=createMockClient('question');const workspaceClient={deleteProject:vi.fn(),listProjects:vi.fn(async()=>({projects:[]})),providerStatus:vi.fn(),refreshProviders:vi.fn(async()=>({refreshing:false,models:{status:'unknown' as const,checkedAt:null,models:[],error:null},providers:[]})),setProjectModel:vi.fn()};render(<App client={client} workspaceClient={workspaceClient} initialProjectId={MOCK_IDS.project}/>);
  await screen.findByRole('heading',{name:'사용자 답변 대기'});expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  cleanup();const p=createMockSnapshot('question');p.activeRun!.status='cancel_requested';p.question=null;p.allowedActions=['cancel'];
  render(<App client={createMockClient(p)} workspaceClient={workspaceClient} initialProjectId={MOCK_IDS.project}/>);
  await screen.findByRole('heading',{name:'취소 요청됨 · 정리 확인 중'});expect(screen.getByRole('button',{name:'작업 취소 요청'})).toBeDisabled();
 });
 it('외부 결과 불명의 중단은 중복 위험 확인 전 재시도를 막는다',async()=>{
  const user=userEvent.setup();render(<App client={createMockClient(interrupted())} initialProjectId={MOCK_IDS.project}/>);
  const retry=await screen.findByRole('button',{name:'실패·중단 작업 재시도'});expect(retry).toBeDisabled();
  await user.click(screen.getByRole('checkbox',{name:/외부 실행 결과가 불명확/}));expect(retry).toBeEnabled();
 });
 it.each(['LOGIN_REQUIRED','SEARCH_TOOL_UNAVAILABLE','SUBSCRIPTION_QUOTA'])('%s를 모의 성공으로 바꾸지 않는다',async code=>{
  const c=createMockClient();vi.spyOn(c,'bootstrap').mockRejectedValue(fault(code));
  render(<App client={c} initialProjectId={MOCK_IDS.project}/>);await screen.findByText(code);
  expect(screen.queryByRole('heading',{name:'내려받기'})).not.toBeInTheDocument();expect(screen.queryByText('[모의] 발표 후보')).not.toBeInTheDocument();
 });
 it('완료 후 같은 프로젝트로 다시 마운트하면 저장된 선택을 복원한다',async()=>{
  const p=createMockSnapshot('selection');p.selectedCandidateIds=[MOCK_IDS.candidate];const c=createMockClient(p);
  render(<App client={c} initialProjectId={MOCK_IDS.project}/>);expect(await screen.findByRole('checkbox',{name:/발표 후보/})).toBeChecked();
  cleanup();render(<App client={c} initialProjectId={MOCK_IDS.project}/>);expect(await screen.findByRole('checkbox',{name:/발표 후보/})).toBeChecked();
 });
 it('0개 후보는 성공 조사라도 선택 진행을 막는다',async()=>{
  const p=createMockSnapshot('selection');p.candidates=[];p.sources=[];render(<App client={createMockClient(p)} initialProjectId={MOCK_IDS.project}/>);
  expect(await screen.findByRole('button',{name:'선택한 후보로 진행'})).toBeDisabled();expect(screen.getByText(/후보가 없습니다/)).toBeVisible();
 });
 it('실패 카드에서도 카드 하나로 오인하지 않게 작업 전체 범위 재시도를 제공한다',async()=>{
  const p=interrupted();p.lastRun!.externalOutcome='known';p.lastRun!.status='failed';p.result!.cards[0]!.state='failed';p.result!.cards[0]!.error=fault('IMAGE_GENERATION_FAILED').error as NonNullable<ProjectSnapshot['lastRun']>['error'];
  const client=createMockClient(p),mutate=vi.spyOn(client,'mutate');render(<App client={client} initialProjectId={MOCK_IDS.project}/>);
  const retry=await screen.findByRole('button',{name:'실패 작업 전체 범위 재시도 (카드 1만 아님)'});expect(retry).toBeEnabled();
  await userEvent.setup().click(retry);
  expect(mutate).toHaveBeenCalledWith('retry',expect.objectContaining({projectId:MOCK_IDS.project,runId:MOCK_IDS.run}),expect.objectContaining({version:p.projectVersion}));
 });
 it('출력 크기 답변 완료 질문이 남아 있어도 후보 선택을 막지 않는다',async()=>{
  const p=createMockSnapshot('question');p.question!.status='answered';p.activeRun=null;p.lastRun=null;p.stage='selection';p.allowedActions=['select'];
  const user=userEvent.setup();render(<App client={createMockClient(p)} initialProjectId={MOCK_IDS.project}/>);
  await screen.findByRole('checkbox',{name:/발표 후보/});expect(screen.getByRole('button',{name:'선택한 후보로 진행'})).toBeEnabled();
 });
});
