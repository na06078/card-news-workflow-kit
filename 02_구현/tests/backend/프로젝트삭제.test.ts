import {test,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,lstat,rm,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createStore} from '../../src/backend/저장소.js';
import {deleteProjectFiles} from '../../src/backend/프로젝트삭제.js';
import type {Store,StoreOptions} from '../../src/shared/포트.js';

test('완료된 부모/자식 실행과 모든 관계 기록을 원자 삭제한다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('related'),other=await create('untouched');
 const db=new Database(options.dbPath);db.pragma('foreign_keys = ON');
 try{
  for(const id of [pid,other]){
   const a=randomUUID(),b=randomUUID(),q=randomUUID(),asset=randomUUID();
   db.prepare("INSERT INTO runs(id,project_id,status,payload,base_version,parent_id) VALUES(?,?,'succeeded',?,1,NULL)").run(a,id,JSON.stringify({runId:a,projectId:id,status:'succeeded'}));
   db.prepare("INSERT INTO runs(id,project_id,status,payload,base_version,parent_id) VALUES(?,?,'failed',?,1,?)").run(b,id,JSON.stringify({runId:b,projectId:id,status:'failed'}),a);
   db.prepare("INSERT INTO events VALUES(?,1,?,?)").run(id,a,'{}');
   db.prepare("INSERT INTO questions VALUES(?,?,1,'answered',?,NULL)").run(id,q,'{}');
   db.prepare("INSERT INTO answers VALUES(?,?,1,?,1,2,1)").run(id,q,'{}');
   db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(randomUUID(),id,a,'private cwd');
   db.prepare("INSERT INTO invocations VALUES(?,1,?)").run(a,'{}');
   db.prepare("INSERT INTO assets VALUES(?,?,?,?)").run(asset,id,id+'/image.png','{}');
   db.prepare("INSERT INTO exports VALUES(?,?,1,?,?)").run(randomUUID(),id,asset,'{}');
   db.prepare("INSERT INTO history VALUES(?,1,?)").run(id,'{}');
   db.prepare("INSERT INTO requests VALUES(?,?,'POST','route','secret','hash',200,?)").run(id,randomUUID(),'{}');
  }
  const tables=['projects','requests','runs','events','questions','answers','sessions','invocations','assets','exports','history','project_model_settings'];
  const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all().filter((r:any)=>r.project_id===other||r.scope===other||r.id===other||r.scope==='@create'&&JSON.parse(r.body).data.projectId===other||t==='invocations'&&db.prepare('SELECT 1 FROM runs WHERE id=? AND project_id=?').get(r.run_id,other))]));
  expect((await store.deleteProject(pid,{requestId:randomUUID(),version:1,confirm:true})).status).toBe(200);
  for(const t of tables)expect(db.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[t]);
  expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close();}
});

test.each(['queued','running','waiting_for_user','cancel_requested','stale'])('삭제 전제조건 %s 는 표식과 파일을 보존한다',async status=>{
 const {store,options,create}=await fixture();const pid=await create('guard');
 const target=resolve(options.dataDir,'projects',pid);await mkdir(target,{recursive:true});await writeFile(resolve(target,'keep'),'safe');
 const db=new Database(options.dbPath);try{
 if(status!=='stale')db.prepare('INSERT INTO runs(id,project_id,status,payload,base_version) VALUES(?,?,?,?,1)').run(randomUUID(),pid,status,'{}');
 const r=await store.deleteProject(pid,{requestId:randomUUID(),version:status==='stale'?2:1,confirm:true});
 expect(r).toMatchObject({status:409,body:{error:{code:status==='stale'?'VERSION_CONFLICT':'RUN_ACTIVE'}}});
 expect(db.prepare('SELECT * FROM project_deletions').all()).toEqual([]);expect(await readFile(resolve(target,'keep'),'utf8')).toBe('safe');
 }finally{db.close();}
});
test('확인하지 않은 삭제는 거절한다',async()=>{
 const {store,create}=await fixture();const pid=await create('keep');
 await expect(store.deleteProject(pid,{requestId:randomUUID(),version:1,confirm:false as true})).rejects.toThrow();expect((await store.getProject(pid)).topic).toBe('keep');
});

test('부분 파일 실패 후 재개한 저장소가 변경을 차단하고 같은 삭제 요청을 재시도한다',async()=>{
 const {store,options,create}=await fixture({deleteProjectFiles:async(dir,pid)=>{await rm(resolve(dir,'projects',pid,'first'));throw Error('private OS path');}});
 const pid=await create('pending'),target=resolve(options.dataDir,'projects',pid);await mkdir(target,{recursive:true});await writeFile(resolve(target,'first'),'a');await writeFile(resolve(target,'second'),'b');
 const input={requestId:randomUUID(),version:1,confirm:true as const};
 expect(await store.deleteProject(pid,input)).toMatchObject({status:503,body:{error:{code:'PROJECT_DELETE_FAILED'}}});
 await store.close();stores.splice(stores.indexOf(store),1);
 const reopened=await createStore({...options,deleteProjectFiles:undefined});stores.push(reopened);
 expect((await reopened.listProjects()).projects[0]).toMatchObject({projectVersion:1,deletionPending:true,deletionRequestId:input.requestId});
 expect(await reopened.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1})).toMatchObject({status:409,body:{error:{code:'PROJECT_DELETING'}}});
 expect(await reopened.setProjectModel(pid,{requestId:randomUUID(),version:0,model:null})).toMatchObject({status:409,body:{error:{code:'PROJECT_DELETING'}}});
 expect((await reopened.deleteProject(pid,{...input,requestId:randomUUID()})).status).toBe(409);
 expect((await reopened.deleteProject(pid,input)).status).toBe(200);
 await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'});
});

