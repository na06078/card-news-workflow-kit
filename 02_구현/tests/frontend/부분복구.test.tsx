import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
import {검수} from '../../src/frontend/화면/검수.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
import {createController} from '../../src/frontend/상태.js';
import {createHttpClient} from '../../src/frontend/클라이언트.js';
import {ProjectSnapshotSchema} from '../../src/shared/포트.js';
import {act,waitFor} from '@testing-library/react';
import {nextText} from '../../src/frontend/컴포넌트/진행상태.js';
import {스토리보드} from '../../src/frontend/화면/스토리보드.js';
afterEach(cleanup);
it('저장된 부분 복구의 원인과 버튼을 긴 기존 검수 의견보다 먼저 표시한다',()=>{
 const p=saved();p.factIssues=[{code:'TEST_EXISTING_WARNING',message:'이전 검수 의견 전문은 복구 조작 다음에 둡니다.',claimIndex:0,cardIds:p.factReview!.cardIds,sourceIds:[]}];
 render(<사실검수 p={p} busy={false} send={vi.fn()}/>);
 const region=screen.getByRole('region',{name:'저장된 재검증 부분 복구'}),old=screen.getByText('이전 검수 의견 전문은 복구 조작 다음에 둡니다.');
 expect(region.compareDocumentPosition(old)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});
it('계획 화면의 미제출 지시도 부분 복구를 막고 입력을 보존한다',()=>{
 const p=saved();p.result=null;p.allowedActions.push('revise');const send=vi.fn();render(<스토리보드 p={p} busy={false} send={send}/>);fireEvent.change(screen.getByLabelText('선택한 카드의 계획 변경 요청'),{target:{value:'아직 제출하지 않은 지시'}});expect(screen.getByRole('button',{name:'누락 부분 보완 후 계속'})).toBeDisabled();expect(screen.getByLabelText('선택한 카드의 계획 변경 요청')).toHaveValue('아직 제출하지 않은 지시');expect(send).not.toHaveBeenCalled();
});
it('작업 오류의 새 부분 복구 행동은 전체 재검수가 아닌 검수 상세로 안내한다',()=>{expect(nextText.resume_fact_review).toMatch(/검수 상세.*저장된.*부분 복구/);});
it('UI→controller→HTTP client 실제 직렬화는 CSRF·저장 범위·요청ID를 유실 재시도까지 고정한다 (명시 transport 대역)',async()=>{
 const p=saved('semantic'),posts:{url:string;init:RequestInit;body:Record<string,unknown>}[]=[];
 const response=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
 const transport=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(url);if(path==='/api/bootstrap')return response({csrfToken:'explicit-test-csrf',contractVersion:'CN-1'});
  if(init?.method==='POST'){posts.push({url:path,init,body:JSON.parse(String(init.body))});if(posts.length===1)throw new Error('explicit simulated lost response');return response({projectId:p.projectId,projectVersion:p.projectVersion,runId:p.factReview!.runId,status:'queued',accepted:true});}
  if(path.includes('/events?'))return response({events:[],nextSeq:0,hasMore:false});return response(p);
 });
 const ctl=createController(createHttpClient({fetch:transport}));await ctl.open(p.projectId);await ctl.poll();expect(posts).toHaveLength(0);expect(ctl.getState().snapshot?.factRecovery).toEqual(ProjectSnapshotSchema.parse(p).factRecovery);
 const ui=()=> <검수 p={ctl.getState().snapshot!} busy={ctl.getState().busy||ctl.getState().pendingRetry} send={ctl.send} developmentMock/>;
 const view=render(ui());fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));fireEvent.click(screen.getByRole('button',{name:'내용 검수부터 다시 시도'}));await waitFor(()=>expect(ctl.getState().pendingRetry).toBe(true));
 expect(posts).toHaveLength(1);expect(posts[0]!.url).toBe(`/api/projects/${p.projectId}/factReview`);expect(posts[0]!.init.credentials).toBe('include');expect(new Headers(posts[0]!.init.headers).get('X-CSRF-Token')).toBe('explicit-test-csrf');
 expect(posts[0]!.body).toEqual({requestId:expect.any(String),version:p.projectVersion,claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});
 view.rerender(ui());expect(screen.getByRole('button',{name:'내용 검수부터 다시 시도'})).toBeDisabled();
 await ctl.poll();await ctl.send('factReview',{claimIndices:[0],cardIds:p.factReview!.cardIds});expect(posts).toHaveLength(1);
 await act(async()=>{await ctl.retryPending();});expect(posts).toHaveLength(2);expect(posts[1]).toEqual(posts[0]);expect(ctl.getState().pendingRetry).toBe(false);
 view.unmount();render(ui());expect(posts).toHaveLength(2);
});
it.each(['links','semantic'] as const)('%s 복구는 현재 체크·다음 검수자가 아닌 저장 범위와 ID만 전송하고 polling에도 입력을 보존한다',step=>{
 const p=saved(step),send=vi.fn(),view=render(<검수 p={p} busy={false} send={send} developmentMock/>);
 const summary=screen.getByText('검수 상세·재검수(선택)');fireEvent.click(summary);
 fireEvent.click(screen.getByLabelText(/문제 주장 1 선택/));fireEvent.change(screen.getByLabelText('Gemini 검수 노력'),{target:{value:'low'}});
 const next=structuredClone(p);next.projectVersion++;view.rerender(<검수 p={next} busy={false} send={send} developmentMock/>);
 fireEvent.click(summary);fireEvent.click(summary);expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeChecked();expect(screen.getByLabelText('영향 카드 7 선택')).not.toBeChecked();expect(screen.getByLabelText('Gemini 검수 노력')).toHaveValue('low');expect(send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:step==='links'?'누락 부분 보완 후 계속':'내용 검수부터 다시 시도'}));
 expect(send).toHaveBeenCalledExactlyOnceWith('factReview',{claimIndices:p.factReview!.claimIndices,cardIds:p.factReview!.cardIds,resumeFromRunId:p.factRecovery!.sourceRunId,checkpointId:p.factRecovery!.checkpointId});
 expect(screen.getByLabelText('Gemini 검수 노력')).toHaveValue('low');expect(screen.getByText(/접수된 검수자: claude/)).toBeVisible();
});
it.each(['busy','active','question','unavailable','action','scope','dirty'] as const)('%s 상태에는 부분 복구를 접수하지 않고 이유를 표시한다',kind=>{
 const p=saved(),send=vi.fn();if(kind==='active')p.activeRun={...p.lastRun!,kind:'factReview',status:'queued'};if(kind==='question')p.question={questionId:crypto.randomUUID(),version:1,status:'open'} as ProjectSnapshot['question'];if(kind==='unavailable'){p.factRecovery!.available=false;p.factRecovery!.reason='내용이 변경되어 저장된 복구를 사용할 수 없습니다.';}if(kind==='action')p.allowedActions=p.allowedActions.filter(a=>a!=='resume_fact_review');if(kind==='scope')delete p.factReview;
 render(<검수 p={p} busy={kind==='busy'} send={send} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));
 if(kind==='dirty'){fireEvent.click(screen.getByText('카드 7 원고 편집 · 저장된 원고'));fireEvent.change(screen.getByLabelText('카드 7 본문'),{target:{value:'미제출 원고'}});}
 const region=within(screen.getByRole('region',{name:'저장된 재검증 부분 복구'})),button=region.getByRole('button',{name:'누락 부분 보완 후 계속'});expect(button).toBeDisabled();fireEvent.click(button);expect(send).not.toHaveBeenCalled();expect(region.getByText(/계속할 수 없습니다|완료|미제출|변경되어/)).toBeVisible();
});
it('체크포인트 없는 과거 오류에는 저장 복구 없음만 알리고 일반 전체 재검수를 별도로 둔다',()=>{
 const p=saved();delete p.factRecovery;p.lastRun={...p.lastRun!,runId:p.factReview!.runId,kind:'factReview',status:'failed',error:{code:'FACT_SCOPE_INVALID',message:'이전 오류',retryable:false,nextActions:[],projectId:p.projectId,runId:p.factReview!.runId,currentVersion:p.projectVersion,details:{}}};
 render(<사실검수 p={p} busy={false} send={vi.fn()}/>);expect(screen.getByText(/저장된 부분 복구 자료가 없습니다/)).toBeVisible();expect(screen.queryByRole('button',{name:'누락 부분 보완 후 계속'})).not.toBeInTheDocument();expect(screen.getByText(/새 전체 재검수.*원문 근거를 다시 수집/)).toBeVisible();
});
it('의미 검수 단계는 연결 보완과 구별하고 저장 범위·고정 검수자를 보여 준다',()=>{
 const p=saved('semantic');render(<사실검수 p={p} busy={false} send={vi.fn()}/>);const recovery=within(screen.getByRole('region',{name:'저장된 재검증 부분 복구'}));expect(recovery.getByText(/연결 검사는 다시 확인하고.*의미 검수부터/)).toBeVisible();expect(recovery.getByText(/저장 범위: 주장 1개 · 카드 1개/)).toHaveTextContent('고정 검수자: claude');
});
it.each(['answered','superseded','canceled'] as const)('종료된 질문 %s 기록은 현재 부분 복구를 막지 않는다',status=>{
 const p=saved(),send=vi.fn();
 p.question={questionId:crypto.randomUUID(),version:1,runId:null,kind:'editorial',status,createdAt:'2026-10-27T00:00:00Z',items:[{itemId:'scope',text:'이미 마친 질문',header:'범위',multiSelect:false,allowFreeText:false,recommendedOptionId:null,recommendationReason:null,options:[{optionId:'a',label:'기존 범위',description:'유지'},{optionId:'b',label:'다른 범위',description:'변경'}]}]};
 render(<사실검수 p={p} busy={false} send={send}/>);
 const button=screen.getByRole('button',{name:'누락 부분 보완 후 계속'});expect(button).toBeEnabled();fireEvent.click(button);expect(send).toHaveBeenCalledOnce();
});
function saved(step:'links'|'semantic'='links'):ProjectSnapshot {
 const p=createMockSnapshot('review'),card=p.result!.cards[0]!;card.order=7;card.title='정리: 같은 날, 다른 이유';
 p.claims=[{text:'합성 주장',sourceIds:[],kind:'uncertain',availability:'unknown',conditions:[]}];
 p.allowedActions.push('resume_fact_review','reverify_facts');
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[card.cardId],reviewer:{provider:'claude',model:null},state:'pending',readyVersion:null,proposal:null};
 p.factRecovery={checkpointId:crypto.randomUUID(),sourceRunId:p.factReview.runId,step,available:true,reason:null,savedAt:'2026-10-27T00:00:00Z',issues:step==='links'?[{code:'FACT_CARD_LINK_MISSING',message:'연결 누락',claimIndex:null,cardIds:[card.cardId],sourceIds:[]}]:[]};return p;
}
it('저장된 연결 누락의 정확한 카드와 단일 명시 복구를 접힌 상세 안에 표시한다',()=>{
 const p=saved(),before=structuredClone(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);
 const details=screen.getByText('검수 상세·재검수(선택)').closest('details')!;expect(details).not.toHaveAttribute('open');
 fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));
 const recovery=within(screen.getByRole('region',{name:'저장된 재검증 부분 복구'}));
 expect(recovery.getByText(/수정안은 있지만.*주장 연결.*빠졌습니다/)).toHaveTextContent('카드 7');
 expect(recovery.getByText(/정리: 같은 날, 다른 이유/)).toBeVisible();
 expect(recovery.getByText(/사용자 선택 오류나 뉴스가 거짓이라는 뜻이 아닙니다/)).toBeVisible();
 expect(recovery.getByText(/기존 출처와 후보 수정안을 재사용/)).toHaveTextContent('전체 재수집·이미지 생성 없이');
 expect(recovery.getByText(/추가 LLM 사용량/)).toHaveTextContent('자동 적용·승인하지 않습니다');
 expect(recovery.getAllByRole('button')).toHaveLength(1);expect(recovery.getByRole('button',{name:'누락 부분 보완 후 계속'})).toBeEnabled();
 expect(send).not.toHaveBeenCalled();expect(p).toEqual(before);
});
