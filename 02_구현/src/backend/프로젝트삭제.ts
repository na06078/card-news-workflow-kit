import {lstat,readdir,realpath,rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {IdSchema} from '../shared/검증.js';
import {DomainError} from './도메인.js';
async function existing(path:string){
 try{return await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function directory(path:string,projectId:string,missing=false){
 const stat=await existing(path);
 if(!stat&&missing)return false;
 if(!stat||!stat.isDirectory()||stat.isSymbolicLink()||relative(path,await realpath(path))!=='')throw new DomainError('ASSET_INVALID',projectId);
 return true;
}
/** Reject root/ancestor aliases, junctions and non-directory targets, even on retry. */
export async function validateProjectDeletionPath(dataDir:string,projectId:string):Promise<string|null>{
 if(!IdSchema.safeParse(projectId).success)throw new DomainError('ASSET_INVALID');
 const root=resolve(dataDir),projects=resolve(root,'projects'),target=resolve(projects,projectId);
 await directory(root,projectId);
 if(!await directory(projects,projectId,true))return null;
 if(!await directory(target,projectId,true))return null;
 return target;
}
async function validateTree(path:string,projectId:string):Promise<void>{
 const stat=await lstat(path);
 if(stat.isSymbolicLink()||relative(path,await realpath(path))!=='')throw new DomainError('ASSET_INVALID',projectId);
 if(stat.isDirectory())for(const child of await readdir(path))await validateTree(resolve(path,child),projectId);
}
export async function verifyProjectFilesAbsent(dataDir:string,projectId:string):Promise<void>{
 if(await validateProjectDeletionPath(dataDir,projectId))throw new DomainError('PROJECT_DELETE_FAILED',projectId);
}
export async function deleteProjectFiles(dataDir:string,projectId:string):Promise<void>{
 const target=await validateProjectDeletionPath(dataDir,projectId);if(!target)return;
 await validateTree(target,projectId);
 // Node rm unlinks symlinks rather than following their targets. Never remove an ancestor.
 await validateProjectDeletionPath(dataDir,projectId);
 await rm(target,{recursive:true,force:true});
 await verifyProjectFilesAbsent(dataDir,projectId);
}