test('영속 표식은 다른 연결의 claim과 이전 fence의 쓰기도 막는다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('fence');
 await store.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1});
 const now=new Date().toISOString();const args={ownerId:randomUUID(),now,leaseMs:60000,dataMode:'mock' as const};
 const job=await store.claimJob(args);expect(job).not.toBeNull();
 const db=new Database(options.dbPath);try{
 db.prepare("INSERT INTO project_deletions VALUES(?,?,1,'pending')").run(pid,randomUUID());
 await expect(store.appendEvent(job!.fence,{type:'progress',phase:'research',message:'blocked',completed:null,total:null})).rejects.toMatchObject({error:{code:'PROJECT_DELETING'}});
 db.prepare("UPDATE runs SET status='queued',owner=NULL").run();
 expect(await store.claimJob(args)).toBeNull();
 }finally{db.close();}
});

test('파일 콜백이 아무 작업도 하지 않으면 성공으로 표시하지 않는다',async()=>{
 const {store,options,create}=await fixture({deleteProjectFiles:async()=>{}});const pid=await create('not deleted');
 const target=resolve(options.dataDir,'projects',pid);await mkdir(target,{recursive:true});
 expect(await store.deleteProject(pid,{requestId:randomUUID(),version:1,confirm:true})).toMatchObject({status:503,body:{error:{code:'PROJECT_DELETE_FAILED'}}});
 expect((await store.getProject(pid)).topic).toBe('not deleted');
});

test.each(['root','projects','target','nested'])('접합점 %s 경계는 제거하지 않고 원본을 보존한다',async boundary=>{
 const {store,options,create}=await fixture();const pid=await create('boundary');
 const outside=resolve(options.dataDir,'outside');await mkdir(outside,{recursive:true});await writeFile(resolve(outside,'sentinel'),'keep');
 const projects=resolve(options.dataDir,'projects'),target=resolve(projects,pid);
 if(boundary==='root'){
  const alias=resolve(options.dataDir,'alias');await symlink(outside,alias,'junction');
  await expect(deleteProjectFiles(alias,pid)).rejects.toMatchObject({error:{code:'ASSET_INVALID'}});
 }else{
  if(boundary==='projects')await symlink(outside,projects,'junction');
  if(boundary==='target'){await mkdir(projects,{recursive:true});await symlink(outside,target,'junction');}
  if(boundary==='nested'){await mkdir(target,{recursive:true});await symlink(outside,resolve(target,'escape'),'junction');}
  expect(await store.deleteProject(pid,{requestId:randomUUID(),version:1,confirm:true})).toMatchObject({status:502,body:{error:{code:'ASSET_INVALID'}}});
 }
 expect(await readFile(resolve(outside,'sentinel'),'utf8')).toBe('keep');
});
test('파일 삭제 helper는 UUID가 아닌 부모/루트 경로를 거절한다',async()=>{
 const {options}=await fixture();await expect(deleteProjectFiles(options.dataDir,'..')).rejects.toMatchObject({error:{code:'ASSET_INVALID'}});await expect(lstat(options.dataDir)).resolves.toBeDefined();
});

test('다른 변경에 쓴 요청 ID는 삭제 요청으로 재사용하지 않는다',async()=>{
 const {store,create}=await fixture();const pid=await create('collision'),requestId=randomUUID();
 await store.setProjectModel(pid,{requestId,version:0,model:null});
 expect(await store.deleteProject(pid,{requestId,version:1,confirm:true})).toMatchObject({status:409,body:{error:{code:'REQUEST_ID_CONFLICT'}}});
 expect((await store.getProject(pid)).topic).toBe('collision');
});

test('최종 DB 제거가 조용히 무시되어도 완료하지 않고 원자 롤백 후 재시도한다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('rollback');
 const target=resolve(options.dataDir,'projects',pid);await mkdir(target,{recursive:true});await writeFile(resolve(target,'asset'),'x');
 const db=new Database(options.dbPath);const input={requestId:randomUUID(),version:1,confirm:true as const};
 try{
 db.exec("CREATE TRIGGER block_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(IGNORE); END");
 expect(await store.deleteProject(pid,input)).toMatchObject({status:503,body:{error:{code:'PROJECT_DELETE_FAILED'}}});
 expect(db.prepare('SELECT state FROM project_deletions WHERE project_id=?').get(pid)).toEqual({state:'pending'});
 expect(db.prepare('SELECT * FROM project_model_settings WHERE project_id=?').all(pid)).toHaveLength(1);
 await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'});
 db.exec('DROP TRIGGER block_delete');
 await store.close();stores.splice(stores.indexOf(store),1);
 const reopened=await createStore(options);stores.push(reopened);
 expect((await reopened.deleteProject(pid,input)).status).toBe(200);
 }finally{db.close();}
});

