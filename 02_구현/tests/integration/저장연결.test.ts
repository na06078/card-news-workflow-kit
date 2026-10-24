import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {startCheckpoint} from './fixtures/I1/호스트.js';

let h:Awaited<ReturnType<typeof startCheckpoint>>;
beforeAll(async()=>{h=await startCheckpoint();},60000);
afterAll(async()=>{await h?.close();},60000);
describe('I1 실제 F1/B1/SQLite 저장 연결 (합성 후보, 공급자 없음)',()=>{
 it('프로젝트 생성·GET·CSRF 경계·생성 원장 재생',async()=>{
  const api=await h.api();const input={topic:'[I1 합성] 생성 경계',createRequestId:crypto.randomUUID()};
  const a=await api.post('/api/projects',input);expect(a.status).toBe(201);
  const b=await api.post('/api/projects',input);expect(b.status).toBe(201);expect(b.body).toEqual(a.body);expect(b.replayed).toBe(true);
  expect((await api.post('/api/projects',{...input,topic:'변경'})).body.error.code).toBe('REQUEST_ID_CONFLICT');
  const id=a.body.data.projectId;const p=await api.client.getProject(id);expect(p.topic).toBe(input.topic);expect(p.activeRun).toBeNull();expect(p.candidates).toEqual([]);
  const denied=await fetch(h.url+'/api/projects',{method:'POST',headers:{Origin:h.url,'Content-Type':'application/json'},body:JSON.stringify({...input,createRequestId:crypto.randomUUID()})});expect(denied.status).toBe(403);
  const foreign=await api.post('/api/projects',{...input,createRequestId:crypto.randomUUID()},{Origin:'https://example.org'});expect(foreign.status).toBe(403);
  h.record('create-security',{projectId:id,status:a.status,replayed:b.replayed,noAutomaticRun:p.activeRun===null});
 });
 it('선택 1·2·3개 저장, 0·4개/교차 후보 거절, 동일 ID 재생·입력 충돌과 프로젝트 격리',async()=>{
  const api=await h.api();const other=await h.seed(api,'격리 상대');
  for(const count of [1,2,3]){
   const p=await h.seed(api,`선택 ${count}`);const path=`/api/projects/${p.projectId}/selection`;
   for(const n of [0,4]){const bad=await api.post(path,{version:p.researchVersion,requestId:crypto.randomUUID(),candidateIds:p.candidates.slice(0,n).map(c=>c.candidateId)});expect(bad.status).toBe(422);}
   const cross=await api.post(path,{version:p.researchVersion,requestId:crypto.randomUUID(),candidateIds:[other.candidates[0]!.candidateId]});expect(cross.status).toBe(422);
   expect((await api.client.getProject(p.projectId)).activeRun).toBeNull();
   const input={version:p.researchVersion,requestId:crypto.randomUUID(),candidateIds:p.candidates.slice(0,count).map(c=>c.candidateId)};
   const [a,b]=await Promise.all([api.post(path,input),api.post(path,input)]);expect(a.status).toBe(202);expect(b.status).toBe(202);expect(a.body).toEqual(b.body);expect([a.replayed,b.replayed].filter(Boolean)).toHaveLength(1);
   const changed=await api.post(path,{...input,candidateIds:[p.candidates[4]!.candidateId]});expect(changed.status).toBe(409);expect(changed.body.error.code).toBe('REQUEST_ID_CONFLICT');
   const saved=await api.client.getProject(p.projectId);expect(saved.selectedCandidateIds).toEqual(input.candidateIds);expect(saved.activeRun?.runId).toBe(a.body.data.runId);expect(saved.activeRun?.kind).toBe('editorial');
   expect((await api.client.getRun(a.body.data.runId)).projectId).toBe(p.projectId);
   expect((await api.client.getProject(other.projectId)).selectedCandidateIds).toEqual([]);
   h.record('selection-replay',{count,projectId:p.projectId,runId:saved.activeRun?.runId,selected:saved.selectedCandidateIds,replayed:[a.replayed,b.replayed],changedStatus:changed.status});
  }
 });
 it('실제 Chromium App 생성·후보 1~3 제한·선택·새로고침·오래된 화면 충돌',async()=>{await h.browserCheckpoint();},90000);
 it('Express/Store 재생성 후 동일 SQLite에서 선택·작업·응답 원장 및 브라우저 복원',async()=>{await h.restartCheckpoint();},60000);
});
