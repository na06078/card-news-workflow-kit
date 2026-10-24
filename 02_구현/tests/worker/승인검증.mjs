import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const cwd=process.cwd(),data=resolve('실행데이터/W1');mkdirSync(join(data,'임시'),{recursive:true});
const node=resolve('.도구/node-v24.22.1-win-x64/node.exe');
const env={...process.env,CARDNEWS_LIVE_CALLS:'forbidden',PLAYWRIGHT_BROWSERS_PATH:resolve('.브라우저'),TEMP:join(data,'임시'),TMP:join(data,'임시'),TMPDIR:join(data,'임시'),npm_config_userconfig:resolve('.도구/npmrc'),npm_config_globalconfig:resolve('.도구/global-npmrc'),npm_config_cache:join(data,'npm-cache')};
const commands=[['worker',['scripts/오프라인검증.mjs','worker','--configLoader','native','--reporter=json','--outputFile=실행데이터/W1/승인최종-worker.json']],['영향회귀',['node_modules/vitest/vitest.mjs','run','tests/shared','tests/providers','tests/render/배치.test.ts','--configLoader','native','--reporter=json','--outputFile=실행데이터/W1/승인최종-영향회귀.json']],['typecheck',['node_modules/typescript/bin/tsc','--noEmit','-p','tests/worker/tsconfig.json']]];
const results=[];for(const [name,args] of commands){const start=new Date().toISOString(),r=spawnSync(node,args,{cwd,env,shell:false,encoding:'utf8',timeout:180000});const log=join(data,`승인최종-${name}.log`);writeFileSync(log,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));let tests=null;if(name!=='typecheck'){try{const d=JSON.parse(readFileSync(join(data,`승인최종-${name}.json`),'utf8'));tests={passed:d.numPassedTests,failed:d.numFailedTests,skipped:d.numPendingTests,total:d.numTotalTests,success:d.success};}catch{}}
 results.push({name,command:[node,...args],cwd,start,end:new Date().toISOString(),exit:r.status,signal:r.signal,log,tests});writeFileSync(join(data,'승인최종-명령결과.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));}
process.exitCode=results.every(x=>x.exit===0)?0:1;
