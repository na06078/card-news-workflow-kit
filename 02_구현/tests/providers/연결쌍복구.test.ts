import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {applyFactLinkRepair,captureFetchReceipt,prepareFactCheckpoint} from '../../src/providers/사실재검증.js';
import type * as C from '../../src/shared/포트.js';
export function many(){
 const snapshot=createMockSnapshot('storyboard'),base=snapshot.storyboard!.cards[0];
 const cards=Array.from({length:6},(_,i)=>({...base,cardId:randomUUID(),order:i+1}));snapshot.storyboard!.cards=cards;
 snapshot.claims=Array.from({length:7},(_,i)=>({...snapshot.claims[0],text:`합성 주장 ${i}`,kind:'uncertain' as const,availability:'unknown' as const,conditions:[],sourceIds:[snapshot.sources[0].sourceId]}));
 snapshot.factReview={runId:randomUUID(),baseVersion:snapshot.projectVersion,storyboardVersion:snapshot.storyboard!.version,resultVersion:null,contentHash:'0'.repeat(64),claimIndices:[0,1,2,3,4,5,6],cardIds:cards.map(c=>c.cardId),state:'pending',readyVersion:null,proposal:null};
 const source={...snapshot.sources[0],sourceId:randomUUID(),evidence:'합성 확인 문장',access:'opened' as const,accessedAt:'2026-10-28T00:00:00Z'};
 const draft:C.FactProposalDraft={kind:'factReview',sources:[source],cards:cards.map(c=>({cardId:c.cardId,title:c.title,body:source.evidence,sourceIds:[source.sourceId]})),findings:snapshot.claims.map((claim,i)=>({claimIndex:i,cardIds:cards.slice(2,5).map(c=>c.cardId),classification:'factual_error',reason:'합성',afterClaim:{...claim,text:source.evidence,kind:'verified',sourceIds:[source.sourceId]},comparisons:[]}))};
 const receipts=[captureFetchReceipt('synthetic',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,source.accessedAt)];
 const decision:C.FactLinkRepairDecision={status:'repaired',reason:'private 합성 응답',links:[{claimIndex:4,cardIds:[cards[0].cardId,cards[5].cardId]},{claimIndex:5,cardIds:[cards[1].cardId]},{claimIndex:0,cardIds:[cards[5].cardId]},{claimIndex:3,cardIds:[cards[5].cardId]}]};
 return {snapshot,draft,receipts,decision,cards};
}
test('6카드7주장의 저장 응답과 같은 다대다 연결을 변형 없이 병합한다',()=>{
 const {snapshot,draft,receipts,decision}=many(),before=structuredClone(draft);
 expect(prepareFactCheckpoint(draft,snapshot,receipts).issues).toHaveLength(3);
 const out=applyFactLinkRepair(snapshot,draft,receipts,decision);
 for(const f of out.findings)expect(f.cardIds).toEqual([...draft.findings[f.claimIndex].cardIds,...decision.links.filter(l=>l.claimIndex===f.claimIndex).flatMap(l=>l.cardIds)]);
 expect(out.cards).toEqual(draft.cards);expect(out.sources).toEqual(draft.sources);expect(draft).toEqual(before);
});
test.each(['duplicate','same-row','unknown-claim','unknown-card','nonorphan','missing','unknown-source','receipt'])('다대다 반례 %s를 정확한 strict 경계에서 거절한다',mode=>{
 const {snapshot,draft,receipts,decision,cards}=many();
 if(mode==='duplicate')decision.links.push(structuredClone(decision.links[0]));
 if(mode==='same-row')decision.links[0].cardIds.push(cards[0].cardId);
 if(mode==='unknown-claim')decision.links[0].claimIndex=99;
 if(mode==='unknown-card')decision.links[0].cardIds[0]=randomUUID();
 if(mode==='nonorphan')decision.links[0].cardIds[0]=cards[2].cardId;
 if(mode==='missing')decision.links.splice(1,1);
 if(mode==='unknown-source')draft.findings[0].afterClaim.sourceIds=[randomUUID()];
 if(mode==='receipt')receipts[0].result='다른 처리 결과';
 expect(()=>applyFactLinkRepair(snapshot,draft,receipts,decision)).toThrow(expect.objectContaining({code:mode==='receipt'?'FACT_REVIEW_FAILED':'FACT_SCOPE_INVALID'}));
});
test('중복 연결쌍은 사용자 선택 대신 앱 소유 사유로 진단한다',()=>{
 const {snapshot,draft,receipts,decision}=many();decision.links.push(structuredClone(decision.links[0]));
 expect(()=>applyFactLinkRepair(snapshot,draft,receipts,decision)).toThrow(expect.objectContaining({reason:'FACT_LINK_PAIR_DUPLICATE'}));
});
test('새 연결의 기존 검증 근거는 제안 카드 참조에만 보충하고 원본·응답·출처는 변경하지 않는다',()=>{
 const {snapshot,draft,receipts,decision,cards}=many();
 const source={...draft.sources[0],sourceId:randomUUID(),url:'https://example.org/second-evidence',evidence:'두 번째 문서의 확인 문장'};
 draft.sources.push(source);draft.findings[0].afterClaim.sourceIds=[source.sourceId];
 for(const c of draft.cards)if(draft.findings[0].cardIds.includes(c.cardId))c.sourceIds.push(source.sourceId);
 receipts.push(captureFetchReceipt('second',source.url,{url:source.url,code:200,codeText:'OK',bytes:100,result:source.evidence,durationMs:1},false,source.accessedAt!));
 const original=structuredClone({snapshot,draft,receipts,decision});
 const out=applyFactLinkRepair(snapshot,draft,receipts,decision);
 expect(out.cards.find(c=>c.cardId===cards[5].cardId)!.sourceIds).toEqual([...draft.cards[5].sourceIds,source.sourceId]);
 for(const c of out.cards)if(c.cardId!==cards[5].cardId)expect(c.sourceIds).toEqual(draft.cards.find(old=>old.cardId===c.cardId)!.sourceIds);
 expect(out.sources).toEqual(draft.sources);expect({snapshot,draft,receipts,decision}).toEqual(original);
});
