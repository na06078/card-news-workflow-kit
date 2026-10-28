import '@testing-library/jest-dom/vitest';
import {afterEach,test,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,within} from '@testing-library/react';
import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
afterEach(cleanup);
function saved():ProjectSnapshot{
 const p=createMockSnapshot('storyboard');p.claims=[{text:'검토할 주장',sourceIds:[],kind:'uncertain',availability:'unknown',conditions:[]}];
 p.allowedActions.push('resume_fact_review');
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:null,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:p.storyboard!.cards.map(c=>c.cardId),reviewer:{provider:'agy',model:'gemini-3.8-flash-high'},state:'pending',readyVersion:null,proposal:null};
 p.factRecovery={checkpointId:crypto.randomUUID(),sourceRunId:p.factReview.runId,step:'semantic',available:true,reason:null,issues:[],savedAt:'2026-10-28T02:00:00.000Z',reuseRepairObservation:true};return p;
}
test('기존 보완 응답 재사용은 새 보완 호출 없이 내용 검수만 진행한다고 표시하고 현재 범위로 한 번 요청한다',()=>{
 const p=saved(),before=structuredClone(p),send=vi.fn();render(<사실검수 p={p} busy={false} send={send}/>);
 const region=within(screen.getByRole('region',{name:'저장된 재검증 부분 복구'}));
 expect(region.getByText(/저장된 연결 보완 응답을 다시 검사해 재사용/)).toBeVisible();
 expect(region.getByText(/새 연결 보완 모델은 호출하지 않고.*내용 의미 검수만/)).toBeVisible();
 const button=region.getByRole('button',{name:'저장 응답으로 내용 검수 계속'});expect(button).toBeEnabled();expect(send).not.toHaveBeenCalled();fireEvent.click(button);
 expect(send).toHaveBeenCalledExactlyOnceWith('factReview',{claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});expect(p).toEqual(before);
});
test('차단된 저장 응답은 정확한 원인을 표시하고 클릭·재렌더로 추가 요청하지 않는다',()=>{
 const p=saved();p.factRecovery!.available=false;p.factRecovery!.reason='카드 6과 주장 1의 동일 연결이 중복되어 저장 응답을 재사용할 수 없습니다. 추가 연결 보완을 호출하지 않습니다.';
 const send=vi.fn(),view=render(<사실검수 p={p} busy={false} send={send}/>);const button=screen.getByRole('button',{name:'저장 응답으로 내용 검수 계속'});expect(button).toBeDisabled();expect(screen.getByText(p.factRecovery!.reason)).toBeVisible();fireEvent.click(button);view.rerender(<사실검수 p={{...p}} busy={false} send={send}/>);expect(send).not.toHaveBeenCalled();
});
test('미제출 초안은 저장 응답 재사용도 막고 자동 삭제하지 않는다',()=>{
 const p=saved(),send=vi.fn();render(<사실검수 p={p} busy={false} send={send} dirty/>);expect(screen.getByRole('button',{name:'저장 응답으로 내용 검수 계속'})).toBeDisabled();expect(screen.getByText('미제출 초안을 저장하거나 버린 뒤 계속하세요.')).toBeVisible();expect(send).not.toHaveBeenCalled();
});
