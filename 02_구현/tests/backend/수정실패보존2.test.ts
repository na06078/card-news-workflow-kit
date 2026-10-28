import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {review} from './도움.js';
test('적용 전 기술 실패는 기존 ready 편집과 명시 retry를 함께 보존한다',async()=>{
 const x=await review('실행데이터/카드수정복구/서버/적용전실패');
 try{
  const before=await x.s.getProject(x.target.projectId),card=before.result!.cards[0];
  await x.s.mutate('revisions',x.target,{requestId:randomUUID(),version:before.result!.version,scope:'layout',cardIds:[card.cardId],instruction:'가운데 정렬'});
  const job=await x.claim();await x.s.commit(job.fence,{type:'failure',error:{code:'PROVIDER_PROTOCOL_ERROR',message:'검증용 형식 실패',retryable:true,nextActions:['retry'],projectId:x.target.projectId,runId:job.run.runId,currentVersion:job.fence.baseProjectVersion,details:{}},externalOutcome:'known',retryAllowed:true});
  const after=await x.s.getProject(x.target.projectId);
  expect(after.result).toEqual(before.result);expect(after.stage).toBe(before.stage);expect(after.status).toBe(before.status);expect(after.allowedActions).toContain('revise');expect(after.allowedActions).toContain('retry');expect(after.lastRun!.status).toBe('failed');
 }finally{await x.s.close();}
});
