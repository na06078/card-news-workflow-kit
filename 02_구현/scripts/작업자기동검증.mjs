import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';

// 정상 compiled 진입점을 별도 소유 프로세스로 시작합니다. 빈 TEST DB와 손상 health만 사용하며 외부 작업은 만들지 않습니다.
const out=resolve('실행데이터/리뷰보강/실제기동');await mkdir(out,{recursive:true});
const modes=process.argv.includes('--json-only')?['json']:['json','sqlite','clean'],records=[];
for(const mode of modes){
 const data=resolve(out,randomUUID()+'-'+mode);await mkdir(data,{recursive:true});
 if(mode==='json')await writeFile(resolve(data,'작업자상태.json'),'{invalid');
 if(mode==='sqlite')await writeFile(resolve(data,'작업자상태.잠금.sqlite'),'invalid sqlite'.repeat(100));
 const child=fork(resolve('dist/server/worker-main.js'),['--data-dir='+data],{execPath:process.execPath,cwd:process.cwd(),env:{...process.env,CARDNEWS_LIVE_CALLS:'forbidden',TEMP:data,TMP:data,TMPDIR:data},stdio:['ignore','pipe','pipe','ipc']});
 let ready=0,stderrBytes=0,timeout=false,finished=false;child.stdout.resume();child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;});
 child.on('message',m=>{if(m?.type==='ready'){ready++;if(child.connected)child.send({type:'shutdown'});}});
 const timer=setTimeout(()=>{timeout=true;if(!finished)child.kill('SIGKILL');},20000);
 const exit=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>{finished=true;ok({code,signal});});});clearTimeout(timer);
 const db=new Database(resolve(data,'카드뉴스.sqlite'),{readonly:true});let rows;
 try{rows={runs:db.prepare('SELECT count(*) n FROM runs').get().n,invocations:db.prepare('SELECT count(*) n FROM invocations').get().n,projects:db.prepare('SELECT count(*) n FROM projects').get().n};}finally{db.close();}
 const record={mode,pid:child.pid,readyMessages:ready,exit,timeout,stderrBytes,rows};records.push(record);
 await writeFile(resolve(out,'기동검증.json'),JSON.stringify({passed:false,records},null,2));console.log(JSON.stringify(record));
 assert.equal(timeout,false);assert.deepEqual(rows,{runs:0,invocations:0,projects:0});
 if(mode==='clean'){assert.equal(ready,1);assert.equal(exit.code,0);const health=JSON.parse(await readFile(resolve(data,'작업자상태.json'),'utf8'));assert.equal(health.state,'unavailable');}
 else{assert.equal(ready,0,'손상 health에서 ready를 보고하면 안 됩니다.');assert.notEqual(exit.code,0);}
}
await writeFile(resolve(out,'기동검증.json'),JSON.stringify({passed:true,mode:'REAL_COMPILED_WORKER_MAIN_NO_MODEL_CALLS',records},null,2));console.log('COMPILED_WORKER_STARTUP_PASS');
