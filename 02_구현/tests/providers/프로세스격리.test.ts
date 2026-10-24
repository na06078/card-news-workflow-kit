import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stripTypeScriptTypes} from 'node:module';
it('Windows 소유 Node만 Job에 격리하고 후손 소멸을 실제 OS membership으로 확인',async()=>{
 const data=resolve('실행데이터/연결준비/격리시험');await mkdir(data,{recursive:true});
 let source='';try{source=await readFile(resolve('src/providers/프로세스격리.ts'),'utf8');}catch{}
 expect(source,'실제 프로세스 격리 구현이 있어야 함').not.toBe('');
 await writeFile(resolve(data,'격리.mjs'),stripTypeScriptTypes(source));
 await writeFile(resolve(data,'후손.mjs'),'setTimeout(()=>{},1200);');
 await writeFile(resolve(data,'중간.mjs'),`import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';spawn(process.execPath,[fileURLToPath(new URL('./후손.mjs',import.meta.url))],{stdio:'ignore',windowsHide:true}).unref();setTimeout(()=>{},500);`);
 await writeFile(resolve(data,'자식.mjs'),`import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {initializeOwnedScope,ownedDescendantsExited,closeOwnedScope} from './격리.mjs';
await initializeOwnedScope();const before=await ownedDescendantsExited();
const child=spawn(process.execPath,[fileURLToPath(new URL('./중간.mjs',import.meta.url))],{stdio:'ignore',windowsHide:true});const closed=new Promise(r=>child.once('close',r));
await new Promise(r=>setTimeout(r,150));const nestedDuring=await ownedDescendantsExited();await closed;const exitCode=child.exitCode;
let after=false;for(let i=0;i<50&&!after;i++){after=await ownedDescendantsExited();if(!after)await new Promise(r=>setTimeout(r,100));}
await closeOwnedScope();console.log(JSON.stringify({before,nestedDuring,after,exitCode,parentAlive:true}));`);
 const out=await promisify(execFile)(process.execPath,[resolve(data,'자식.mjs')],{cwd:process.cwd(),env:{...process.env,TEMP:data,TMP:data},timeout:25000,windowsHide:true});
 expect(JSON.parse(out.stdout)).toEqual({before:true,nestedDuring:false,after:true,exitCode:0,parentAlive:true});
},30000);
