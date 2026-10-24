import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {startLocal} from './fixtures/I2/호스트.js';
import {prepareBoard} from './fixtures/I2/흐름.js';
import {interruptPending} from './fixtures/I2/중단.js';

test('lease 소실 질문/답변은 interrupted로 보존하고 pending 세션 자동 resume를 막는다',async()=>{
 const h=await startLocal();try{const {a,id,job,q,fence}=await interruptPending(h);let p=await a.client.getProject(id);expect(p.lastRun?.status).toBe('interrupted');expect(p.lastRun?.error?.code).toBe('SESSION_RECOVERY_UNVERIFIED');expect(p.question?.status).toBe('answered');const calls=h.calls.syntheticClaude;expect(await h.worker.tick()).toBe(false);expect(h.calls.syntheticClaude).toBe(calls);
 await expect(h.store.commit(fence,{type:'failure',error:p.lastRun!.error!,externalOutcome:'known',retryAllowed:true})).rejects.toBeTruthy();expect((await a.post(`/api/runs/${job.run.runId}/retry`,{version:p.projectVersion,requestId:randomUUID()})).status).toBe(409);await a.client.mutate('retry',{projectId:id,runId:job.run.runId},{version:p.projectVersion,confirmUnknownOutcome:true,requestId:randomUUID()});await h.worker.tick();p=await a.client.getProject(id);expect(p.lastRun?.error?.code).toBe('SESSION_RECOVERY_UNVERIFIED');expect(h.calls.syntheticClaude).toBe(calls);h.record('lost-worker',{projectId:id,questionId:q.question.questionId,answeredPreserved:true,automaticResume:false,staleCommitRejected:true,scope:'explicit future clock reconcile; not OS kill'});
 }finally{await h.close();}
});

test('두 프로젝트의 합성 세션과 실제 HTTP 답변이 서로 섞이지 않는다',async()=>{
 const h=await startLocal();try{const one=await prepareBoard(h),two=await prepareBoard(h);expect(one.p.projectId).not.toBe(two.p.projectId);expect(one.p.storyboard!.cards[0].cardId).not.toBe(two.p.storyboard!.cards[0].cardId);expect(h.calls.answers.map(x=>x.projectId)).toEqual([one.p.projectId,two.p.projectId]);const cross=await two.a.post(`/api/projects/${two.p.projectId}/answers`,{questionId:one.p.question!.questionId,version:1,answer:[{itemId:'audience',optionIds:['public'],text:null}],requestId:randomUUID()});expect(cross.status).toBe(409);expect(await two.a.client.getProject(one.p.projectId)).toEqual(one.p);h.record('two-projects',{ids:[one.p.projectId,two.p.projectId],answerProjects:h.calls.answers.map(x=>x.projectId),sessionMode:'explicit I2-SYNTHETIC-project UUID, never latest',crossQuestion:409});}finally{await h.close();}
});

