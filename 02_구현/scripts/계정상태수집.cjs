'use strict';
// Official statusLine stdin is transient. Never persist raw state/transcripts/tokens.
function accountSnapshot(raw,operationId,timestamp){
 const email=typeof raw.email==='string'&&/^[^\s@\x00-\x1f\x7f]{1,128}@[^\s@\x00-\x1f\x7f]{1,190}\.[^\s@\x00-\x1f\x7f]{1,63}$/.test(raw.email)?raw.email:null;
 return {operationId,timestamp,accountId:email,ready:raw.agent_state==='idle'&&raw.tool_confirmation_pending!==true&&!(raw.pending_input_count>0)&&!(raw.task_count>0)};
}
module.exports={accountSnapshot};
if(require.main===module){
 let text='',size=0;
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size<=262144)text+=chunk;});
 process.stdin.on('end',()=>{
  try{
   if(size>262144)throw Error('oversize');
   const [file,operationId]=process.argv.slice(2);
   if(!file||!/^[-0-9a-f]{36}$/.test(operationId))throw Error('invalid operation');
   if(process.env.CARDNEWS_ACCOUNT_OPERATION!==operationId)throw Error('stale producer');
   const fs=require('node:fs'),path=require('node:path');
   const marker=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'작업표식.json'),'utf8'));
   if(marker.operationId!==operationId||marker.expiresAt<Date.now())throw Error('expired operation');
   const result=accountSnapshot(JSON.parse(text),operationId,Date.now());
   const temporary=file+'.'+process.pid+'.tmp';
   fs.writeFileSync(temporary,JSON.stringify(result),{mode:0o600,flag:'wx'});
   fs.renameSync(temporary,file);
   process.stdout.write(result.ready?'계정 연결 확인 중... 인증 확인 후 자동 종료':'계정 연결 전용: 폴더 신뢰·로그인을 완료해 주세요 (일반 채팅 아님)');
  }catch{process.stdout.write('Account verification unavailable');}
  text='';
 });
}
