import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {beginFactReview} from '../../src/backend/사실복구.js';
import {setup} from './도움.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
test.each([undefined,'high','medium','low'] as const)('검수 %s 접수는 작성 모델과 별개인 agy 선택을 고정한다',effort=>{
 const p=createMockSnapshot('storyboard');p.claims=[{text:'합성',kind:'uncertain',sourceIds:[],availability:'unknown',conditions:[]}];p.claudeModel='author-only';
 const r=beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0].cardId],...(effort?{reviewEffort:effort}:{})},randomUUID());
 expect(r).toHaveProperty('reviewer',{provider:'agy',model:`gemini-3.8-flash-${effort??'high'}`});
});
test.each(['agy','claude'] as const)('저장소 %s 검수 선택은 명시 retry와 작성 모델 변경에도 유지된다',async reviewer=>{
 const {s,target,claim}=await setup('1080x1080',[{text:'합성',kind:'uncertain',sourceIds:[],availability:'unknown',conditions:[]}]);
 try{
  await s.setProjectModel(target.projectId,{requestId:randomUUID(),version:0,model:'claude-original'});
  let p=await s.getProject(target.projectId);
  expect((await s.mutate('factReview',target,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0].cardId],reviewer,reviewEffort:'medium'})).status).toBe(202);
  let j=await claim();const selection={provider:reviewer,model:reviewer==='agy'?'gemini-3.8-flash-medium':'claude-original'};
  expect(j.snapshot.factReview!.reviewer).toEqual(selection);
  await s.commit(j.fence,{type:'failure',error:{code:'FACT_REVIEW_FAILED',message:'합성',retryable:true,nextActions:['reverify_facts'],projectId:target.projectId,runId:j.run.runId,currentVersion:null,details:{}},externalOutcome:'not_started',retryAllowed:true});
  await s.setProjectModel(target.projectId,{requestId:randomUUID(),version:1,model:'claude-next'});
  p=await s.getProject(target.projectId);
  expect((await s.mutate('retry',{...target,runId:j.run.runId},{requestId:randomUUID(),version:p.projectVersion})).status).toBe(202);
  j=await claim();expect(j.snapshot.factReview!.reviewer).toEqual(selection);
 }finally{await s.close();}
});
test('Claude 검수 선택은 접수 당시 작성 모델을 복사한다',()=>{
 const p=createMockSnapshot('storyboard');p.claims=[{text:'합성',kind:'uncertain',sourceIds:[],availability:'unknown',conditions:[]}];p.claudeModel='claude-selected';
 expect(beginFactReview(p,{requestId:randomUUID(),version:p.projectVersion,claimIndices:[0],cardIds:[p.storyboard!.cards[0].cardId],reviewer:'claude'},randomUUID())).toHaveProperty('reviewer',{provider:'claude',model:'claude-selected'});
});