test('실제 HTTP 승인 버전·격리·중복과 합성 이미지 실패 후 대상만 복구',async()=>{
 const h=await startLocal();try{
  const {a,p}=await prepareBoard(h),id=p.projectId;expect(p.storyboard!.audience).toBe('I2 합성 자유 답변');expect(h.calls.syntheticImage).toBe(0);
  const foreign=await a.client.createProject({topic:'[I2 합성] 독립 프로젝트',createRequestId:randomUUID()});const foreignBefore=await a.client.getProject(foreign.projectId);
  const stale=await a.post(`/api/projects/${id}/approve`,{stage:'storyboard',version:99,requestId:randomUUID()});expect(stale.status).toBe(409);expect(h.calls.syntheticImage).toBe(0);
  const input={stage:'storyboard',version:p.storyboard!.version,requestId:randomUUID()};const pair=await Promise.all([a.post(`/api/projects/${id}/approve`,input),a.post(`/api/projects/${id}/approve`,input)]);expect(pair.map(x=>x.status)).toEqual([202,202]);expect(pair[0].body).toEqual(pair[1].body);expect(pair.filter(x=>x.replayed)).toHaveLength(1);
  const conflict=await a.post(`/api/projects/${id}/approve`,{...input,version:2});expect(conflict.status).toBe(409);expect(conflict.body.error.code).toBe('REQUEST_ID_CONFLICT');
  h.controls.imageFailOnce=true;await h.worker.tick();let q=await a.client.getProject(id);expect(q.lastRun?.error?.code).toBe('IMAGE_GENERATION_FAILED');const ready=q.result!.cards.find(c=>c.state==='ready')!;expect(ready).toBeTruthy();const failed=q.result!.cards.find(c=>c.state==='failed')!;const count=h.calls.syntheticImage;
  expect((await a.post(`/api/runs/${q.lastRun!.runId}/retry`,{version:q.projectVersion,requestId:randomUUID()})).status).toBe(409);
  await a.client.mutate('retry',{projectId:id,runId:q.lastRun!.runId},{version:q.projectVersion,confirmUnknownOutcome:true,requestId:randomUUID()});await h.restartWorker();await h.worker.tick();q=await a.client.getProject(id);expect(q.lastRun?.status).toBe('succeeded');expect(h.calls.syntheticImage-count).toBe(1);expect(q.result!.cards.find(c=>c.cardId===ready.cardId)).toEqual(ready);expect(q.result!.cards.find(c=>c.cardId===failed.cardId)?.state).toBe('ready');
  const wrong=await a.get(`/api/projects/${foreign.projectId}/assets/${ready.previewAssetId}`);expect(wrong.status).toBe(404);expect(await a.client.getProject(foreign.projectId)).toEqual(foreignBefore);
  expect((await a.post(`/api/projects/${id}/approve`,{stage:'final',version:99,requestId:randomUUID()})).status).toBe(409);
  h.record('failure-recovery',{projectId:id,foreignProjectId:foreign.projectId,imageCalls:h.calls.syntheticImage,failedCard:failed.cardId,readyRetained:ready.cardId,replayed:true,conflict:409,foreignAsset:404,workerRestart:'same-process new Worker object',actualLiveCalls:0});
 }finally{await h.close();}
},30000);

for(const code of ['SEARCH_TOOL_UNAVAILABLE','LOGIN_REQUIRED','AUTH_PATH_FORBIDDEN','AUTH_MODE_UNKNOWN'])test(`합성 ${code}는 실제 worker/HTTP 원장에 오류로 남고 fallback하지 않음`,async()=>{
 const h=await startLocal();try{const a=await h.api();h.controls.error=code;const p=await h.seed(a);expect(p.lastRun?.error?.code).toBe(code);expect(p.candidates).toEqual([]);expect(h.calls.syntheticClaude).toBe(1);expect(h.calls.syntheticImage).toBe(0);expect(h.calls.sdkQuery+h.calls.auth+h.calls.agySpawn).toBe(0);h.record('injected-error',{code,nextActions:p.lastRun!.error!.nextActions,notRealProviderError:true});}finally{await h.close();}
});

test('실제 HTTP 질문 대기 취소는 테스트 callback을 정리하고 답변을 거절한다',async()=>{
 const h=await startLocal();try{const a=await h.api(),p=await h.seed(a),id=p.projectId;await a.client.mutate('selection',{projectId:id},{candidateIds:[p.candidates[0].candidateId],version:1,requestId:randomUUID()});const tick=h.worker.tick();const waiting=await h.waitFor(id,q=>q.question?.status==='open');await a.client.mutate('cancel',{projectId:id,runId:waiting.activeRun!.runId},{requestId:randomUUID()});await tick;const canceled=await a.client.getProject(id);expect(canceled.lastRun?.status).toBe('canceled');expect(h.calls.answers).toEqual([]);const reply=await a.post(`/api/projects/${id}/answers`,{questionId:waiting.question!.questionId,version:1,answer:[{itemId:'audience',optionIds:['public'],text:null}],requestId:randomUUID()});expect(reply.status).toBe(409);h.record('cancel',{status:canceled.lastRun?.status,callbackReceived:0,cleanup:'synthetic adapter confirmed; no external child existed'});}finally{await h.close();}
});
