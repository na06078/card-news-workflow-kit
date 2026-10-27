import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';
import {검수} from '../../src/frontend/화면/검수.js';
import {스토리보드} from '../../src/frontend/화면/스토리보드.js';
import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
afterEach(cleanup);
it('실패한 7카드8주장 화면의 요청 자리에서 실패 단계·원인·선택 조건을 읽고 전체 선택 후 새 요청한다',()=>{
 const p=failed(reception(seven())),before=structuredClone(p),send=vi.fn();render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));
 const actions=within(screen.getByRole('group',{name:'사실 재검증 요청과 상태'}));
 expect(actions.getByText(/선택한 주장 0\/8개 · 카드 0\/7개/)).toBeVisible();expect(actions.getByText(/문제 주장을 1~100개 선택하세요/)).toBeVisible();expect(actions.getByText(/영향 카드를 1~20개 선택하세요/)).toBeVisible();
 expect(actions.getByText(/semantic-review/)).toBeVisible();expect(actions.getByText(/FACT_REVIEW_FAILED/)).toBeVisible();expect(actions.getByText(/의미 검수 응답을 확인하지 못했습니다/)).toBeVisible();expect(actions.getByText(/이전 요청은 사용량을 소모했을 수 있습니다/)).toBeVisible();
 const button=actions.getByRole('button',{name:'선택한 주장·카드 사실 재검증'});expect(button).toBeDisabled();fireEvent.click(actions.getByRole('button',{name:'요청 위치에서 모든 주장·카드 선택'}));expect(actions.getByText(/선택한 주장 8\/8개 · 카드 7\/7개/)).toBeVisible();expect(button).toBeEnabled();expect(send).not.toHaveBeenCalled();fireEvent.click(button);
 expect(send).toHaveBeenCalledExactlyOnceWith('factReview',{claimIndices:[0,1,2,3,4,5,6,7],cardIds:p.result!.cards.map(c=>c.cardId),reviewer:'agy',reviewEffort:'high'});expect(p).toEqual(before);
});
it.each(['project','claim-index','claim-count','card-scope','card-copy','source'] as const)('%s 실제 내용 정체성이 달라지면 옛 index 선택을 전송하지 않는다',change=>{
 const p=seven(),send=vi.fn(),view=render(<사실검수 p={p} busy={false} send={send}/>);fireEvent.click(screen.getByRole('button',{name:'모든 주장·카드 선택'}));fireEvent.change(screen.getByLabelText('다음 요청 의미 검수자'),{target:{value:'claude'}});
 const next=structuredClone(p);if(change==='project')next.projectId=crypto.randomUUID();if(change==='claim-index')next.claims.reverse();if(change==='claim-count')next.claims.pop();if(change==='card-scope')next.result!.cards.pop();if(change==='card-copy')next.result!.cards[0]!.body='바뀐 발행 문장';if(change==='source')next.sources[0]!.evidence='변경된 근거';view.rerender(<사실검수 p={next} busy={false} send={send}/>);
 expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('agy');expect(screen.getByLabelText(/문제 주장 1 선택/)).not.toBeChecked();expect(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeDisabled();expect(send).not.toHaveBeenCalled();
});
it.each(['FACT_REVIEW_FAILED','REVIEW_TIMEOUT','FACT_FETCH_NOT_ATTEMPTED'])('실제 오류 %s의 앱 소유 문구를 요청 옆에 유지한다',code=>{
 const p=failed(reception(seven()));p.lastRun!.error!.code=code;p.lastRun!.error!.message=code==='FACT_FETCH_NOT_ATTEMPTED'?'원문 접근을 시도하지 않아 중단했습니다.':'제한 시간 내 검수 응답을 확인하지 못했습니다.';
 render(<사실검수 p={p} busy={false} send={vi.fn()}/>);const actions=within(screen.getByRole('group',{name:'사실 재검증 요청과 상태'}));expect(actions.getByText(new RegExp(code))).toBeVisible();expect(actions.getByText(p.lastRun!.error!.message)).toBeVisible();expect(actions.getByText(/원문 수집 후보 준비는 사실 검증 성공이 아닙니다/)).toBeVisible();
});
it('보고서 없는 미요청·실행 중·실패를 구분하고 busy·허용 행동 guard를 유지한다',()=>{
 const p=seven(),send=vi.fn(),view=render(<사실검수 p={p} busy={false} send={send}/>);let actions=within(screen.getByRole('group',{name:'사실 재검증 요청과 상태'}));expect(actions.getByText(/아직 사실 재검증을 요청하지 않았습니다/)).toBeVisible();fireEvent.click(actions.getByRole('button',{name:'요청 위치에서 모든 주장·카드 선택'}));
 view.rerender(<사실검수 p={p} busy send={send}/>);expect(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeDisabled();expect(screen.getByText(/요청 전송 또는 결과 확인 중/)).toBeVisible();
 const forbidden={...p,allowedActions:[]};view.rerender(<사실검수 p={forbidden} busy={false} send={send}/>);expect(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeDisabled();expect(screen.getByText(/현재 서버 상태에서는 사실 재검증 요청이 허용되지 않습니다/)).toBeVisible();
 const active=reception(p);view.rerender(<사실검수 p={active} busy={false} send={send}/>);actions=within(screen.getByRole('group',{name:'사실 재검증 요청과 상태'}));expect(actions.getByText(/재검증 진행 중 · 완료 보고서는 아직 없습니다/)).toBeVisible();expect(actions.getByRole('button',{name:'요청 위치에서 모든 주장·카드 선택'})).toBeDisabled();expect(actions.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeDisabled();
 view.rerender(<사실검수 p={failed(active)} busy={false} send={send}/>);expect(screen.getByText(/재검증 실패 · 완료된 의미 검수 보고서가 없습니다/)).toBeVisible();expect(send).not.toHaveBeenCalled();
});
function seven(){const p=createMockSnapshot('review');p.allowedActions.push('reverify_facts');const card=p.result!.cards[0]!;p.result!.cards=Array.from({length:7},(_,i)=>({...card,cardId:crypto.randomUUID(),order:i+1}));p.claims=Array.from({length:8},(_,i)=>({text:`검토 주장 ${i+1}`,sourceIds:[],kind:'uncertain' as const,availability:'unknown' as const,conditions:[]}));return p;}
function reception(p:ProjectSnapshot){const next=structuredClone(p);next.projectVersion++;next.activeRun={...p.lastRun!,kind:'factReview',runId:crypto.randomUUID(),status:'running',phase:'semantic-review'};next.factReview={runId:next.activeRun.runId,baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result?.version??null,contentHash:'a'.repeat(64),claimIndices:p.claims.map((_,i)=>i),cardIds:(p.result?.cards??p.storyboard!.cards).map(c=>c.cardId),state:'pending',readyVersion:null,proposal:null};return next;}
function failed(p:ProjectSnapshot){const next=structuredClone(p);next.projectVersion++;next.lastRun={...next.activeRun!,status:'failed',externalOutcome:'unknown',error:{code:'FACT_REVIEW_FAILED',message:'의미 검수 응답을 확인하지 못했습니다.',retryable:false,nextActions:['reverify_facts'],projectId:next.projectId,runId:next.activeRun!.runId,currentVersion:next.projectVersion,details:{}}};next.activeRun=null;next.status='error';return next;}
it.each(['review','plan'] as const)('%s 화면은 접수·실패의 버전 증가에도 선택과 명시 검수자를 보존한다',mode=>{
 const p=seven();if(mode==='plan')p.result=null;const send=vi.fn();const ui=(value:ProjectSnapshot)=>(mode==='review'?<검수 p={value} busy={false} send={send} developmentMock/>:<스토리보드 p={value} busy={false} send={send}/>);const view=render(ui(p));if(mode==='review')fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));
 fireEvent.click(screen.getByRole('button',{name:'모든 주장·카드 선택'}));fireEvent.change(screen.getByLabelText('다음 요청 의미 검수자'),{target:{value:'claude'}});
 const active=reception(p);view.rerender(ui(active));expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('claude');expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeChecked();expect(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeDisabled();
 const end=failed(active);view.rerender(ui(end));expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('claude');expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeChecked();expect(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'})).toBeEnabled();expect(send).not.toHaveBeenCalled();
});
