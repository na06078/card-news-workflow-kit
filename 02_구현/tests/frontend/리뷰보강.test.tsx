import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {스토리보드} from '../../src/frontend/화면/스토리보드.js';
import {검수} from '../../src/frontend/화면/검수.js';
import {DraftContext} from '../../src/frontend/초안.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {의미검수대역} from './의미검수대역.js';
import {createController} from '../../src/frontend/상태.js';
import type {FrontendClient,ProjectSnapshot} from '../../src/shared/포트.js';
afterEach(cleanup);
const approval='스토리보드 승인 · 제작 시작';
const apply='사실 수정안 전체 적용';
function ready(stage:'storyboard'|'review'){
 const p=createMockSnapshot(stage),c=(p.result?.cards??p.storyboard!.cards)[0]!;
 p.allowedActions.push('apply_fact_proposal');
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion-1,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result?.version??null,contentHash:'a'.repeat(64),claimIndices:[],cardIds:[c.cardId],state:'ready',proposal:{semanticReview:의미검수대역(p),sources:[],observations:[],beforeClaims:[],beforeCards:[c],findings:[],cards:[{...c,body:'적용 후보 본문'}]}};
 return p;
}
function blockedApply(send:ReturnType<typeof vi.fn>){
 const button=screen.getByRole('button',{name:apply});expect(button).toBeDisabled();
 expect(button.previousElementSibling).toBeVisible();expect(button.previousElementSibling).toHaveTextContent('미제출 카드 또는 계획 초안');
 expect(button.previousElementSibling).toHaveTextContent('수정 요청을 제출');expect(button.previousElementSibling).toHaveTextContent('초안 버리기');
 fireEvent.click(button);expect(send).not.toHaveBeenCalled();
}
it('실제 계획 화면의 입력·카드 선택은 제안 적용을 막으며 폴링에도 초안을 자동삭제하지 않는다',()=>{
 const p=ready('storyboard'),send=vi.fn(),drafts=new Map<string,unknown>(),original=JSON.stringify(p);
 const ui=(q:ProjectSnapshot)=><DraftContext.Provider value={drafts}><스토리보드 key={`${q.projectId}:${q.storyboard!.version}:${q.storyboard!.approvedVersion}`} p={q} busy={false} send={send}/></DraftContext.Provider>;
 const v=render(ui(p));expect(screen.getByRole('button',{name:apply})).toBeEnabled();
 fireEvent.change(screen.getByLabelText('선택한 카드의 계획 변경 요청'),{target:{value:'유지할 계획 초안'}});blockedApply(send);
 v.rerender(ui({...p}));expect(screen.getByLabelText('선택한 카드의 계획 변경 요청')).toHaveValue('유지할 계획 초안');blockedApply(send);
 fireEvent.click(screen.getByRole('button',{name:'계획 초안 버리기'}));expect(screen.getByRole('button',{name:apply})).toBeEnabled();
 fireEvent.click(screen.getByLabelText('이 카드 계획 수정'));blockedApply(send);expect(screen.getByLabelText('이 카드 계획 수정')).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'계획 초안 버리기'}));fireEvent.click(screen.getByRole('button',{name:apply}));
 expect(send).toHaveBeenCalledExactlyOnceWith('factApply',{reviewRunId:p.factReview!.runId});expect(JSON.stringify(p)).toBe(original);
});
it.each(['본문','수정 지시'])('실제 검수 화면 카드 %s 초안은 적용을 막고 명시 버리기 후에만 해제한다',field=>{
 const p=ready('review'),send=vi.fn(),drafts=new Map<string,unknown>(),original=JSON.stringify(p);
 const ui=(q:ProjectSnapshot)=><DraftContext.Provider value={drafts}><검수 key={`${q.projectId}:${q.result!.version}`} p={q} busy={false} send={send} developmentMock/></DraftContext.Provider>;
 const v=render(ui(p));fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));expect(screen.getByRole('button',{name:apply})).toBeEnabled();
 fireEvent.change(screen.getByLabelText(`카드 1 ${field}`),{target:{value:'자동삭제 금지'}});blockedApply(send);
 v.rerender(ui({...p}));expect(screen.getByLabelText(`카드 1 ${field}`)).toHaveValue('자동삭제 금지');blockedApply(send);
 fireEvent.click(screen.getByRole('button',{name:'카드 1 초안 버리기'}));expect(screen.getByRole('button',{name:apply})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:apply}));expect(send).toHaveBeenCalledExactlyOnceWith('factApply',{reviewRunId:p.factReview!.runId});expect(JSON.stringify(p)).toBe(original);
});
it.each(['instruction','targets'])('계획 화면에서 남긴 %s 초안은 검수 화면으로 이동해도 적용을 막는다',field=>{
 const p=ready('storyboard'),send=vi.fn(),drafts=new Map<string,unknown>();
 const v=render(<DraftContext.Provider value={drafts}><스토리보드 p={p} busy={false} send={send}/></DraftContext.Provider>);
 if(field==='instruction')fireEvent.change(screen.getByLabelText('선택한 카드의 계획 변경 요청'),{target:{value:'계획에서 작성한 초안'}});else fireEvent.click(screen.getByLabelText('이 카드 계획 수정'));
 v.unmount();const q=ready('review');render(<DraftContext.Provider value={drafts}><검수 p={q} busy={false} send={send} developmentMock/></DraftContext.Provider>);
 fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));blockedApply(send);
 fireEvent.click(screen.getByLabelText(/계획 초안 대신 현재 서버에 저장된 결과/));blockedApply(send);
 expect(drafts.get(`${p.projectId}:plan:${p.storyboard!.version}:${field}`)).toEqual(field==='instruction'?'계획에서 작성한 초안':[p.storyboard!.cards[0]!.cardId]);
});
it('깨끗한 초안이어도 busy·활성 작업·허용행동·제안 버전 보호를 유지한다',()=>{
 const send=vi.fn();
 for(const mutate of [(p:ProjectSnapshot)=>{p.allowedActions=[];},(p:ProjectSnapshot)=>{p.activeRun={...p.lastRun!,status:'running'};},(p:ProjectSnapshot)=>{p.projectVersion++;},(p:ProjectSnapshot)=>{p.storyboard!.version++;},(p:ProjectSnapshot)=>{p.result!.version++;}]){
  const p=ready('review');mutate(p);const v=render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));const b=screen.getByRole('button',{name:apply});expect(b).toBeDisabled();fireEvent.click(b);v.unmount();
 }
 render(<검수 p={ready('review')} busy send={send} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));expect(screen.getByRole('button',{name:apply})).toBeDisabled();expect(send).not.toHaveBeenCalled();
});
function plan(){const p=createMockSnapshot('storyboard');p.factIssues=[{code:'SEMANTIC_REVIEW_REQUIRED',message:'의미 검수 보고서 없음',claimIndex:null,cardIds:[],sourceIds:[]}];return p;}
it('사실 경고만으로 제작 승인을 막지 않으며 선택 검수와 이미지 제작 안내를 바로 곁에 둔다',()=>{
 const p=plan(),original=JSON.stringify(p),send=vi.fn();render(<스토리보드 p={p} busy={false} send={send}/>);
 const button=screen.getByRole('button',{name:approval});expect(button).toBeDisabled();expect(send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('계획과 크기를 확인했습니다'));expect(button).toBeEnabled();
 expect(button.previousElementSibling).toHaveTextContent('AI 재검수는 선택');expect(button.previousElementSibling).toHaveTextContent('승인하면 이미지 제작');
 fireEvent.click(button);expect(send).toHaveBeenCalledExactlyOnceWith('approve',{stage:'storyboard'});expect(JSON.stringify(p)).toBe(original);
});
it('제작 승인은 미제출 계획·크기·busy·활성 작업·허용행동·현재 승인 버전 보호를 유지한다',()=>{
 const p=plan(),send=vi.fn();
 for(const mutate of [(q:ProjectSnapshot)=>{q.storyboard!.size=null;},(q:ProjectSnapshot)=>{q.activeRun={...q.lastRun!,status:'running'};},(q:ProjectSnapshot)=>{q.allowedActions=[];},(q:ProjectSnapshot)=>{q.storyboard!.approvedVersion=q.storyboard!.version;}]){
  const q=structuredClone(p);mutate(q);const v=render(<스토리보드 p={q} busy={false} send={send}/>);fireEvent.click(screen.getByLabelText('계획과 크기를 확인했습니다'));expect(screen.getByRole('button',{name:approval})).toBeDisabled();v.unmount();
 }
 const v=render(<스토리보드 p={p} busy={false} send={send}/>);fireEvent.click(screen.getByLabelText('계획과 크기를 확인했습니다'));
 fireEvent.change(screen.getByLabelText('선택한 카드의 계획 변경 요청'),{target:{value:'보존할 초안'}});expect(screen.getByRole('button',{name:approval})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'계획 초안 버리기'}));expect(screen.getByRole('button',{name:approval})).toBeEnabled();
 v.rerender(<스토리보드 p={p} busy send={send}/>);expect(screen.getByRole('button',{name:approval})).toBeDisabled();expect(send).not.toHaveBeenCalled();
});
it('승인 요청은 실제 controller에서 현재 계획 버전을 결합한다',async()=>{
 const p=plan();p.storyboard!.version=7;const mutate=vi.fn().mockResolvedValue({projectId:p.projectId,projectVersion:p.projectVersion});
 const client={bootstrap:async()=>({}),getProject:async()=>p,getEvents:async()=>({events:[],nextSeq:0,hasMore:false}),mutate} as unknown as FrontendClient;
 const ctl=createController(client);await ctl.open(p.projectId);render(<스토리보드 p={p} busy={false} send={ctl.send}/>);
 fireEvent.click(screen.getByLabelText('계획과 크기를 확인했습니다'));fireEvent.click(screen.getByRole('button',{name:approval}));
 await vi.waitFor(()=>expect(mutate).toHaveBeenCalledTimes(1));expect(mutate.mock.calls[0]![2]).toMatchObject({stage:'storyboard',version:7});
});
