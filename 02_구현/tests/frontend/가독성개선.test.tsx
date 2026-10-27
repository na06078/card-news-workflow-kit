import '@testing-library/jest-dom/vitest';

it('많은 이력의 한국 시각과 날짜 경계를 유지하며 행마다 로캘 조회를 반복하지 않는다',()=>{
 const p=createMockSnapshot('question'),run=p.activeRun!,dates=['2026-10-25T14:59:59.000Z','2026-10-25T15:00:00.000Z'];
 const expected=dates.map(at=>new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST');
 const events:EngineEvent[]=Array.from({length:100},(_,n)=>({projectId:p.projectId,runId:run.runId,attempt:1,at:dates[n%2]!,seq:n+1,type:'progress',phase:'research',message:`시각 보존 ${n+1}`,completed:null,total:null}));
 const localeLookup=vi.spyOn(Date.prototype,'toLocaleString');
 try{render(<진행상태 p={p} busy={false} send={vi.fn()} events={events}/>);for(const text of expected)expect(screen.getAllByText(text).length).toBeGreaterThanOrEqual(50);expect(localeLookup.mock.calls.length).toBe(0);}
 finally{localeLookup.mockRestore();}
});

it('긴 현재 차단 사유는 짧은 원문 요약과 복구 행동을 남기고 전문만 접는다',()=>{
 const p=createMockSnapshot('review'),message='제공된 근거로 확인할 수 없습니다: '+ '긴 차단 사유 '.repeat(100).trim();p.factIssues=[{code:'SEMANTIC_REVIEW_UNSUPPORTED',message,claimIndex:0,cardIds:[p.result!.cards[0]!.cardId],sourceIds:[]}];const send=vi.fn();render(<사실검수 p={p} busy={false} send={send}/>);
 expect(screen.getByText(message)).not.toBeVisible();expect(screen.getByText(/제공된 근거로 확인할 수 없습니다:.*…/)).toBeVisible();expect(screen.getByText(/SEMANTIC_REVIEW_UNSUPPORTED/)).toBeVisible();expect(screen.getByText(/다음 행동: 선택 범위/)).toBeVisible();fireEvent.click(screen.getByText('차단 이유 전문 · 주장 1'));expect(screen.getByText(message)).toBeVisible();expect(send).not.toHaveBeenCalled();
});
it('종료한 실행도 최근 결과 활동을 이력 밖에서 읽을 수 있다',()=>{
 const p=createMockSnapshot('review'),run=p.lastRun!,e:EngineEvent={type:'result',kind:'cards',version:2,seq:1,projectId:p.projectId,runId:run.runId,attempt:1,at:run.createdAt};render(<진행상태 p={p} busy={false} send={vi.fn()} events={[e]}/>);expect(screen.getByText('최근 기록: 카드 결과 저장 · v2')).toBeVisible();
});


it('접기 요약과 원문 링크는 44px 조작 높이를 갖고 앱 문서 흐름은 유지한다',()=>{
 const css=readFileSync('src/frontend/스타일.css','utf8');expect(css).toMatch(/:is\(\.source-details,\.text-editor,\.review-details,\.semantic-issue\)>summary\s*\{[^}]*min-height:44px/s);expect(css).toMatch(/\.source-heading a\s*\{[^}]*min-height:44px/s);expect(css).toContain('height:auto;width:100%;min-width:0;max-width:var(--workspace-width);overflow:visible');
});


import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
it('검수 요약·위치·차단·다음 요청은 보이며 긴 의견·해시·비교·전후 원고만 접힌다',()=>{
 const p=createMockSnapshot('review'),c=p.result!.cards[0]!,send=vi.fn(),r={...의미검수대역(p),verdict:'unverifiable' as const,issues:[{cardId:c.cardId,claimIndex:0,sourceIds:[p.sources[0]!.sourceId],message:'긴 LLM 검수 의견 '.repeat(100).trim(),suggestion:'근거를 보강하세요'}]};
 p.claims=[{text:'검토 대상 주장',sourceIds:[p.sources[0]!.sourceId],kind:'uncertain',availability:'unknown',conditions:[]}];p.result!.semanticReview=r;p.allowedActions.push('reverify_facts','apply_fact_proposal');p.factIssues=[{code:'FACT_UNCERTAIN',message:'발행 차단: 수치 근거 부족',claimIndex:0,cardIds:[c.cardId],sourceIds:[]}];
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[c.cardId],state:'ready',proposal:{semanticReview:r,sources:p.sources,observations:[{sourceId:p.sources[0]!.sourceId,toolUseId:'fixture',requestedUrl:p.sources[0]!.url,url:p.sources[0]!.url,statusCode:403,bytes:12,outcome:'blocked',observedAt:'2026-10-26T00:00:00Z',evidenceSha256:null}],findings:[{claimIndex:0,cardIds:[c.cardId],classification:'unverifiable',reason:'긴 수집 판정 이유',afterClaim:{...p.claims[0]!},comparisons:[{sourceId:p.sources[0]!.sourceId,country:'비교 국가',event:null,period:null,population:null,metric:null,unit:null,value:null,aggregation:'unknown',provisional:null}]}],beforeClaims:[{claimIndex:0,claim:p.claims[0]!}],beforeCards:[c],cards:[{...c,body:'제안된 전후 원고'}]}};
 const before=structuredClone(p),v=render(<사실검수 p={p} busy={false} send={send}/>);
 expect(screen.getByText('발행 차단: 수치 근거 부족')).toBeVisible();expect(screen.getByText('확인 불가 판정은 적용 후에도 기록에 남습니다. 직접 확인 승인은 AI 판정을 통과로 바꾸지 않습니다.')).toBeVisible();expect(screen.getByRole('heading',{name:'현재 결과 LLM 의미 검수 의견'})).toBeVisible();expect(screen.getAllByText(/이슈 1개/).length).toBe(1);
 for(const e of screen.getAllByText(r.issues[0]!.message))expect(e).not.toBeVisible();for(const e of screen.getAllByText(/입력 해시:/))expect(e).not.toBeVisible();expect(screen.getByText('제안된 전후 원고')).not.toBeVisible();expect(screen.getByText('비교 국가')).not.toBeVisible();expect(screen.getByText(/HTTP 403/)).not.toBeVisible();
 expect(screen.getByLabelText('다음 요청 의미 검수자')).toBeVisible();expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeVisible();expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'모든 주장·카드 선택'}));fireEvent.change(screen.getByLabelText('다음 요청 의미 검수자'),{target:{value:'claude'}});
 const issue=v.container.querySelector('.semantic-issue summary')!;fireEvent.click(issue);expect(screen.getAllByText(r.issues[0]!.message)[0]).toBeVisible();fireEvent.click(issue);expect(screen.getByLabelText(/문제 주장 1 선택/)).toBeChecked();expect(screen.getByLabelText('다음 요청 의미 검수자')).toHaveValue('claude');
 fireEvent.click(screen.getByText('카드 1 원고 전후'));expect(screen.getByText('제안된 전후 원고')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'사실 수정안 전체 적용'}));expect(send).toHaveBeenCalledExactlyOnceWith('factApply',{reviewRunId:p.factReview.runId});expect(p).toEqual(before);
});


