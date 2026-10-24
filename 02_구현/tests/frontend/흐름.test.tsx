import '@testing-library/jest-dom/vitest';
import {afterEach,describe,it,expect} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../../src/frontend/App.js';
import {createMockClient} from '../../src/frontend/모의클라이언트.js';
import {MOCK_IDS,createMockSnapshot} from '../../src/shared/모의자료.js';
afterEach(cleanup);
describe('모의 화면 흐름 — 실제 조사/생성 아님',()=>{
 it('후보→질문(추천 미선택)→계획 명시 승인→검수→최종 승인 순서를 지킨다',async()=>{
  const user=userEvent.setup();render(<App client={createMockClient('selection')} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await screen.findByText('[모의] 발표 후보');expect(screen.getByText('모의 데이터 · 실제 조사/생성 아님')).toBeVisible();
  await user.click(screen.getByRole('checkbox',{name:/발표 후보/}));await user.click(screen.getByRole('button',{name:'선택한 후보로 진행'}));
  const answer=await screen.findByRole('button',{name:'답변 저장'});expect(answer).toBeDisabled();
  await user.click(screen.getByRole('radio',{name:/일반 사용자/}));await user.click(answer);
  await screen.findByRole('heading',{name:'스토리보드'});expect(screen.queryByRole('button',{name:'현재 결과 최종 승인'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox',{name:'계획과 크기를 확인했습니다'}));await user.click(screen.getByRole('button',{name:'스토리보드 승인 · 제작 시작'}));
  await screen.findByRole('heading',{name:'카드 검수'});
  expect(screen.getByLabelText('카드 1 제목')).toHaveValue('모의 카드');
  await user.click(screen.getByRole('checkbox',{name:'사실·출처와 시각적 가독성을 직접 확인했습니다'}));
  await user.click(screen.getByRole('button',{name:'현재 결과 최종 승인'}));
  await screen.findByRole('heading',{name:'내려받기'});expect(screen.getByText(/모의 모드에서는 실제 파일을/)).toBeVisible();expect(screen.queryByRole('link',{name:/ZIP/})).not.toBeInTheDocument();
 });
 it('제목/본문 수정은 지정 카드의 text 요청으로 분리하며 기존 PNG를 성공으로 위장하지 않는다',async()=>{
  const user=userEvent.setup();const client=createMockClient('review');render(<App client={client} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  const title=await screen.findByLabelText('카드 1 제목');await user.clear(title);await user.type(title,'바뀐 제목');
  await user.click(screen.getByRole('button',{name:'카드 1 텍스트 수정 요청'}));
  await waitFor(()=>expect(screen.getByLabelText('카드 1 제목')).toHaveValue('바뀐 제목'));
  const p=await client.getProject(MOCK_IDS.project);expect(p.result?.cards[0]?.revision).toBe(2);expect(p.result?.cards[0]?.imageAssetId).toBe(MOCK_IDS.image);expect(p.result?.finalApprovedVersion).toBeNull();
 });
 it('실제 HTTP 경로의 합성 데이터는 모의 고지를 유지하되 서버 자산·다운로드 경로를 숨기지 않는다',async()=>{
  const p=createMockSnapshot('export');const c=createMockClient(p);
  render(<App client={c} initialProjectId={MOCK_IDS.project}/>);
  const download=await screen.findByRole('link',{name:'ZIP 내려받기'});expect(download).toHaveAttribute('href',`/api/projects/${MOCK_IDS.project}/exports/${MOCK_IDS.export}/download`);
  expect(screen.getByText('모의 데이터 · 실제 조사/생성 아님')).toBeVisible();expect(screen.getByRole('img',{name:'카드 1 서버 렌더 PNG'})).toBeInTheDocument();
 });
 it('크기가 없으면 출력 크기 질문을 먼저 표시하고 두 크기를 고를 수 있다',async()=>{
  const p=createMockSnapshot('storyboard');p.storyboard!.size=null;p.question={questionId:MOCK_IDS.question,version:2,runId:null,kind:'output_size',status:'open',createdAt:'2026-10-23T00:00:00Z',items:[{itemId:'size',text:'출력 크기를 선택해 주세요',header:'크기',options:[{optionId:'1080x1080',label:'1080×1080 정사각형',description:'기본 크기'},{optionId:'1080x1350',label:'1080×1350 세로형',description:'선택 크기'}],multiSelect:false,allowFreeText:true,recommendedOptionId:'1080x1080',recommendationReason:'사용자 승인 기본값'}]};p.allowedActions=['answer'];p.status='waiting_for_user';
  const user=userEvent.setup();render(<App client={createMockClient(p)} initialProjectId={MOCK_IDS.project} dataMode="mock"/>);
  await screen.findByRole('radio',{name:/1080×1350/});expect(screen.getByRole('radio',{name:/1080×1080/})).toBeChecked();
  expect(screen.queryByRole('button',{name:'스토리보드 승인 · 제작 시작'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio',{name:/1080×1350/}));await user.click(screen.getByRole('button',{name:'답변 저장'}));
  await screen.findByRole('heading',{name:'스토리보드'});expect(screen.getByText(/계획 v2 · 1080×1350/)).toBeVisible();
 });
});
