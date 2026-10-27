import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {스토리보드} from '../../src/frontend/화면/스토리보드.js';
import {검수} from '../../src/frontend/화면/검수.js';
import {의미검수대역} from './의미검수대역.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {FactProposal,ProjectSnapshot} from '../../src/shared/포트.js';
afterEach(cleanup);
it('비교 표의 정규화 값은 수집 모델 정리이며 독립 확정이 아님을 곁에 표시한다',()=>{
 const p=issue(createMockSnapshot('review')),data=proposal(p);data.findings[0]!.comparisons=[{sourceId:p.sources[0]!.sourceId,country:'Italia',event:null,period:null,population:null,metric:'arresti',unit:null,value:'9',aggregation:'unknown',provisional:null}];
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion-1,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[p.result!.cards[0]!.cardId],state:'ready',proposal:data};
 render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));fireEvent.click(screen.getByText(/주장 1 · 확인 불가 · 영향 카드/));expect(screen.getByText(/수집 모델이 정리한 비교값/)).toBeVisible();expect(screen.getByText('Italia')).toBeVisible();
});
function issue(p:ProjectSnapshot){p.claims=[{text:'검증할 주장',sourceIds:[p.sources[0]!.sourceId],kind:'uncertain',availability:'unknown',conditions:[]}];p.allowedActions.push('reverify_facts');p.factIssues=[{code:'FACT_UNCERTAIN',message:'수치 근거 부족',claimIndex:0,cardIds:[p.storyboard!.cards[0]!.cardId],sourceIds:p.claims[0]!.sourceIds}];return p;}
it('제작 전 문제 주장과 사용자 선택 카드를 명시하여 재검증을 요청한다',()=>{
 const p=issue(createMockSnapshot('storyboard')),send=vi.fn().mockResolvedValue(undefined);render(<스토리보드 p={p} busy={false} send={send}/>);
 expect(screen.getByText('수치 근거 부족')).toBeVisible();expect(send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText(/문제 주장 1 선택/));fireEvent.click(screen.getByLabelText('영향 카드 1 선택'));
 fireEvent.click(screen.getByRole('button',{name:'선택한 주장·카드 사실 재검증'}));
 expect(send).toHaveBeenCalledWith('factReview',{claimIndices:[0],cardIds:[p.storyboard!.cards[0]!.cardId],reviewer:'agy',reviewEffort:'high'});
});
it('검수는 경고를 짧게 요약하고 같은 사실 기록은 상세에서 읽는다',()=>{const p=issue(createMockSnapshot('review'));render(<검수 p={p} busy={false} send={vi.fn()} developmentMock/>);expect(screen.getByText('수치 근거 부족')).not.toBeVisible();expect(screen.getByRole('region',{name:'검수 요약'})).toHaveTextContent('경고 주장 1');fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));expect(screen.getByText('수치 근거 부족')).toBeVisible();});
export function proposal(p:ProjectSnapshot):FactProposal {const c=p.result?.cards[0]??p.storyboard!.cards[0]!;return {semanticReview:{...의미검수대역(p),verdict:'unverifiable',issues:[{cardId:c.cardId,claimIndex:0,sourceIds:p.claims[0]!.sourceIds,message:'LLM도 수집 근거만으로 확인하지 못했습니다',suggestion:null}]},sources:p.sources,observations:[{sourceId:p.sources[0]!.sourceId,toolUseId:'fetch-1',requestedUrl:p.sources[0]!.url,url:p.sources[0]!.url,statusCode:403,bytes:12,outcome:'blocked',observedAt:'2026-10-26T00:00:00Z',evidenceSha256:null}],beforeClaims:[{claimIndex:0,claim:p.claims[0]!}],beforeCards:[c],findings:[{claimIndex:0,cardIds:[c.cardId],classification:'unverifiable',reason:'접근 차단으로 확인 불가',afterClaim:{...p.claims[0]!,kind:'uncertain'},comparisons:[]}],cards:[{...c,body:'수정된 본문'}]};}
it('관측 HTTP와 전후 원고를 구분하고 현재 제안 전체만 명시 적용한다',()=>{
 const p=issue(createMockSnapshot('review'));p.allowedActions.push('apply_fact_proposal');p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion-1,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[p.result!.cards[0]!.cardId],state:'ready',proposal:proposal(p)};
 const send=vi.fn();const v=render(<검수 p={p} busy={false} send={send} developmentMock/>);fireEvent.click(screen.getByText('검수 상세·재검수(선택)'));
 fireEvent.click(screen.getByText('원문 접근·근거 해시 상세 1건'));fireEvent.click(screen.getByText(/주장 1 · 확인 불가 · 영향 카드/));fireEvent.click(screen.getByText('카드 1 원고 전후'));expect(screen.getByText(/HTTP 403/)).toBeVisible();expect(screen.getByText('접근 차단으로 확인 불가')).toBeVisible();expect(screen.getByText('수정된 본문')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'사실 수정안 전체 적용'}));expect(send).toHaveBeenCalledWith('factApply',{reviewRunId:p.factReview.runId});
 v.rerender(<검수 p={{...p,projectVersion:p.projectVersion+1}} busy={false} send={send} developmentMock/>);expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeDisabled();expect(screen.getByText(/오래된 제안/)).toBeVisible();
});

it('수정 문구 없는 제안은 적용 불가 이유와 관측 근거 부족을 설명한다',()=>{
 const p=issue(createMockSnapshot('storyboard'));p.allowedActions.push('apply_fact_proposal');const data=proposal(p);data.cards=[];data.observations=[];
 p.factReview={runId:crypto.randomUUID(),baseVersion:p.projectVersion-1,readyVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:null,contentHash:'a'.repeat(64),claimIndices:[0],cardIds:[p.storyboard!.cards[0]!.cardId],state:'ready',proposal:data};
 render(<스토리보드 p={p} busy={false} send={vi.fn()}/>);
 expect(screen.getByText(/문구 정정 제안이 없습니다/)).toBeVisible();expect(screen.getByText(/실제 원문 접근 관측 없음/)).toBeVisible();expect(screen.getByRole('button',{name:'사실 수정안 전체 적용'})).toBeDisabled();
});