import {검수} from '../../src/frontend/화면/검수.js';
import {의미검수대역} from './의미검수대역.js';
it('원고 편집은 기본 접히고 닫아도 dirty 초안과 승인 차단·수정 전송을 보존한다',()=>{
 const p=createMockSnapshot('review');p.result!.semanticReview=의미검수대역(p);p.allowedActions=['revise','approve_final'];const before=structuredClone(p),send=vi.fn();
 render(<검수 p={p} busy={false} send={send} developmentMock={false}/>);
 expect(screen.getByText(p.result!.cards[0]!.title)).toBeVisible();const body=screen.getByLabelText('카드 1 본문');expect(body).not.toBeVisible();expect(screen.getByRole('img',{name:'카드 1 서버 렌더 PNG'})).toBeVisible();
 const summary=screen.getByText('카드 1 원고 편집 · 저장된 원고');fireEvent.click(summary);expect(body).toBeVisible();fireEvent.change(body,{target:{value:'미제출 원고'}});
 fireEvent.click(screen.getByText('카드 1 원고 편집 · 미제출 변경 있음'));expect(body).not.toBeVisible();expect(screen.getByText('카드 1 원고 편집 · 미제출 변경 있음')).toBeVisible();
 expect(screen.getByLabelText('카드 내용을 직접 확인했습니다. 체크하면 파일 준비로 이동합니다.')).toBeDisabled();expect(screen.getByText(/미제출 카드 초안/)).toBeVisible();
 fireEvent.click(screen.getByText('카드 1 원고 편집 · 미제출 변경 있음'));expect(body).toHaveValue('미제출 원고');fireEvent.click(screen.getByRole('button',{name:'카드 1 텍스트 수정 요청'}));expect(send).toHaveBeenCalledExactlyOnceWith('revisions',{scope:'text',cardIds:[p.result!.cards[0]!.cardId],instruction:JSON.stringify({title:p.result!.cards[0]!.title,body:'미제출 원고'})});expect(p).toEqual(before);
});


