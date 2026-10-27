import {it,expect} from 'vitest';
import * as recovery from '../../src/providers/사실재검증.js';
import {createMockSnapshot,MOCK_IDS as I} from '../../src/shared/모의자료.js';
import type {FactProposalDraft} from '../../src/shared/포트.js';
export function fixture(){
 const snapshot=createMockSnapshot('storyboard'),card=snapshot.storyboard!.cards[0],orphan={...card,cardId:'22222222-2222-4222-8222-222222222222',order:2};snapshot.storyboard!.cards.push(orphan);
 snapshot.claims=[{text:'기존 수치',kind:'uncertain',availability:'released',conditions:[],sourceIds:[I.source]}];
 snapshot.factReview={runId:I.run,baseVersion:snapshot.projectVersion,storyboardVersion:1,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[card.cardId,orphan.cardId],state:'pending',readyVersion:null,proposal:null};
 const source={...snapshot.sources[0],sourceId:'11111111-1111-4111-8111-111111111111',evidence:'확인 수치 10',access:'opened' as const,accessedAt:'2026-10-27T00:00:00Z'};
 const draft:FactProposalDraft={kind:'factReview',sources:[source],findings:[{claimIndex:0,cardIds:[card.cardId],classification:'factual_error',reason:'합성 정정',afterClaim:{...snapshot.claims[0],text:'확인 수치 10',sourceIds:[source.sourceId],kind:'verified'},comparisons:[]}],cards:[card,orphan].map(c=>({cardId:c.cardId,title:c.title,body:'확인 수치 10',sourceIds:[source.sourceId]}))};
 const receipts=[recovery.captureFetchReceipt('f1',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,source.accessedAt)];
 return {snapshot,draft,receipts,orphan};
}
it('strict orphan 실패를 보존하며 다른 검사를 모두 통과한 누락만 진단한다',()=>{
 const {snapshot,draft,receipts,orphan}=fixture();
 expect(()=>recovery.validateFactReview(draft,snapshot,receipts)).toThrow(expect.objectContaining({code:'FACT_SCOPE_INVALID'}));
 expect(typeof (recovery as any).prepareFactCheckpoint).toBe('function');
 const checkpoint=(recovery as any).prepareFactCheckpoint(draft,snapshot,receipts);
 expect(checkpoint).toMatchObject({step:'links',draft,receipts,issues:[{code:'FACT_CARD_LINK_MISSING',cardIds:[orphan.cardId]}]});
 const bad=structuredClone(draft);bad.findings[0].afterClaim.sourceIds=['22222222-2222-4222-8222-222222222222'];
 expect(()=>(recovery as any).prepareFactCheckpoint(bad,snapshot,receipts)).toThrow(expect.objectContaining({code:'FACT_SCOPE_INVALID'}));
});
it('보완은 orphan의 기존 판정 연결 추가만 허용하며 strict 재검증한다',()=>{
 const {snapshot,draft,receipts,orphan}=fixture(),before=structuredClone(draft);
 expect(typeof (recovery as any).applyFactLinkRepair).toBe('function');
 const apply=(decision:unknown)=>(recovery as any).applyFactLinkRepair(snapshot,draft,receipts,decision);
 const decision={status:'repaired',links:[{claimIndex:0,cardIds:[orphan.cardId]}],reason:'같은 원고/주장 연결'};
 const out=apply(decision);expect(out.findings[0].cardIds).toEqual([...draft.findings[0].cardIds,orphan.cardId]);expect(out.cards).toEqual(draft.cards);expect(out.sources).toEqual(draft.sources);expect(draft).toEqual(before);
 for(const links of [[{claimIndex:0,cardIds:[draft.cards[0].cardId]}],[{claimIndex:99,cardIds:[orphan.cardId]}],[{claimIndex:0,cardIds:[orphan.cardId,orphan.cardId]}],[]])expect(()=>apply({...decision,links})).toThrow(expect.objectContaining({code:'FACT_SCOPE_INVALID'}));
 expect(()=>apply({status:'unresolvable',links:[],reason:'의미를 확정할 수 없음'})).toThrow(expect.objectContaining({code:'FACT_SCOPE_INVALID'}));
 // '다른 주장' 반례는 worker/부분복구의 전체 발행 semantic transport 검증으로 이전했습니다.
});
