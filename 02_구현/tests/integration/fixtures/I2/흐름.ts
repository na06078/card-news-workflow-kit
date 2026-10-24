import {randomUUID} from 'node:crypto';
import type {startLocal} from './호스트.js';
export async function prepareBoard(h:Awaited<ReturnType<typeof startLocal>>){
 const a=await h.api();let p=await h.seed(a);const id=p.projectId;
 await a.client.mutate('selection',{projectId:id},{candidateIds:[p.candidates[0].candidateId],version:p.researchVersion,requestId:randomUUID()});const task=h.worker.tick();p=await h.waitFor(id,p=>p.question?.status==='open');
 await a.client.mutate('answers',{projectId:id},{questionId:p.question!.questionId,version:p.question!.version,answer:[{itemId:'audience',optionIds:[],text:'I2 합성 자유 답변'}],requestId:randomUUID()});await task;return {a,p:await a.client.getProject(id)};
}
