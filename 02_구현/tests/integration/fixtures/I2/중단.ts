import {convertQuestion} from '../../../../src/providers/질문변환.js';
import type {startLocal} from './호스트.js';
import {randomUUID} from 'node:crypto';
export async function interruptPending(h:Awaited<ReturnType<typeof startLocal>>){
 const a=await h.api(),p=await h.seed(a),id=p.projectId;await a.client.mutate('selection',{projectId:id},{candidateIds:[p.candidates[0].candidateId],version:1,requestId:randomUUID()});
 const job=await h.store.claimJob({ownerId:'I2-SIMULATED-LOST-WORKER',now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!job)throw Error('claim');
 const q=convertQuestion({questions:[{question:'I2 합성 중단 질문?',header:'독자',options:[{label:'A',description:'합성 A'},{label:'B',description:'합성 B'}],multiSelect:false}]},{runId:job.run.runId,toolUseId:'I2-SYNTHETIC-SAVED-TOOL',createdAt:new Date().toISOString()});
 const saved=await h.store.saveQuestion(job.fence,q.question,q.mapping);await h.store.saveSession(saved.fence,'I2-SYNTHETIC-SAVED-SESSION-'+id,job.context!.cwd);
 await a.client.mutate('answers',{projectId:id},{questionId:q.question.questionId,version:1,answer:[{itemId:'q0',optionIds:['o0'],text:null}],requestId:randomUUID()});
 await h.store.reconcile({now:new Date(Date.now()+60000).toISOString()});return {a,id,job,q,fence:saved.fence};
}
