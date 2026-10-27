import '@testing-library/jest-dom/vitest';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
afterEach(cleanup);
it('작업 오류의 허용된 입력·원인·대기시간을 행동 가능한 문구로 표시한다',()=>{
 const p=createMockSnapshot('selection');p.activeRun=null;p.lastRun={runId:'run',projectId:p.projectId,kind:'research',status:'failed',attempt:1,phase:'research',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',lastEventSeq:0,questionId:null,externalOutcome:'not_started',retryAllowed:false,error:{code:'RENDER_FAILED',message:'처리 실패',retryable:false,nextActions:[],projectId:p.projectId,runId:null,currentVersion:null,details:{field:'claudeModel',reason:'FONT_UNAVAILABLE',retryAfterSeconds:30}}};
 render(<진행상태 p={p} busy={false} send={vi.fn()} events={[]}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('대상: Claude 모델');expect(screen.getByRole('alert')).toHaveTextContent('한글 글꼴');expect(screen.getByRole('alert')).toHaveTextContent('30초');
});
it('원시 경로·미지 reason·잘못된 대기값은 펼치지 않는다',()=>{
 const p=createMockSnapshot('selection');p.activeRun=null;p.lastRun={runId:'run',projectId:p.projectId,kind:'research',status:'failed',attempt:1,phase:'research',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',lastEventSeq:0,questionId:null,externalOutcome:'not_started',retryAllowed:false,error:{code:'ERROR',message:'처리 실패',retryable:false,nextActions:[],projectId:p.projectId,runId:null,currentVersion:null,details:{field:'C:/secret/key',reason:'token=secret',retryAfterSeconds:-30}}};
 const {container}=render(<진행상태 p={p} busy={false} send={vi.fn()} events={[]}/>);expect(container).not.toHaveTextContent('secret');expect(container).not.toHaveTextContent('-30');
});
