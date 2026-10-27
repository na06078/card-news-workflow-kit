import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {검수} from '../../src/frontend/화면/검수.js';
import {스토리보드} from '../../src/frontend/화면/스토리보드.js';
import {DraftContext} from '../../src/frontend/초안.js';
import {의미검수대역} from './의미검수대역.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
afterEach(cleanup);
it('같은 PNG가 깨지면 캐시 무효화 재요청을 실제로 만든다',()=>{const p=createMockSnapshot('review');p.result!.cards[0]!.previewAssetId=crypto.randomUUID();render(<검수 p={p} busy={false} send={vi.fn()} developmentMock={false}/>);const img=screen.getByAltText('카드 1 서버 렌더 PNG'),src=img.getAttribute('src');fireEvent.error(img);fireEvent.click(screen.getByRole('button',{name:'카드 1 PNG 다시 불러오기'}));expect(screen.getByAltText('카드 1 서버 렌더 PNG').getAttribute('src')).not.toBe(src);});
it('미제출 원고를 승인 옆에서 차단하고 버리면 개별 승인 없이 새 체크로 승인한다',()=>{const p=createMockSnapshot('review');p.result!.semanticReview=의미검수대역(p);p.allowedActions=['revise','approve_final'];const send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByText('카드 1 원고 편집 · 저장된 원고'));fireEvent.change(screen.getByLabelText('카드 1 본문'),{target:{value:'미제출 변경'}});const checkbox=screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.');expect(checkbox).toBeDisabled();expect(screen.getByText(/미제출 카드 초안/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'카드 1 초안 버리기'}));expect(checkbox).toBeEnabled();fireEvent.click(checkbox);expect(send).toHaveBeenCalledExactlyOnceWith('approve',{stage:'final',acknowledgeWarnings:true});});
it('JSON 이스케이프와 키까지 포함한 실제 전송 instruction 길이를 알려준다',()=>{const p=createMockSnapshot('review');p.allowedActions=['revise'];render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);fireEvent.click(screen.getByText('카드 1 원고 편집 · 저장된 원고'));const body='"'.repeat(2000);fireEvent.change(screen.getByLabelText('카드 1 본문'),{target:{value:body}});const n=[...JSON.stringify({title:p.result!.cards[0]!.title,body})].length;expect(screen.getByText(`전송 원고 ${n}/4000자 (JSON 키·이스케이프 포함)`)).toBeVisible();expect(screen.getByRole('button',{name:'카드 1 텍스트 수정 요청'})).toBeDisabled();});
it('제작 실패에는 허용된 실패 카드 text/layout만 제공하고 재시도 범위를 정직하게 표시한다',()=>{const p=createMockSnapshot('review');p.stage='production';p.status='error';p.allowedActions=['revise','retry'];const c=p.result!.cards[0]!;c.state='failed';c.error={code:'RENDER_FAILED',message:'렌더 실패',retryable:true,nextActions:['revise'],projectId:p.projectId,runId:null,currentVersion:1,details:{}};p.lastRun={runId:crypto.randomUUID(),projectId:p.projectId,kind:'production',status:'failed',attempt:1,phase:'render',createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',lastEventSeq:0,questionId:null,error:c.error,externalOutcome:'known',retryAllowed:true};render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);fireEvent.click(screen.getByText('이 카드 그림·배치 수정'));expect(screen.queryByRole('option',{name:'그림만 다시 생성'})).not.toBeInTheDocument();expect(screen.getByRole('option',{name:/배치만 수정/})).toBeVisible();expect(screen.getByRole('button',{name:/실패 작업 전체 범위 재시도/})).toBeVisible();});
it('계획 초안은 제작 승인을 막으며 크기 변경을 잘못 안내하지 않는다',()=>{const p=createMockSnapshot('storyboard');p.allowedActions=['revise','approve_storyboard'];render(<스토리보드 p={p} busy={false} send={vi.fn()}/>);expect(screen.queryByText(/크기 변경이 필요하면 계획 수정/)).not.toBeInTheDocument();fireEvent.click(screen.getByLabelText('계획과 크기를 확인했습니다'));fireEvent.change(screen.getByLabelText('선택한 카드의 계획 변경 요청'),{target:{value:'계획 초안'}});expect(screen.getByRole('button',{name:'스토리보드 승인 · 제작 시작'})).toBeDisabled();expect(screen.getByText(/미제출 계획 초안/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'계획 초안 버리기'}));expect(screen.getByRole('button',{name:'스토리보드 승인 · 제작 시작'})).toBeEnabled();});

it('복원된 계획 초안을 명시적으로 제외하기 전에는 현재 저장 결과도 승인하지 않는다',()=>{
 const p=createMockSnapshot('review');p.result!.semanticReview=의미검수대역(p);p.allowedActions=['revise','approve_final'];const drafts=new Map<string,unknown>([[`${p.projectId}:plan:${p.storyboard!.version}:instruction`,'저장되지 않은 계획']]);
 render(<DraftContext.Provider value={drafts}><검수 p={p} busy={false} send={vi.fn()} developmentMock/></DraftContext.Provider>);
 expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeDisabled();
 fireEvent.click(screen.getByLabelText(/계획 초안 대신 현재 서버에 저장된 결과/));expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeEnabled();
});
it('새 결과 버전에는 이전 직접 검수 확인을 재사용하지 않는다',()=>{
 const p=createMockSnapshot('review');p.result!.semanticReview=의미검수대역(p);p.allowedActions=['approve_final'];const view=render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);
 fireEvent.click(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.'));expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeChecked();
 const next=structuredClone(p);next.result!.version++;view.rerender(<검수 p={next} busy={false} send={vi.fn()} developmentMock/>);expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).not.toBeChecked();
});

