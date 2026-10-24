import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {createConnectionService,type ConnectionService} from './backend/연결.js';
import {createNativeConnectionRunner} from './backend/연결네이티브.js';
import {hasActiveConnectionRuns} from './backend/연결작업경계.js';
import {fileURLToPath} from 'node:url';
import {createApp} from './backend/앱.js';
import {createStore} from './backend/저장소.js';
import type {Store} from './shared/포트.js';
import type {ProviderService} from './shared/작업공간계약.js';
import {createProviderService} from './backend/제공자상태.js';
import {readProviderMetadata} from './providers/사용량.js';

/** import는 서버/인증/worker를 시작하지 않습니다. store 주입은 명시된 로컬 통합 시험용입니다. */
export async function startServer(options:{dataDir?:string;port?:number;staticDir?:string;store?:Store;connections?:ConnectionService;providers?:ProviderService}={}) {
 const dataDir=resolve(options.dataDir??'실행데이터/앱');
 const store=options.store??await createStore({dataDir,dbPath:resolve(dataDir,'카드뉴스.sqlite'),dataMode:'real'});
 let appRoot=dirname(fileURLToPath(import.meta.url));while(!existsSync(resolve(appRoot,'package.json'))){const parent=dirname(appRoot);if(parent===appRoot)throw Error('APP_ROOT_NOT_FOUND');appRoot=parent;}
 const connections=options.connections??createConnectionService({runner:createNativeConnectionRunner({appRoot,cwd:dataDir}),hasActiveRuns:()=>hasActiveConnectionRuns(resolve(dataDir,'카드뉴스.sqlite'))});
 // 조회 서비스 생성 자체는 외부 통신하지 않습니다. 명시 refresh가 메타데이터만 가져옵니다.
 const providers=options.providers??createProviderService({reader:signal=>readProviderMetadata({appRoot,cwd:dataDir,signal})});
 const hosts=['127.0.0.1:5173'],origins=['http://127.0.0.1:5173'];
 const app=createApp({store,connections,providers,dataDir,allowedHosts:hosts,allowedOrigins:origins,staticDir:options.staticDir??resolve('dist/web')});
 let server:ReturnType<typeof app.listen>;
 try {server=await new Promise((ok,fail)=>{const s=app.listen(options.port??8765,'127.0.0.1',()=>ok(s));s.once('error',fail);});}
 catch(error){if(!options.providers)await providers.dispose();if(!options.connections)await connections.dispose();if(!options.store)await store.close();throw error;}
 const address=server.address();if(!address||typeof address==='string')throw Error('LOOPBACK_ADDRESS_REQUIRED');
 const url=`http://127.0.0.1:${address.port}`;hosts.push(`127.0.0.1:${address.port}`);origins.push(url);
 const runtime={pid:process.pid,node:process.version,startedAt:new Date().toISOString(),url,dataDir,gate:'FRESH_USER_ACTION_ONLY; connection status via /api/connections; no startup generation'};
 let closed=false;
 return {app,store,dataDir,url,runtime,async close(){if(closed)return;closed=true;if(!options.providers)await providers.dispose();if(!options.connections)await connections.dispose();await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()));if(!options.store)await store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dataDir=process.argv.slice(2).find(x=>x.startsWith('--data-dir='))?.slice('--data-dir='.length);
 const host=await startServer({...(dataDir?{dataDir}:{})});console.log(JSON.stringify(host.runtime));
 const close=()=>{void host.close().then(()=>process.disconnect?.()).catch(()=>{console.error('SERVER_CLOSE_FAILED');process.exitCode=1;});};
 process.on('SIGINT',close);process.on('SIGTERM',close);process.on('message',m=>{if(m&&typeof m==='object'&&'type'in m&&m.type==='shutdown')close();});
 process.send?.({type:'ready',...host.runtime});
}
