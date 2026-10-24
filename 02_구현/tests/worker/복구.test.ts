import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {resolve} from 'node:path';
import {setup,options,enqueueEditorial} from './도움.js';
import {createWorker} from '../../src/worker/작업자.js';
import {convertQuestion} from '../../src/providers/질문변환.js';
for(const delivered of [false,true])test(`답변 ${delivered?'전달 표기 직후':'저장 직후'} 프로세스 소실은 interrupted와 원문/답변 보존, 자동 resume 없음`,async()=>{
 const s=await setup();let time=Date.now();const at=()=>new Date(time).toISOString();
 // 동일 B1 저장소의 clock도 제어해야 lease 만료를 결정적으로 재현합니다.
 await s.store.close();const {createStore}=await import('../../src/backend/저장소.js');s.store=await createStore({dataDir:s.dataDir,dbPath:resolve(s.dataDir,'worker.sqlite'),dataMode:'mock',clock:at});
 try{await enqueueEditorial(s);const job=await s.store.claimJob({ownerId:'dead-worker',now:at(),leaseMs:100,dataMode:'mock'});if(!job)throw Error('claim');
 const q=convertQuestion({questions:[{question:'원문 질문?',header:'독자',options:[{label:'A',description:'a'},{label:'B',description:'b'}],multiSelect:false}]},{runId:job.run.runId,toolUseId:'saved-tool-context',createdAt:at()});
 let fence=(await s.store.saveQuestion(job.fence,q.question,q.mapping)).fence;await s.store.saveSession(fence,'explicit-session',job.context!.cwd);
 expect((await s.store.mutate('answers',{projectId:s.pid},{version:q.question.version,questionId:q.question.questionId,answer:[{itemId:'q0',optionIds:['o0'],text:null}],requestId:randomUUID()})).status).toBe(202);
 const answer=await s.store.readAnswer(fence,q.question.questionId,q.question.version);expect(answer).not.toBeNull();fence=answer!.fence;if(delivered)await s.store.markAnswerDelivered(fence,q.question.questionId,q.question.version);
 time+=200;const o=options(s);let starts=0;o.clock=at;o.createClaudeAdapter=()=>{starts++;throw Error('must not start');};const w=createWorker(o);expect(await w.tick()).toBe(false);expect(starts).toBe(0);let p=await s.store.getProject(s.pid);expect(p.lastRun?.status).toBe('interrupted');expect(p.question?.status).toBe('answered');expect(p.lastRun?.error?.code).toBe('SESSION_RECOVERY_UNVERIFIED');
 await expect(s.store.commit(fence,{type:'failure',error:p.lastRun!.error!,externalOutcome:'known',retryAllowed:true})).rejects.toBeTruthy();
 expect((await s.store.mutate('retry',{projectId:s.pid,runId:job.run.runId},{version:p.projectVersion,requestId:randomUUID()})).status).toBe(409);
 expect((await s.store.mutate('retry',{projectId:s.pid,runId:job.run.runId},{version:p.projectVersion,confirmUnknownOutcome:true,requestId:randomUUID()})).status).toBe(202);await w.tick();p=await s.store.getProject(s.pid);expect(p.lastRun?.error?.code).toBe('SESSION_RECOVERY_UNVERIFIED');expect(starts).toBe(0);await w.dispose();
 const db=new Database(resolve(s.dataDir,'worker.sqlite'),{readonly:true});try{const row=db.prepare('SELECT mapping FROM questions WHERE id=?').get(q.question.questionId) as {mapping:string};expect(JSON.parse(row.mapping).toolUseId).toBe('saved-tool-context');expect(db.prepare('SELECT payload,delivered_attempt FROM answers').get()).toMatchObject({delivered_attempt:delivered?1:null});}finally{db.close();}
 }finally{await s.store.close();}
});
