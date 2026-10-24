import type {Store,LeaseFence,AnswerItem} from '../shared/포트.js';
import {workerError} from './실행단계.js';
type Waiting={store:Store;fence:()=>LeaseFence;adopt:(fence:LeaseFence)=>void;guard:()=>Promise<void>;locked:<T>(fn:()=>Promise<T>)=>Promise<T>;pause:()=>Promise<void>;signal:AbortSignal;workerSignal:AbortSignal;questionId:string;version:number};
/** live resolver는 저장하지 않음. 저장 답변의 새 fence만 채택하고 CAS 전달 권한을 먼저 소비합니다.
 * 전달 직후 사망은 가능하므로 외부 exactly-once 수신 보장이 아니라 시도별 at-most-once 허가입니다. */
export async function waitForStoredAnswer(o:Waiting):Promise<AnswerItem[]>{
 while(!o.signal.aborted&&!o.workerSignal.aborted){
  const answer=await o.locked(async()=>{await o.guard();const saved=await o.store.readAnswer(o.fence(),o.questionId,o.version);if(!saved)return null;o.adopt(saved.fence);await o.guard();o.adopt(await o.store.markAnswerDelivered(o.fence(),o.questionId,o.version));return saved.answer;});
  if(answer)return answer;await o.pause();
 }
 throw workerError('EXTERNAL_OUTCOME_UNKNOWN',o.fence());
}