test('주입한 파일 콜백도 경계 검증 전에 호출하지 않는다',async()=>{
 let called=false;const {store,options,create}=await fixture({deleteProjectFiles:async()=>{called=true;}});const pid=await create('injection');
 const outside=resolve(options.dataDir,'outside');await mkdir(outside);await symlink(outside,resolve(options.dataDir,'projects'),'junction');
 expect((await store.deleteProject(pid,{requestId:randomUUID(),version:1,confirm:true})).status).toBe(502);expect(called).toBe(false);
});

test('삭제 표식 뒤 reconcile도 프로젝트를 변경하지 않는다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('reconcile');await store.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1});
 const job=await store.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:1,dataMode:'mock'});expect(job).not.toBeNull();
 const db=new Database(options.dbPath);try{
 db.prepare("INSERT INTO project_deletions VALUES(?,?,2,'pending')").run(pid,randomUUID());const before=db.prepare('SELECT * FROM projects').all();
 expect((await store.reconcile({now:'2099-01-01T00:00:00.000Z'})).interruptedRunIds).toEqual([]);expect(db.prepare('SELECT * FROM projects').all()).toEqual(before);
 }finally{db.close();}
});

test('v2 파일 DB 이행은 기존 행을 보존하며 없는 디렉터리 삭제를 재시작 뒤 재생한다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('v2 preserved');await store.close();stores.splice(stores.indexOf(store),1);
 const db=new Database(options.dbPath);let before:unknown;try{db.exec('DROP TABLE project_deletions; DELETE FROM schema_migrations WHERE version=3');before=db.prepare('SELECT * FROM projects').all();}finally{db.close();}
 const migrated=await createStore(options);stores.push(migrated);const read=new Database(options.dbPath);try{expect(read.prepare('SELECT * FROM projects').all()).toEqual(before);expect(read.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);}finally{read.close();}
 const input={requestId:randomUUID(),version:1,confirm:true as const};expect((await migrated.deleteProject(pid,input)).status).toBe(200);await migrated.close();stores.splice(stores.indexOf(migrated),1);
 const reopened=await createStore(options);stores.push(reopened);expect(await reopened.deleteProject(pid,input)).toEqual({status:200,body:{data:{projectId:pid,deleted:true}},replayed:true});expect((await reopened.listProjects()).projects).toEqual([]);
});

const stores:Store[]=[];
afterEach(async()=>{for(const s of stores.splice(0))await s.close();});
async function fixture(extra:Partial<StoreOptions>={}){
 const dataDir=resolve('실행데이터/프로젝트관리개선/저장소',randomUUID());
 const options={dataDir,dbPath:resolve(dataDir,'검사.sqlite'),dataMode:'mock' as const,...extra};
 const store=await createStore(options);stores.push(store);
 const create=async(topic:string)=>{const r=await store.createProject({topic,createRequestId:randomUUID()});if(!('data' in r.body))throw Error('create');return r.body.data.projectId;};
 return {store,options,create};
}
test('영구 삭제는 파일과 생성 영수증까지 지우고 다른 프로젝트를 보존한다',async()=>{
 const {store,options,create}=await fixture();const pid=await create('delete secret topic'),other=await create('preserve');
 const target=resolve(options.dataDir,'projects',pid),keep=resolve(options.dataDir,'projects',other);
 await mkdir(target,{recursive:true});await mkdir(keep,{recursive:true});
 await writeFile(resolve(target,'image.png'),'image');await writeFile(resolve(target,'export.zip'),'zip');await writeFile(resolve(keep,'keep.txt'),'unchanged');
 const before=await store.getProject(other);const input={requestId:randomUUID(),version:1,confirm:true as const};
 const reply=await store.deleteProject(pid,input);
 expect(reply).toEqual({status:200,body:{data:{projectId:pid,deleted:true}},replayed:false});
 await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(resolve(keep,'keep.txt'),'utf8')).toBe('unchanged');expect(await store.getProject(other)).toEqual(before);
 const db=new Database(options.dbPath);try{
 expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{version:1},{version:2},{version:3}]);
 expect(db.prepare('SELECT * FROM projects WHERE id=?').all(pid)).toEqual([]);
 expect(db.prepare("SELECT * FROM requests WHERE scope=? OR json_extract(body,'$.data.projectId')=?").all(pid,pid)).toEqual([]);
 expect(db.prepare('SELECT * FROM project_deletions').all()).toEqual([{project_id:pid,request_id:input.requestId,version:1,state:'complete'}]);
 }finally{db.close();}
 expect(await store.deleteProject(pid,input)).toEqual({...reply,replayed:true});
 expect((await store.deleteProject(pid,{...input,version:2})).status).toBe(409);
});
