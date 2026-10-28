import '@testing-library/jest-dom/vitest';
import {test,expect,afterEach,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ProjectSnapshot,RevisionOutcome} from '../../src/shared/포트.js';
import {검수} from '../../src/frontend/화면/검수.js';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
afterEach(cleanup);
function fixture(outcome:RevisionOutcome):ProjectSnapshot{
 const p=createMockSnapshot('review');p.activeRun=null;p.allowedActions=['revise','approve_final'];p.lastRun={runId:crypto.randomUUID(),projectId:p.projectId,kind:'revision',status:'succeeded',attempt:1,phase:'revision',createdAt:'2026-10-28T04:00:00Z',updatedAt:'2026-10-28T04:01:00Z',lastEventSeq:0,questionId:null,error:null,externalOutcome:'known',retryAllowed:false,revisionProtocol:2,revisionOutcome:outcome,revisionRequest:{scope:'layout',cardIds:[p.result!.cards[0].cardId],instruction:'속도 수치를 표기해야 하는 것 아닌가?'}};return p;
}
test.each([
 [{kind:'revision',status:'needs_scope',requestedScope:'text',reason:'원고 수정이 필요합니다.'},'수정 범위 확인 필요'],
 [{kind:'revision',status:'no_change',reason:'이미 같은 배치입니다.'},'변경 없음'],
 [{kind:'revision',status:'unsupported',reason:'지원하지 않는 배치입니다.'},'현재 범위로 처리 불가'],
 [{kind:'revision',status:'clarification',question:'어떤 문장을 바꿀까요?'},'추가 확인 필요']
] as [RevisionOutcome,string][])('정상 결과 %j는 통신 오류나 수정 성공으로 표시하지 않는다',(outcome,title)=>{
 const p=fixture(outcome),send=vi.fn();render(<진행상태 p={p} busy={false} send={send} events={[]}/>);
 expect(screen.getByRole('heading',{name:title})).toBeVisible();expect(screen.getByText('원고·그림·승인은 변경하지 않았습니다.')).toBeVisible();expect(screen.queryByText('PROVIDER_PROTOCOL_ERROR')).not.toBeInTheDocument();expect(send).not.toHaveBeenCalled();
});
test('제안한 문구 수정 범위는 원래 지시를 보존해 열기만 하고 별도 제출 때 요청한다',()=>{
 const p=fixture({kind:'revision',status:'needs_scope',requestedScope:'text',reason:'본문 수정이 필요합니다.'}),before=structuredClone(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);
 fireEvent.click(screen.getByRole('button',{name:'문구 수정으로 확인'}));expect(send).not.toHaveBeenCalled();
 expect(screen.getByLabelText('수정 범위')).toHaveValue('text');expect(screen.getByLabelText('카드 1 수정 지시')).toHaveValue(p.lastRun!.revisionRequest!.instruction);
 fireEvent.click(screen.getByRole('button',{name:'카드 1 부분 수정 요청'}));expect(send).toHaveBeenCalledExactlyOnceWith('revisions',{scope:'text',cardIds:[p.result!.cards[0].cardId],instruction:p.lastRun!.revisionRequest!.instruction});expect(p).toEqual(before);
});
test('이미 제출된 동일 지시는 미제출 초안으로 오인하지 않고 범위 변경 뒤에만 초안으로 표시한다',()=>{
 const p=fixture({kind:'revision',status:'no_change',reason:'배치가 같습니다.'});render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);
 expect(screen.queryByRole('button',{name:'카드 1 초안 버리기'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'문구 수정 열기'}));expect(screen.getByRole('button',{name:'카드 1 초안 버리기'})).toBeVisible();
});
test('legacy pending은 서버가 허용한 경우에만 저장 원고 재합성 복구를 명시 요청한다',()=>{
 const p=fixture({kind:'revision',status:'unsupported',reason:'기존 오류'});p.status='error';p.stage='production';p.result!.cards[0].state='pending';p.lastRun!.status='failed';delete p.lastRun!.revisionProtocol;delete p.lastRun!.revisionOutcome;p.lastRun!.error={code:'PROVIDER_PROTOCOL_ERROR',message:'이전 오류',retryable:false,nextActions:[],projectId:p.projectId,runId:p.lastRun!.runId,currentVersion:p.projectVersion,details:{}};
 const send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByRole('button',{name:'카드 1 저장 원고로 표시 복구'}));expect(send).toHaveBeenCalledExactlyOnceWith('revisions',{scope:'layout',cardIds:[p.result!.cards[0].cardId],instruction:p.lastRun!.revisionRequest!.instruction,renderOnly:true});
});
