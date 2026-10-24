import {createServer} from 'vite';
import {fork} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(process.version!=='v24.22.1')throw Error('프로젝트 전용 Node24.22.1로 실행해 주세요.');
for(const file of ['dist/server/server-main.js','dist/server/worker-main.js'])if(!existsSync(file))throw Error('먼저 npm run build를 실행해 주세요.');
const dataDir=resolve(process.argv.slice(2).find(x=>x.startsWith('--data-dir='))?.slice('--data-dir='.length)??'실행데이터/앱');
const children=[];let vite,closing;
async function close(){if(closing)return closing;closing=(async()=>{await vite?.close();for(const item of [...children].reverse()){if(item.child.connected)item.child.send({type:'shutdown'});const code=await item.exit;if(code!==0)process.exitCode=1;}process.disconnect?.();})();return closing;}
const shutdown=()=>{void close().catch(()=>{console.error('LOCAL_SHUTDOWN_FAILED');process.exitCode=1;});};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('message',m=>{if(m&&typeof m==='object'&&m.type==='shutdown')shutdown();});process.on('disconnect',shutdown);
async function start(file){
 const child=fork(resolve(file),[`--data-dir=${dataDir}`],{execPath:process.execPath,stdio:['ignore','inherit','inherit','ipc']});
 const exit=new Promise(ok=>child.once('exit',ok));children.push({child,exit});
 return new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('LOCAL_CHILD_READY_TIMEOUT')),15000);child.once('error',fail);child.once('exit',()=>{clearTimeout(timer);fail(Error('LOCAL_CHILD_EXIT_BEFORE_READY'));if(!closing){process.exitCode=1;shutdown();}});child.on('message',m=>{if(m?.type==='ready'){clearTimeout(timer);ok(m);}});});
}
try{
 const http=await start('dist/server/server-main.js');const worker=await start('dist/server/worker-main.js');
 vite=await createServer({cacheDir:resolve(dataDir,'vite-cache'),server:{host:'127.0.0.1',port:5173,strictPort:true,watch:{ignored:['**/실행데이터/**','**/.도구/**','**/.브라우저/**']}}});await vite.listen();
 const build={};for(const file of ['dist/server/worker-main.js','dist/server/providers/클로드.js','dist/server/providers/구독검증.js','dist/server/providers/agy.js','dist/server/providers/프로세스격리.js'])build[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 const record={type:'ready',components:['http','worker','vite'],pid:process.pid,executable:process.execPath,startedAt:new Date().toISOString(),url:'http://127.0.0.1:5173',http,worker,dataDir,build,gate:'FRESH_USER_ACTION_ONLY; same-child subscription barrier; no SDK/auth/search/agy startup calls'};
 await mkdir(resolve('실행데이터/연결준비'),{recursive:true});await writeFile(resolve('실행데이터/연결준비/사용자앱런타임.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));process.send?.(record);
}catch(error){console.error(error instanceof Error?error.message:'LOCAL_START_FAILED');process.exitCode=1;await close();}

