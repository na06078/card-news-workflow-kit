import {existsSync,readFileSync} from 'node:fs';
import {lstat,realpath,readFile,mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,dirname,parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import type {AppError,ErrorCode} from '../shared/포트.js';
function locateAppRoot():string {
 let current=dirname(fileURLToPath(import.meta.url));
 while(true){
  const manifest=join(current,'package.json');
  if(existsSync(manifest)){
   if(JSON.parse(readFileSync(manifest,'utf8')).name!=='card-news-workflow-local')throw new Error('카드뉴스 APP 경계를 찾지 못했습니다.');
   return current;
  }
  const parent=dirname(current);if(parent===current)throw new Error('APP package.json 없음');current=parent;
 }
}
export const appRoot=locateAppRoot();
export const dataRoot=join(appRoot,'실행데이터');
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export class RenderFailure extends Error {
 readonly error:AppError;
 constructor(code:ErrorCode,reason:string,context:{projectId:string;runId:string;resultVersion?:number},reasonCode?:string){
  super(reason);this.name='RenderFailure';this.error={code,message:reason,retryable:['RENDER_FAILED','EXPORT_FAILED'].includes(code),nextActions:code==='FINAL_NOT_APPROVED'?['approve_final']:['revise'],projectId:context.projectId,runId:context.runId,currentVersion:context.resultVersion??null,details:{reason:reasonCode??code}};
 }
}
function within(root:string,path:string){const r=relative(root,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r));}
/** 호출자는 신뢰된 worker입니다. HTTP에 공개하지 않고 각 상위 경로의 junction/symlink를 거절합니다. */
export async function safePath(path:string,root:string,createParents=false):Promise<string>{
 if(!isAbsolute(path)||path.startsWith('\\\\')||path.startsWith('//')||path.slice(parse(path).root.length).includes(':')||/[\x00-\x1f]/.test(path))throw new Error('안전하지 않은 절대 경로');
 const full=resolve(path);root=resolve(root);if(!within(root,full))throw new Error('허용 범위 밖 경로');
 const app=await realpath(appRoot);if(!within(app,await realpath(root).catch(()=>root)))throw new Error('root escape');
 let current=appRoot;
 const pieces=relative(appRoot,full).split(/[\\/]/);
 if(!within(appRoot,full))throw new Error('project escape');
 for(let i=0;i<pieces.length;i++){
  current=join(current,pieces[i]);
  let st=await lstat(current).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});
  if(!st&&createParents&&i<pieces.length-1){await mkdir(current);st=await lstat(current);}
  if(!st){if(i===pieces.length-1&&createParents)return full;throw new Error('파일 없음');}
  if(st.isSymbolicLink()||!within(app,await realpath(current)))throw new Error('symlink/junction escape');
  if(i<pieces.length-1&&!st.isDirectory())throw new Error('디렉터리 아님');
 }
 return full;
}
export async function localBytes(path:string,root:string,max=50*1024*1024):Promise<Buffer>{
 const safe=await safePath(path,root);const st=await lstat(safe);if(!st.isFile()||st.size<=0||st.size>max)throw new Error('파일 크기/형식 오류');
 return readFile(safe);
}
/** 검증된 완전한 bytes만 노출. 기존 파일 덮어쓰기 금지. */
export async function publish(path:string,bytes:Uint8Array):Promise<void>{
 const safe=await safePath(path,dataRoot,true);const tmp=join(dirname(safe),`.r1-${randomUUID()}.tmp`);
 try{await writeFile(tmp,bytes,{flag:'wx'});await safePath(safe,dataRoot,true);await link(tmp,safe);}finally{await unlink(tmp).catch(()=>{});}
}
