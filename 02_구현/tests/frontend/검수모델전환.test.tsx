import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {FrontendClient,ProjectSnapshot,SemanticReviewReport} from '../../src/shared/포트.js';
import {canFinalApprove,createController} from '../../src/frontend/상태.js';
import {검수} from '../../src/frontend/화면/검수.js';
afterEach(cleanup);
function report(p:ProjectSnapshot):SemanticReviewReport{return {verdict:'supported',reviewedCardIds:p.result!.cards.map(c=>c.cardId),reviewedClaimIndices:p.claims.map((_,i)=>i),issues:[],reviewer:{provider:'agy',model:'gemini-3.8-flash-high'},actualModel:null,reviewedAt:'2026-10-26T00:00:00Z',inputHash:'a'.repeat(64)};}
it('엄격 승인은 passed만으로 허용하지 않지만 사용자 직접 체크는 별도 승인한다',()=>{
 const p=createMockSnapshot('review');expect(canFinalApprove(p)).toBe(false);const send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);
 expect(screen.getByRole('region',{name:'검수 요약'})).toHaveTextContent('의미 검수 없음');fireEvent.click(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.'));
 expect(send).toHaveBeenCalledExactlyOnceWith('approve',{stage:'final',acknowledgeWarnings:true});
});
it('supported 기록과 기존 guard가 모두 있어야 최종 승인할 수 있다',()=>{
 const p=createMockSnapshot('review');p.result!.semanticReview=report(p);expect(canFinalApprove(p)).toBe(true);
 p.factIssues=[{code:'SEMANTIC_REVIEW_STALE',message:'입력 변경',claimIndex:null,cardIds:[],sourceIds:[]}];expect(canFinalApprove(p)).toBe(false);
 p.factIssues=[];p.result!.semanticReview.verdict='unsupported';expect(canFinalApprove(p)).toBe(false);
 p.result!.semanticReview.verdict='unverifiable';expect(canFinalApprove(p)).toBe(false);
 p.result!.semanticReview.verdict='supported';p.result!.visualCheck='pending';expect(canFinalApprove(p)).toBe(false);
});
it('보고서의 요청·관측 모델과 문제 위치·근거·제안을 LLM 의견으로 표시한다',()=>{
 const p=createMockSnapshot('review'),r=report(p);r.verdict='unsupported';r.issues=[{cardId:p.result!.cards[0]!.cardId,claimIndex:0,sourceIds:[p.sources[0]!.sourceId],message:'수집 근거와 문장의 범위가 다릅니다',suggestion:'대상을 한정하세요'}];p.result!.semanticReview=r;const send=vi.fn();
 render(<사실검수 p={p} busy={false} send={send}/>);expect(screen.getByRole('heading',{name:'현재 결과 LLM 의미 검수 의견'})).toBeVisible();expect(screen.getByText(/요청 모델: gemini-3.8-flash-high/)).toBeVisible();expect(screen.getByText(/관측 모델: 미확인/)).toBeVisible();expect(screen.getByText(/unsupported · 근거 지지 안 됨/)).toBeVisible();expect(screen.getByText(/카드 1 · 주장 1/)).toBeVisible();fireEvent.click(screen.getByText(/의견 1 · 카드 1 · 주장 1/));expect(screen.getByText('수집 근거와 문장의 범위가 다릅니다')).toBeVisible();expect(screen.getByText(/대상을 한정하세요/)).toBeVisible();expect(send).not.toHaveBeenCalled();
});
it('진행 중 접수 검수자와 다음 선택을 구별하고 완료 전 관측 모델을 추측하지 않는다',()=>{
 const p=createMockSnapshot('review');p.activeRun={...p.lastRun!,kind:'factReview',status:'running'};p.factReview={runId:p.activeRun.runId,baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[p.result!.cards[0]!.cardId],state:'pending',readyVersion:null,proposal:null,reviewer:{provider:'claude',model:null}};const send=vi.fn();
 render(<사실검수 p={p} busy={false} send={send}/>);expect(screen.getByLabelText('다음 요청 의미 검수자')).toBeDisabled();expect(screen.getByLabelText('Gemini 검수 노력')).toBeDisabled();expect(screen.getByText(/접수된 검수자: claude · 요청 모델: SDK 기본값/)).toBeVisible();expect(screen.getByText(/의미 검수 결과 대기/)).toBeVisible();expect(send).not.toHaveBeenCalled();
});
it('적용 전 제안 보고서는 현재 결과와 별도로 표시하고 보고서 없는 이전 제안은 적용하지 않는다',()=>{
 const p=createMockSnapshot('review');p.allowedActions.push('apply_fact_proposal');const card=p.result!.cards[0]!,r=report(p);r.actualModel='observed-review-model';
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[card.cardId],state:'ready',readyVersion:p.projectVersion,reviewer:r.reviewer,proposal:{sources:[],observations:[],findings:[],beforeClaims:[],beforeCards:[card],cards:[{...card,body:'정정 본문'}],semanticReview:r}};
 const send=vi.fn(),view=render(<사실검수 p={p} busy={false} send={send}/>);expect(screen.getByRole('heading',{name:'적용 전 제안 LLM 의미 검수 의견'})).toBeVisible();expect(screen.getByText(/관측 모델: observed-review-model/)).toBeVisible();expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeEnabled();
 delete p.factReview.proposal!.semanticReview;view.rerender(<사실검수 p={p} busy={false} send={send}/>);expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeDisabled();expect(screen.getByText(/이전 제안에 LLM 의미 검수 기록이 없습니다/)).toBeVisible();expect(send).not.toHaveBeenCalled();
});
it('이미 승인된 과거 기록은 읽기만 해도 취소하지 않고 보존 안내한다',()=>{
 const p=createMockSnapshot('review');p.result!.finalApprovedVersion=p.result!.version;const before=structuredClone(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeDisabled();expect(screen.getByText(/현재 결과 최종 승인 저장됨/)).toBeVisible();expect(p).toEqual(before);expect(send).not.toHaveBeenCalled();
});
it('원고가 이미 적절해도 supported 보고서가 담긴 카드 제안은 명시 적용할 수 있다',()=>{
 const p=createMockSnapshot('review'),card=p.result!.cards[0]!,r=report(p);p.allowedActions.push('apply_fact_proposal');p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[card.cardId],state:'ready',readyVersion:p.projectVersion,proposal:{sources:[],observations:[],findings:[],beforeClaims:[],beforeCards:[card],cards:[card],semanticReview:r}};const send=vi.fn();render(<사실검수 p={p} busy={false} send={send}/>);expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeEnabled();expect(screen.getByText(/원고 변경 없이 의미 검수 기록을 적용/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'사실 수정안 전체 적용'}));expect(send).toHaveBeenCalledWith('factApply',{reviewRunId:p.factReview.runId});
});
it('generic mutate가 선택·노력과 원래 요청 ID를 유실 재전송에도 보존하고 polling으로 검수하지 않는다',async()=>{
 const p=createMockSnapshot('review'),mutate=vi.fn().mockRejectedValueOnce({status:0,error:{code:'NETWORK_ERROR',message:'유실'}}).mockResolvedValue({projectId:p.projectId,projectVersion:p.projectVersion,runId:crypto.randomUUID(),status:'queued',accepted:true});
 const client={bootstrap:vi.fn(async()=>({csrfToken:'fake',contractVersion:'CN-1'})),getProject:vi.fn(async()=>p),getEvents:vi.fn(async()=>({events:[],nextSeq:0,hasMore:false})),mutate} as unknown as FrontendClient;
 const ctl=createController(client);await ctl.open(p.projectId);await ctl.poll();expect(mutate).not.toHaveBeenCalled();
 await ctl.send('factReview',{claimIndices:[0],cardIds:[p.result!.cards[0]!.cardId],reviewer:'agy',reviewEffort:'low'});expect(mutate).toHaveBeenCalledTimes(1);expect(mutate.mock.calls[0]?.[2]).toMatchObject({reviewer:'agy',reviewEffort:'low',version:p.projectVersion});expect(ctl.getState().pendingRetry).toBe(true);
 await ctl.retryPending();expect(mutate.mock.calls[1]).toEqual(mutate.mock.calls[0]);
});
it.each(['SEMANTIC_REVIEW_STALE','SEMANTIC_REVIEW_UNSUPPORTED'] as const)('서버의 %s 경고는 보존하되 새 직접 확인 승인을 막지 않는다',(code)=>{
 const p=createMockSnapshot('review');p.result!.semanticReview=report(p);p.factIssues=[{code,message:'이전 의미 검수 경고',claimIndex:null,cardIds:[],sourceIds:[]}];const before=structuredClone(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.'));expect(send).toHaveBeenCalledExactlyOnceWith('approve',{stage:'final',acknowledgeWarnings:true});expect(p).toEqual(before);
});
it('agy High 기본값과 명시 선택만 전송하고 작성 모델을 변경하지 않는다',()=>{
 const p=createMockSnapshot('review');p.allowedActions.push('reverify_facts');p.claudeModel='saved-author-model';p.claims=[{text:'검토 주장',sourceIds:[],kind:'uncertain',availability:'unknown',conditions:[]}];const send=vi.fn();
 const view=render(<사실검수 p={p} busy={false} send={send}/>);
 expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('agy');expect(screen.getByLabelText('Gemini 검수 노력')).toHaveValue('high');expect(send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'모든 주장·카드 선택'}));
 fireEvent.click(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'}));
 expect(send).toHaveBeenLastCalledWith('factReview',{claimIndices:p.claims.map((_,i)=>i),cardIds:p.result!.cards.map(c=>c.cardId),reviewer:'agy',reviewEffort:'high'});
 fireEvent.change(screen.getByLabelText('Gemini 검수 노력'),{target:{value:'medium'}});fireEvent.click(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'}));expect(send.mock.lastCall?.[1].reviewEffort).toBe('medium');
 fireEvent.change(screen.getByLabelText('Gemini 검수 노력'),{target:{value:'low'}});fireEvent.click(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'}));expect(send.mock.lastCall?.[1].reviewEffort).toBe('low');
 fireEvent.change(screen.getByLabelText('다음 요청 의미 검수자'),{target:{value:'claude'}});expect(screen.getByText(/Claude 요청 모델: saved-author-model/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'}));expect(send.mock.lastCall?.[1].reviewer).toBe('claude');expect(p.claudeModel).toBe('saved-author-model');
 const count=send.mock.calls.length;view.rerender(<사실검수 p={p} busy send={send}/>);expect(screen.getByLabelText('다음 요청 의미 검수자')).toBeDisabled();expect(send).toHaveBeenCalledTimes(count);
});
