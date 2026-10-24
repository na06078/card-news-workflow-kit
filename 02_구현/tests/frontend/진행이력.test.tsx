// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,within,act} from '@testing-library/react';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {EngineEvent} from '../../src/shared/포트.js';
afterEach(cleanup);
it('이미지 요청 제한을 계정 구독 한도 소진으로 안내하지 않는다',()=>{
 const p=createMockSnapshot('question');p.lastRun={...p.activeRun!,status:'failed',error:{code:'AGY_RATE_LIMIT',message:'이미지 도구의 요청 제한입니다. 계정 전체 소진 여부는 미확인입니다.',retryable:false,nextActions:['wait_quota'],projectId:p.projectId,runId:p.activeRun!.runId,currentVersion:null,details:{}}};p.activeRun=null;
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={[]}/>);
 expect(screen.queryByText(/구독 한도 재설정까지 기다려/)).not.toBeInTheDocument();
 expect(screen.getByText(/이미지 도구의 요청 제한/)).toBeVisible();
});
it('실패 뒤 접수는 현재 작업에서 제거하고 종료 오류까지 시간순 이력에 남긴다',()=>{
 const p=createMockSnapshot('question');p.lastRun={...p.activeRun!,status:'failed'};p.activeRun=null;
 const common={projectId:p.projectId,runId:p.lastRun.runId,attempt:1,at:p.lastRun.createdAt};
 const events:EngineEvent[]=[{...common,seq:1,type:'progress',phase:'production',message:'요청 접수',completed:0,total:7},{...common,seq:2,type:'error',error:{code:'IMAGE_FAILED',message:'이미지 실패',retryable:false,nextActions:[],projectId:p.projectId,runId:p.lastRun.runId,currentVersion:null,details:{}}}];
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={events} lastSyncedAt="2026-10-23T01:00:00Z"/>);
 const history=screen.getByRole('list',{name:'시간순 작업 이력'});expect(within(history).getAllByRole('listitem')).toHaveLength(2);
 expect(screen.getByText('최근 실제 활동')).toBeVisible();expect(screen.getByText('최근 서버 조회')).toBeVisible();
 expect(screen.queryByRole('status',{name:'현재 작업'})).not.toHaveTextContent('요청 접수');
 expect(within(history).getByText(/IMAGE_FAILED/)).toBeVisible();
});
it('렌더 완료 이벤트만으로 저장 완료를 표시하지 않고 카드 번호로 활동을 보여준다',()=>{
 const p=createMockSnapshot('storyboard');p.activeRun={...createMockSnapshot('question').activeRun!,kind:'production',phase:'production',status:'running'};p.result=null;
 const e:EngineEvent={projectId:p.projectId,runId:p.activeRun.runId,attempt:1,at:p.activeRun.createdAt,seq:1,type:'progress',phase:'production',message:'PNG 렌더 완료',completed:1,total:1,activity:{provider:'app',operation:'render',status:'completed',cardId:p.storyboard!.cards[0]!.cardId}};
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={[e]}/>);
 expect(screen.getByText(/카드 완료 0\/1 · 대기 0 · 진행 1 · 오류 0/)).toBeVisible();expect(screen.getByText('시도 1 · 제작')).toBeVisible();
 expect(screen.getByRole('status',{name:'현재 작업'})).toHaveTextContent('카드 1');
 expect(screen.getByRole('status',{name:'현재 작업'})).not.toHaveTextContent(p.storyboard!.cards[0]!.cardId);
});
it('실행 중 경과시간만 흐르고 새 이벤트 없는 실제 활동 시각은 변하지 않는다',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T00:00:10Z'));
 try{const p=createMockSnapshot('question');p.activeRun!.createdAt='2026-10-23T00:00:00Z';
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={[]}/>);expect(screen.getByText('0분 10초')).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(screen.getByText('0분 12초')).toBeVisible();expect(screen.getAllByText('아직 없음')).toHaveLength(2);
 }finally{cleanup();vi.useRealTimers();}
});
