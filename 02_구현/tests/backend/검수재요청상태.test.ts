import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setup} from './도움.js';
import {draft,reviewed} from './의미검수대역.js';
it('실패 뒤 새 검수 접수는 working, 제안 저장 뒤에는 ready로 복구하고 원고는 보존한다',async()=>{
 const h=await setup('1080x1080',[{text:'합성 주장',kind:'uncertain',sourceIds:[],availability:'unknown',conditions:[]}]);
 try{
  const before=await h.s.getProject(h.target.projectId),content={storyboard:before.storyboard,claims:before.claims,sources:before.sources};
  await h.s.mutate('factReview',h.target,{requestId:randomUUID(),version:before.projectVersion,claimIndices:[0],cardIds:[before.storyboard!.cards[0]!.cardId]});
  const failed=await h.s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!failed)throw Error('TEST_JOB_REQUIRED');
  await h.s.commit(failed.fence,{type:'failure',externalOutcome:'unknown',retryAllowed:false,error:{code:'REVIEW_TIMEOUT',message:'합성 검수 시간 초과',retryable:false,nextActions:['reverify_facts'],projectId:before.projectId,runId:failed.run.runId,currentVersion:failed.fence.baseProjectVersion,details:{reason:'REVIEW_TIMEOUT'}}});
  let p=await h.s.getProject(before.projectId);expect(p.status).toBe('error');
  await h.s.mutate('factReview',h.target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0]!.cardId]});
  p=await h.s.getProject(before.projectId);expect(p.status).toBe('working');
  const next=await h.s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!next)throw Error('TEST_REVIEW_JOB_REQUIRED');
  await h.s.commit(next.fence,{type:'content',content:reviewed(next.snapshot,draft(next.snapshot))});
  p=await h.s.getProject(before.projectId);expect(p.status).toBe('ready');expect(p.factReview!.state).toBe('ready');expect(p.activeRun).toBeNull();expect({storyboard:p.storyboard,claims:p.claims,sources:p.sources}).toEqual(content);
 }finally{await h.s.close();}
});