import {출처표시} from '../../src/frontend/컴포넌트/출처표시.js';
it('출처 매체·원문 링크·상태는 보이고 긴 제목·인용·제약만 기본 접힌다',()=>{
 const p=createMockSnapshot('review'),s={...p.sources[0]!,publisher:'검증 매체',title:'긴 기사 제목 '.repeat(30).trim(),evidence:'원문 근거 '.repeat(200).trim(),limitations:['열람 제약 원문']},before=structuredClone(p.sources);
 const v=render(<출처표시 sources={[s]} ids={[s.sourceId]}/>);
 expect(screen.getByText('검증 매체')).toBeVisible();const link=screen.getByRole('link',{name:'원문 보기 ↗'});expect(link).toHaveAttribute('href',s.url);expect(link.closest('summary')).toBeNull();
 expect(screen.getByText(s.title)).not.toBeVisible();expect(screen.getByText(s.evidence)).not.toBeVisible();expect(screen.getByText(s.limitations[0]!)).not.toBeVisible();
 fireEvent.click(screen.getByText('기사 제목·근거·제약 보기'));expect(screen.getByText(s.evidence)).toBeVisible();expect(p.sources).toEqual(before);expect(v.container.querySelector('details')).toHaveAttribute('open');
});
it('매체가 없으면 검증된 웹 호스트를 표시하고 잘못된 URL은 링크로 만들지 않는다',()=>{
 const p=createMockSnapshot('review'),s={...p.sources[0]!,publisher:null,url:'https://news.example.org/articles/long?keep=1'};
 const v=render(<출처표시 sources={[s]} ids={[s.sourceId]}/>);expect(screen.getByText('news.example.org')).toBeVisible();
 v.rerender(<출처표시 sources={[{...s,url:'javascript:alert(1)'}]} ids={[s.sourceId]}/>);expect(screen.queryByRole('link')).not.toBeInTheDocument();expect(screen.getByText('출처 호스트 미확인')).toBeVisible();
});

import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {진행상태} from '../../src/frontend/컴포넌트/진행상태.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {EngineEvent} from '../../src/shared/포트.js';
afterEach(cleanup);
it.each([100,1000,10000])('이력 %i건은 기본 접힘이며 펼친 목록만 360px 스크롤이고 현재 상태·취소는 밖에 남는다',count=>{
 const p=createMockSnapshot('question');p.activeRun!.status='running';p.allowedActions=['cancel'];
 const events:EngineEvent[]=Array.from({length:count},(_,i)=>({projectId:p.projectId,runId:p.activeRun!.runId,attempt:1,at:p.activeRun!.createdAt,seq:i+1,type:'progress',phase:'research',message:`관측 활동 ${i+1}`,completed:null,total:null}));
 const send=vi.fn(),view=render(<진행상태 p={p} busy={false} send={send} events={events}/>);
 const history=view.container.querySelector('details.event-history')!;
 expect(history).not.toHaveAttribute('open');
 const list=screen.getByLabelText('시간순 작업 이력');expect(list).toHaveAttribute('tabindex','0');expect(list).not.toBeVisible();
 expect(screen.getByRole('status',{name:'현재 작업'})).toHaveTextContent(`관측 활동 ${count}`);
 const cancel=screen.getByRole('button',{name:'작업 취소 요청'});expect(history.contains(cancel)).toBe(false);
 fireEvent.click(within(history as HTMLElement).getByText(`시간순 작업 이력 · ${count}건`));expect(list).toBeVisible();expect(list.children).toHaveLength(count);
 const css=readFileSync('src/frontend/스타일.css','utf8');expect(css).toMatch(/\.event-history ol\s*\{[^}]*max-height:\s*360px[^}]*overflow-y:\s*auto/s);
 fireEvent.click(cancel);expect(send).toHaveBeenCalledExactlyOnceWith('cancel');
});
