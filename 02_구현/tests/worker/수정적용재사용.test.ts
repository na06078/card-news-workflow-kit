import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {ClaimedJob} from '../../src/shared/포트.js';
import {canReusePersistedRevision} from '../../src/worker/복구.js';
function job(){const snapshot=createMockSnapshot('review'),card=snapshot.result!.cards[0];return {snapshot,run:{...snapshot.lastRun!,kind:'revision',attempt:2,revisionProtocol:2},revision:{requestId:snapshot.projectId,version:snapshot.result!.version,scope:'text',cardIds:[card.cardId],instruction:'원래 지시'}} as ClaimedJob;}
test('v2 READY만으로 적용되었다고 추정하지 않는다',()=>{expect(canReusePersistedRevision(job())).toBe(false);});
test('혼합 선택의 실제 적용 부분집합은 재추론 없이 재사용한다',()=>{
 const j=job(),first=j.snapshot.result!.cards[0],unchanged={...structuredClone(first),cardId:randomUUID(),order:2,approvedRevision:first.revision};
 j.snapshot.result!.cards.push(unchanged);j.revision!.cardIds=[first.cardId,unchanged.cardId];
 j.run.revisionApplied={resultVersion:j.snapshot.result!.version,cardRevisions:[{cardId:first.cardId,revision:first.revision}]};
 expect(canReusePersistedRevision(j)).toBe(true);
 j.run.attempt=1;expect(canReusePersistedRevision(j)).toBe(false);
 j.run.attempt=2;j.revision!.cardIds.push(first.cardId);expect(canReusePersistedRevision(j)).toBe(false);
});
test('v2 실제 적용 marker의 결과/개정/선택 exact 일치만 재사용',()=>{const j=job(),card=j.snapshot.result!.cards[0];j.run.revisionApplied={resultVersion:j.snapshot.result!.version,cardRevisions:[{cardId:card.cardId,revision:card.revision}]};expect(canReusePersistedRevision(j)).toBe(true);j.run.revisionApplied.resultVersion++;expect(canReusePersistedRevision(j)).toBe(false);j.run.revisionApplied.resultVersion--;j.run.revisionApplied.cardRevisions[0].revision++;expect(canReusePersistedRevision(j)).toBe(false);j.run.revisionApplied.cardRevisions[0].revision--;j.run.revisionApplied.cardRevisions.push({cardId:j.snapshot.result!.cards[1]?.cardId??j.snapshot.projectId,revision:1});expect(canReusePersistedRevision(j)).toBe(false);});
