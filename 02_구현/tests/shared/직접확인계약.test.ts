import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ApproveRequestSchema,ResultVersionSchema} from '../../src/shared/포트.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import * as ports from '../../src/shared/포트.js';
import type {ProjectSnapshot} from '../../src/shared/포트.js';

const approval=()=>({resultVersion:1,approvedAt:'2026-10-27T00:00:00.000Z',contentHash:'a'.repeat(64),warningsAcknowledged:true as const});

test('직접 확인 가능 여부는 AI 의견이 아니라 현재 카드·실행 상태로 판단한다',()=>{
 const can=(ports as unknown as {canManuallyApprove?:(p:ProjectSnapshot)=>boolean}).canManuallyApprove;
 const p=createMockSnapshot('review');p.result!.factsCheck='failed';
 expect(can?.(p)).toBe(true);
 for(const kind of ['active','visual','card','asset','question','stage','approved','worker']){
  const q=structuredClone(p);
  if(kind==='active')q.activeRun={...q.lastRun!,status:'running'};
  if(kind==='visual')q.result!.visualCheck='failed';
  if(kind==='card')q.result!.cards[0]!.state='failed';
  if(kind==='asset')q.result!.cards[0]!.previewAssetId=null;
  if(kind==='question')q.question={questionId:randomUUID(),version:1,runId:null,kind:'editorial',items:[],status:'open',createdAt:'2026-10-27T00:00:00.000Z'};
  if(kind==='stage')q.stage='production';
  if(kind==='approved')q.result!.finalApprovedVersion=q.result!.version;
  if(kind==='worker')q.execution={worker:{state:'unavailable',reason:'WORKER_UNAVAILABLE',checkedAt:null},queue:null};
  expect(can?.(q),kind).toBe(false);
 }
});

test('경고 확인은 final의 명시 true 요청에서만 허용한다',()=>{
 const request={requestId:randomUUID(),version:1,stage:'final',acknowledgeWarnings:true};
 expect(ApproveRequestSchema.safeParse(request).success).toBe(true);
 expect(ApproveRequestSchema.safeParse({...request,stage:'storyboard'}).success).toBe(false);
 expect(ApproveRequestSchema.safeParse({...request,acknowledgeWarnings:false}).success).toBe(false);
 expect(ApproveRequestSchema.safeParse({...request,manualApproval:approval()}).success).toBe(false);
});

test('현재 사용자 확인 기록으로만 AI failed/pending 결과를 승인하며 판정은 보존한다',()=>{
 const p=createMockSnapshot('review'),result=p.result!;
 const approved={...result,cards:result.cards.map(c=>({...c,approvedRevision:c.revision})),factsCheck:'failed',finalApprovedVersion:result.version,manualApproval:approval()};
 expect(ResultVersionSchema.safeParse(approved).success).toBe(true);
 expect(ResultVersionSchema.safeParse({...approved,factsCheck:'pending'}).success).toBe(true);
 expect(approved.factsCheck).toBe('failed');
 const {manualApproval:_manual,...without}=approved;
 expect(ResultVersionSchema.safeParse(without).success).toBe(false);
 expect(ResultVersionSchema.safeParse({...approved,manualApproval:{...approval(),resultVersion:2}}).success).toBe(false);
 expect(ResultVersionSchema.safeParse({...approved,finalApprovedVersion:null}).success).toBe(false);
 expect(ResultVersionSchema.safeParse({...approved,visualCheck:'failed'}).success).toBe(false);
 expect(ResultVersionSchema.safeParse({...approved,manualApproval:{...approval(),contentHash:'invalid'}}).success).toBe(false);
});
