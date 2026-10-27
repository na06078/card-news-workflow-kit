import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {검수} from '../../src/frontend/화면/검수.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {DraftContext} from '../../src/frontend/초안.js';
import {createController} from '../../src/frontend/상태.js';
import type {FrontendClient} from '../../src/shared/포트.js';
import {의미검수대역} from './의미검수대역.js';
import {createHttpClient} from '../../src/frontend/클라이언트.js';
const label='카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.';
function fixture(){const p=createMockSnapshot('review');p.allowedActions=['approve_final','revise','reverify_facts'];p.claims=[{text:'합성 주장',kind:'uncertain',availability:'unknown',conditions:[],sourceIds:[p.sources[0]!.sourceId]}];return p;}
afterEach(cleanup);
it('검수는 3개 짧은 요약과 기본 접힌 선택 상세로 제공하며 입력을 보존한다',()=>{
 const p=fixture();p.result!.factsCheck='failed';p.factIssues=[{code:'SEMANTIC_REVIEW_REQUIRED',message:'긴 반복 경고',claimIndex:0,cardIds:[p.result!.cards[0]!.cardId],sourceIds:[]}];
 const original=JSON.stringify(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);
 const summary=screen.getByRole('region',{name:'검수 요약'});expect(summary.children.length).toBeLessThanOrEqual(3);expect(summary.textContent!.length).toBeLessThanOrEqual(220);expect(summary).toHaveTextContent('참고');
 const toggle=screen.getByText('검수 상세·재검수(선택)'),details=toggle.closest('details')!;expect(details).not.toHaveAttribute('open');expect(details).toHaveTextContent('긴 반복 경고');
 fireEvent.click(toggle);fireEvent.click(screen.getByRole('button',{name:'모든 주장·카드 선택'}));fireEvent.change(screen.getByLabelText('다음 요청 의미 검수자'),{target:{value:'claude'}});fireEvent.click(toggle);fireEvent.click(toggle);
 expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('claude');expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeChecked();expect(send).not.toHaveBeenCalled();expect(JSON.stringify(p)).toBe(original);
});
it.each(['failed','pending'] as const)('AI %s여도 새 체크만 한 번 승인하고 재렌더·체크 해제·재체크는 중복 요청하지 않는다',state=>{
 const p=fixture();p.result!.factsCheck=state;const send=vi.fn().mockResolvedValue(undefined),original=JSON.stringify(p);
 const view=render(<검수 p={p} busy={false} send={send} developmentMock/>);expect(send).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'현재 결과 최종 승인'})).not.toBeInTheDocument();
 const checkbox=screen.getByLabelText(label);expect(checkbox).toBeEnabled();fireEvent.click(checkbox);expect(send).toHaveBeenCalledExactlyOnceWith('approve',{stage:'final',acknowledgeWarnings:true});
 view.rerender(<검수 p={{...p,projectVersion:p.projectVersion+1}} busy={false} send={send} developmentMock/>);fireEvent.click(checkbox);fireEvent.click(checkbox);expect(send).toHaveBeenCalledTimes(1);expect(JSON.stringify(p)).toBe(original);
 view.unmount();render(<검수 p={p} busy={false} send={send} developmentMock/>);expect(screen.getByLabelText(label)).not.toBeChecked();expect(send).toHaveBeenCalledTimes(1);
});
it('미제출 카드·계획과 busy/활성/구조/허용행동을 잠그며 계획 제외 체크로는 승인하지 않는다',()=>{
 const p=fixture(),send=vi.fn(),drafts=new Map<string,unknown>([[`${p.projectId}:plan:${p.storyboard!.version}:instruction`,'초안']]);
 const view=render(<DraftContext.Provider value={drafts}><검수 p={p} busy={false} send={send} developmentMock/></DraftContext.Provider>);
 expect(screen.getByLabelText(label)).toBeDisabled();fireEvent.click(screen.getByLabelText(/계획 초안 대신/));expect(send).not.toHaveBeenCalled();expect(screen.getByLabelText(label)).toBeEnabled();
 fireEvent.click(screen.getByText('카드 1 원고 편집 · 저장된 원고'));fireEvent.change(screen.getByLabelText('카드 1 본문'),{target:{value:'미제출'}});expect(screen.getByLabelText(label)).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'카드 1 초안 버리기'}));expect(screen.getByLabelText(label)).toBeEnabled();
 view.unmount();
 for(const change of [(q:typeof p)=>{q.allowedActions=[];},(q:typeof p)=>{q.result!.visualCheck='failed';},(q:typeof p)=>{q.result!.cards[0]!.imageAssetId=null;},(q:typeof p)=>{q.activeRun={...q.lastRun!,status:'running'};},(q:typeof p)=>{q.result!.finalApprovedVersion=q.result!.version;}]){
  const q=structuredClone(p);change(q);const v=render(<검수 p={q} busy={false} send={send} developmentMock/>);expect(screen.getByLabelText(label)).toBeDisabled();fireEvent.click(screen.getByLabelText(label));v.unmount();
 }
 render(<검수 p={p} busy send={send} developmentMock/>);expect(screen.getByLabelText(label)).toBeDisabled();expect(send).not.toHaveBeenCalled();
});
it('실제 controller는 불명 결과를 잠그고 명시 재시도만 같은 requestId를 재사용한다',async()=>{
 const p=fixture();p.result!.factsCheck='failed';let current=p;
 const mutate=vi.fn().mockRejectedValueOnce({status:0,error:{code:'NETWORK_ERROR',message:'응답 미확인',details:{requestOutcome:'unknown'}}}).mockImplementation(async()=>{current={...p,projectVersion:p.projectVersion+1,stage:'export'};return {projectId:p.projectId,projectVersion:current.projectVersion};});
 const client={bootstrap:async()=>({}),getProject:async()=>current,getEvents:async()=>({events:[],nextSeq:0,hasMore:false}),mutate} as unknown as FrontendClient;
 const controller=createController(client);await controller.open(p.projectId);
 const view=render(<검수 p={p} busy={false} send={controller.send} developmentMock/>);fireEvent.click(screen.getByLabelText(label));await vi.waitFor(()=>expect(controller.getState().pendingRetry).toBe(true));
 view.rerender(<검수 p={controller.getState().snapshot!} busy={controller.getState().busy||controller.getState().pendingRetry} send={controller.send} developmentMock/>);expect(screen.getByLabelText(label)).toBeDisabled();await controller.poll();expect(mutate).toHaveBeenCalledTimes(1);
 await controller.retryPending();expect(mutate).toHaveBeenCalledTimes(2);expect(mutate.mock.calls[1]![2]).toEqual(mutate.mock.calls[0]![2]);expect(mutate.mock.calls[0]![2]).toMatchObject({stage:'final',acknowledgeWarnings:true,version:p.result!.version});expect(controller.getState().snapshot!.stage).toBe('export');
});
it('고유 경고 개수를 요약하고 출처·긴 차단 안내는 모두 선택 상세 안에만 둔다',()=>{
 const p=fixture(),c=p.result!.cards[0]!,s=p.sources[0]!.sourceId;
 p.factIssues=Array.from({length:4},()=>({code:'FACT_UNCERTAIN',message:'반복 경고 원문',claimIndex:0,cardIds:[c.cardId,c.cardId],sourceIds:[s,s]}));
 const view=render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>),summary=screen.getByRole('region',{name:'검수 요약'}),details=screen.getByText('검수 상세·재검수(선택)').closest('details')!;
 expect(summary).toHaveTextContent('주장 1 · 카드 1 · 출처 1');expect(summary.textContent!.length).toBeLessThanOrEqual(220);
 for(const link of view.container.querySelectorAll('a[href="https://example.org/mock-report"]'))expect(details.contains(link)).toBe(true);
 expect(view.container).not.toHaveTextContent('새 최종 승인은 불가');expect(view.container).not.toHaveTextContent('직접 확인란으로 통과시킬 수 없습니다');expect(view.container).not.toHaveTextContent('확인란으로 기계 판정을 바꿀 수 없습니다');
});
it('동일 전체 보고서만 중복 생략하며 같은 hash의 다른 모델·판정 보고서는 보존한다',()=>{
 const p=fixture(),report=의미검수대역(p);p.result!.semanticReview=report;
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:report.inputHash,claimIndices:[0],cardIds:report.reviewedCardIds,state:'applied',proposal:{semanticReview:structuredClone(report),sources:[],observations:[],beforeClaims:[],beforeCards:[],findings:[],cards:[]}};
 const original=JSON.stringify(p),v=render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);expect(v.container.querySelectorAll('.semantic-report')).toHaveLength(1);expect(JSON.stringify(p)).toBe(original);
 const next=structuredClone(p);next.factReview!.proposal!.semanticReview!.reviewer.provider='claude';next.factReview!.proposal!.semanticReview!.verdict='unverifiable';v.rerender(<검수 p={next} busy={false} send={vi.fn()} developmentMock/>);expect(v.container.querySelectorAll('.semantic-report')).toHaveLength(2);
});
it('재검수 실패는 짧게 밖에 남기고 원인·선택 요청은 접힌 상세에서 확인한다',()=>{
 const p=fixture();p.lastRun={...p.lastRun!,kind:'factReview',status:'failed',error:{code:'REVIEW_TIMEOUT',message:'검수 시간 초과',retryable:false,nextActions:['reverify_facts'],projectId:p.projectId,runId:p.lastRun!.runId,currentVersion:p.projectVersion,details:{}}};
 render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);expect(screen.getByRole('region',{name:'검수 요약'})).toHaveTextContent('재검수 실패 · 상세에서 원인·새 요청 확인');expect(screen.getByLabelText(label)).toBeEnabled();
});
it('옛 checkedVersion 초안·폴링형 재렌더·새 버전은 동의가 아니며 체크 해제도 요청하지 않는다',()=>{
 const p=fixture(),send=vi.fn(),drafts=new Map<string,unknown>([['checkedVersion',`${p.projectId}:${p.result!.version}`]]);
 const ui=(q:typeof p)=><DraftContext.Provider value={drafts}><검수 p={q} busy={false} send={send} developmentMock/></DraftContext.Provider>,view=render(ui(p));view.rerender(ui({...p,projectVersion:p.projectVersion+1}));
 fireEvent.change(screen.getByLabelText(label),{target:{checked:false}});const next=structuredClone(p);next.result!.version++;view.rerender(ui(next));expect(screen.getByLabelText(label)).not.toBeChecked();expect(send).not.toHaveBeenCalled();
});
it('새 체크는 실제 HTTP client의 기존 final approve 주소·CSRF·현재 버전으로만 전달된다',async()=>{
 const p=fixture(),calls:{url:string;init?:RequestInit}[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),init});const data=String(url).endsWith('/bootstrap')?{csrfToken:'test-csrf',contractVersion:'CN-1'}:String(url).endsWith('/events?after=0')?{events:[],nextSeq:0,hasMore:false}:init?.method==='POST'?{projectId:p.projectId,projectVersion:p.projectVersion,runId:null,status:null,accepted:true,finalApprovedVersion:p.result!.version}:p;return new Response(JSON.stringify({data}),{status:200});});
 const client=createHttpClient({fetch:fetcher}),controller=createController(client);await controller.open(p.projectId);render(<검수 p={p} busy={false} send={controller.send} developmentMock/>);fireEvent.click(screen.getByLabelText(label));await vi.waitFor(()=>expect(controller.getState().busy).toBe(false));
 const posts=calls.filter(c=>c.init?.method==='POST');expect(posts).toHaveLength(1);expect(posts[0]!.url).toBe(`/api/projects/${p.projectId}/approve`);expect(JSON.parse(String(posts[0]!.init!.body))).toMatchObject({stage:'final',version:p.result!.version,acknowledgeWarnings:true});expect(new Headers(posts[0]!.init!.headers).get('X-CSRF-Token')).toBe('test-csrf');
});