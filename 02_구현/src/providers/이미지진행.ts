import {resolve} from 'node:path';
import type {AgyProgressCallback} from '../shared/포트.js';
import {ProviderFailure} from './오류.js';
/** https://antigravity.google/docs/cli/headless: step state는 ACTIVE/DONE (result RUNNING과 다름). 원문 중계 금지. */
export function imageProgress(cwd:string,emit:AgyProgressCallback,signal:AbortSignal){
 let pending='',cid:string|undefined,ended=false,error:unknown,queue=Promise.resolve();
 const seen=new Set<string>();
 const frame=(line:string)=>{
  if(!line.trim())return;
  const e=JSON.parse(line);
  if(!e||typeof e!=='object'||ended)throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');
  if(!cid){
   const actual=e.init?.cwd;
   const same=typeof actual==='string'&&(process.platform==='win32'?resolve(actual).toLowerCase()===cwd.toLowerCase():resolve(actual)===cwd);
   if(e.event!=='init'||typeof e.conversation_id!=='string'||!same)throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');
   cid=e.conversation_id;return;
  }
  if(e.event==='init')throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');
  if(e.event==='result'){ended=true;return;}
  const s=e.step_update;
  if(e.event!=='step_update'||s?.step_type!=='tool'||(s.tool_name??s.tool_info?.name)!=='generate_image')return;
  if(s.conversation_id!==undefined&&s.conversation_id!==cid)throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');
  if(!Number.isInteger(s.step_index)||s.step_index<0)return;
  const status=s.tool_info?.error?'failed':s.state==='ACTIVE'?'started':s.state==='DONE'?'completed':undefined;
  if(!status)return;
  const key=`${s.step_index}:${status}`;if(seen.has(key))return;seen.add(key);
  queue=queue.then(async()=>{if(!signal.aborted&&!error)await emit({phase:'image',message:`그림 도구 ${status==='started'?'시작':status==='completed'?'완료':'실패'}`,status});}).catch(e=>{error=e;});
 };
 return {
  push(text:string){if(error||signal.aborted)return;try{pending+=text;if(pending.length>2*1024*1024)throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);frame(line);}}catch(e){error=e;}},
  async finish(){if(pending.trim()&&!error)try{frame(pending);}catch(e){error=e;}await queue;if(error)throw new ProviderFailure('PROVIDER_PROTOCOL_ERROR');}
 };
}
