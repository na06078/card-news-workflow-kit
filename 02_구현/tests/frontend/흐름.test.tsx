import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {의미검수대역} from './의미검수대역.js';
import {MOCK_IDS,createMockSnapshot} from '../../src/shared/모의자료.js';
import type {WorkspaceClient} from '../../src/shared/작업공간계약.js';
const dashboard={refreshing:false,models:{status:'ready',checkedAt:null,models:[],error:null},providers:[]};
const workspace={listProjects:vi.fn(async()=>({projects:[]})),providerStatus:vi.fn(async()=>dashboard),refreshProviders:vi.fn(async()=>dashboard),setProjectModel:vi.fn(),deleteProject:vi.fn()} as unknown as WorkspaceClient;
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('UNEXPECTED_REAL_FETCH');})));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('모의 화면 흐름 — 실제 조사/생성 아님',()=>{
 it('후보→질문(추천 미선택)→계획 명시 승인→검수 순서를 지키고 새 직접 체크로 파일 준비에 진입한다',async()=>{
  const client=createMockClient('selection'),mutate=vi.spyOn(client,'mutate'),user=userEvent.setup();render(<App workspaceClient={workspace} client={client} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await screen.findByText('[모의] 발표 후보');expect(screen.getByText('모의 데이터 · 실제 조사/생성 아님')).toBeVisible();
  await user.click(screen.getByRole('checkbox',{name:/발표 후보/}));await user.click(screen.getByRole('button',{name:'선택한 후보로 진행'}));
  const answer=await screen.findByRole('button',{name:'답변 저장'});expect(answer).toBeDisabled();
  await user.click(screen.getByRole('radio',{name:/일반 사용자/}));await user.click(answer);
  await screen.findByRole('heading',{name:'스토리보드'});expect(screen.queryByRole('button',{name:'현재 결과 최종 승인'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox',{name:'계획과 크기를 확인했습니다'}));await user.click(screen.getByRole('button',{name:'스토리보드 승인 · 제작 시작'}));
  await screen.findByRole('heading',{name:'카드 검수'});
  await user.click(screen.getByText('카드 1 원고 편집 · 저장된 원고'));expect(screen.getByLabelText('카드 1 제목')).toHaveValue('모의 카드');
  expect(screen.getByRole('region',{name:'검수 요약'})).toHaveTextContent('의미 검수 없음');expect(mutate.mock.calls.filter(([name,input,req])=>name==='approve'&&'stage' in req&&req.stage==='final')).toHaveLength(0);
  await user.click(screen.getByRole('checkbox',{name:'카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.'}));
  await screen.findByRole('heading',{name:'내려받기'});expect(mutate.mock.calls.filter(([name,input,req])=>name==='approve'&&'stage' in req&&req.stage==='final')).toHaveLength(1);expect(screen.queryByRole('button',{name:'현재 결과 최종 승인'})).not.toBeInTheDocument();expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeDisabled();
 });
 it('명시적 supported 보고서를 가진 모의 저장 결과는 직접 검수 후 최종 승인·내려받기로 연결된다',async()=>{
  const p=createMockSnapshot('review');p.result!.semanticReview=의미검수대역(p);const user=userEvent.setup();render(<App workspaceClient={workspace} client={createMockClient(p)} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await screen.findByRole('heading',{name:'카드 검수'});expect(screen.queryByRole('button',{name:'현재 결과 최종 승인'})).not.toBeInTheDocument();await user.click(screen.getByRole('checkbox',{name:'카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.'}));
  await screen.findByRole('heading',{name:'내려받기'});expect(screen.getByText(/모의 모드에서는 실제 파일을/)).toBeVisible();expect(screen.queryByRole('link',{name:/ZIP/})).not.toBeInTheDocument();
 });
 it('제목/본문 수정은 지정 카드의 text 요청으로 분리하며 기존 PNG를 성공으로 위장하지 않는다',async()=>{
  const user=userEvent.setup();const client=createMockClient('review');render(<App workspaceClient={workspace} client={client} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await user.click(await screen.findByText('카드 1 원고 편집 · 저장된 원고'));const title=screen.getByLabelText('카드 1 제목');await user.clear(title);await user.type(title,'바뀐 제목');
  await user.click(screen.getByRole('button',{name:'카드 1 텍스트 수정 요청'}));
  await waitFor(()=>expect(screen.getByLabelText('카드 1 제목')).toHaveValue('바뀐 제목'));
  const p=await client.getProject(MOCK_IDS.project);expect(p.result?.cards[0]?.revision).toBe(2);expect(p.result?.cards[0]?.imageAssetId).toBe(MOCK_IDS.image);expect(p.result?.finalApprovedVersion).toBeNull();
 });
 it('실제 모드의 합성 데이터는 모의 고지와 서버 자산·검증된 파일 조회를 유지한다',async()=>{
  const p=createMockSnapshot('export');const c=createMockClient(p);
  // 실제 모드의 합성 서버 메타데이터만 주입합니다. 모의 adapter가 파일을 생성했다고 속이지 않습니다.
  const getExports=vi.spyOn(c,'getExports').mockResolvedValue({resultVersion:p.result!.version,entries:p.exports,exportRun:null});render(<App workspaceClient={workspace} client={c} initialProjectId={MOCK_IDS.project}/>);
  const download=await screen.findByRole('button',{name:'ZIP 내려받기'});expect(download).toBeEnabled();expect(getExports).toHaveBeenCalledWith(MOCK_IDS.project);
  expect(screen.queryByRole('link',{name:'ZIP 내려받기'})).not.toBeInTheDocument();
  expect(screen.getByText('모의 데이터 · 실제 조사/생성 아님')).toBeVisible();expect(screen.getByRole('img',{name:'카드 1 서버 렌더 PNG'})).toBeInTheDocument();
 });
 it('크기가 없으면 출력 크기 질문을 먼저 표시하고 두 크기를 고를 수 있다',async()=>{
  const p=createMockSnapshot('storyboard');p.storyboard!.size=null;p.question={questionId:MOCK_IDS.question,version:2,runId:null,kind:'output_size',status:'open',createdAt:'2026-10-23T00:00:00Z',items:[{itemId:'size',text:'출력 크기를 선택해 주세요',header:'크기',options:[{optionId:'1080x1080',label:'1080×1080 정사각형',description:'기본 크기'},{optionId:'1080x1350',label:'1080×1350 세로형',description:'선택 크기'}],multiSelect:false,allowFreeText:true,recommendedOptionId:'1080x1080',recommendationReason:'사용자 승인 기본값'}]};p.allowedActions=['answer'];p.status='waiting_for_user';
  const user=userEvent.setup();render(<App workspaceClient={workspace} client={createMockClient(p)} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await screen.findByRole('radio',{name:/1080×1350/});expect(screen.getByRole('radio',{name:/1080×1080/})).toBeChecked();
  expect(screen.queryByRole('button',{name:'스토리보드 승인 · 제작 시작'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio',{name:/1080×1350/}));await user.click(screen.getByRole('button',{name:'답변 저장'}));
  await screen.findByRole('heading',{name:'스토리보드'});expect(screen.getByText(/계획 v2 · 1080×1350/)).toBeVisible();
 });
});
