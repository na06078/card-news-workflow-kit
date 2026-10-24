import Database from 'better-sqlite3';
import {readFile} from 'node:fs/promises';
test('이전 v1 DB의 원장과 JSON을 보존하는 원자적 최신 migration',async()=>{
 const {s,options}=await fixture();const made=await s.createProject({createRequestId:randomUUID(),topic:'이전 자료'});if(!('data'in made.body))throw Error('create');const pid=made.body.data.projectId;
 await s.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1});await s.close();
 let db=new Database(options.dbPath);db.exec('DROP TABLE IF EXISTS project_deletions; DROP TABLE IF EXISTS project_model_settings; DELETE FROM schema_migrations WHERE version>=2');
 const tables=['projects','history','runs','requests','events'];const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));db.close();
 const reopened=await createStore(options);await reopened.close();db=new Database(options.dbPath);
 try{expect(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({v:3});for(const t of tables)expect(db.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[t]);expect(db.prepare('SELECT * FROM project_model_settings').all()).toEqual([]);}finally{db.close();}
 // A v1 database with an injected migration failure rolls the DDL/version back.
 db=new Database(options.dbPath);db.exec(`DROP TABLE project_deletions;DROP TABLE project_model_settings;DELETE FROM schema_migrations WHERE version>=2;CREATE TRIGGER reject_v2 BEFORE INSERT ON schema_migrations WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'test failure'); END;`);db.close();
 await expect(createStore(options)).rejects.toThrow('test failure');db=new Database(options.dbPath);try{expect(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()).toEqual({v:1});expect(db.prepare("SELECT name FROM sqlite_master WHERE name='project_model_settings'").get()).toBeUndefined();for(const t of tables)expect(db.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[t]);}finally{db.close();}
});
test('모델 설정은 별도 버전과 원장으로 저장되고 실행중 lease와 콘텐츠를 건드리지 않는다',async()=>{
 const {s,options}=await fixture();try{const made=await s.createProject({createRequestId:randomUUID(),topic:'모델'});if(!('data'in made.body))throw Error('create');const pid=made.body.data.projectId;
 const req={requestId:randomUUID(),version:0,model:'model-one'};const selected=await s.setProjectModel(pid,req);expect(selected.status).toBe(200);expect(selected.body).toEqual({data:{projectId:pid,model:'model-one',version:1,appliesTo:'next_run'}});
 const p=await s.getProject(pid);expect(p.claudeModel).toBe('model-one');expect(p.modelSettingsVersion).toBe(1);expect(p.projectVersion).toBe(1);
 expect((await s.setProjectModel(pid,req)).replayed).toBe(true);expect((await s.setProjectModel(pid,{...req,model:null})).status).toBe(409);expect((await s.setProjectModel(pid,{...req,requestId:randomUUID()})).status).toBe(409);
 await s.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1});const job=await s.claimJob({ownerId:'model-test',now:options.clock(),leaseMs:30000,dataMode:'mock'});expect(job).not.toBeNull();
 const before=await s.getProject(pid);const db=new Database(options.dbPath);const payload=db.prepare('SELECT payload FROM projects WHERE id=?').get(pid);const lease=db.prepare('SELECT owner,lease_until,fence,base_version FROM runs').all();const history=db.prepare('SELECT * FROM history').all();
 await s.setProjectModel(pid,{requestId:randomUUID(),version:1,model:null});expect((await s.getProject(pid)).projectVersion).toBe(before.projectVersion);expect(db.prepare('SELECT payload FROM projects WHERE id=?').get(pid)).toEqual(payload);expect(db.prepare('SELECT owner,lease_until,fence,base_version FROM runs').all()).toEqual(lease);expect(db.prepare('SELECT * FROM history').all()).toEqual(history);db.close();
 expect(await s.heartbeat(job!.fence,{now:options.clock(),leaseMs:30000})).toBe(true);
 }finally{await s.close();}
});
test('생성 선택모델을 저장하고 원장 재생이 모델 검증보다 먼저 실행된다',async()=>{
 const {s}=await fixture();try{let checks=0;const validate=()=>{checks++;};const input={createRequestId:randomUUID(),topic:'명시 모델',claudeModel:'model-a'};
 const made=await s.createProject(input,validate);expect(checks).toBe(1);if(!('data'in made.body))throw Error('create');const pid=made.body.data.projectId;expect((await s.getProject(pid)).claudeModel).toBe('model-a');
 const unavailable=()=>{throw Error('catalog down');};expect((await s.createProject(input,unavailable)).replayed).toBe(true);
 const request={requestId:randomUUID(),version:0,model:'model-b'};expect((await s.setProjectModel(pid,request,validate)).status).toBe(200);expect(checks).toBe(2);expect((await s.setProjectModel(pid,request,unavailable)).replayed).toBe(true);
 await expect(s.setProjectModel(pid,{requestId:randomUUID(),version:1,model:'bad'},unavailable)).rejects.toThrow('catalog down');expect((await s.getProject(pid)).claudeModel).toBe('model-b');
 }finally{await s.close();}
});
test('접수시 모델 고정 및 관측 모델은 해당 Run에만 저장된다',async()=>{
 const {s,options}=await fixture();try{const made=await s.createProject({createRequestId:randomUUID(),topic:'고정',claudeModel:'model-a'});if(!('data'in made.body))throw Error('create');const pid=made.body.data.projectId;
 const out=await s.mutate('research',{projectId:pid},{requestId:randomUUID(),version:1});if(!('data'in out.body)||!out.body.data.runId)throw Error('enqueue');const rid=out.body.data.runId;
 await s.setProjectModel(pid,{requestId:randomUUID(),version:0,model:'model-b'});
 expect((await s.getRun(rid)).requestedModel).toBe('model-a');const job=await s.claimJob({ownerId:'capture',now:options.clock(),leaseMs:30000,dataMode:'mock'});expect(job!.context!.requestedModel).toBe('model-a');
 await s.appendEvent(job!.fence,{type:'progress',phase:'research',message:'연결',completed:null,total:null,actualModel:'model-a-resolved'});expect((await s.getRun(rid)).actualModel).toBe('model-a-resolved');expect((await s.getProject(pid)).claudeModel).toBe('model-b');
 }finally{await s.close();}
});
test('모델 선택과 콘텐츠 활동시각을 목록에 반영하고 재시작에도 설정이 유지된다',async()=>{
 const {s,options}=await fixture();const a=await s.createProject({createRequestId:randomUUID(),topic:'a'}),b=await s.createProject({createRequestId:randomUUID(),topic:'b'});if(!('data'in a.body)||!('data'in b.body))throw Error('create');await s.close();
 const at='2026-10-25T12:00:00.000Z';const reopened=await createStore({...options,clock:()=>at});try{await reopened.setProjectModel(a.body.data.projectId,{requestId:randomUUID(),version:0,model:'model-a'});const list=await reopened.listProjects();expect(list.projects[0]!.projectId).toBe(a.body.data.projectId);expect(list.projects[0]!.updatedAt).toBe(at);}finally{await reopened.close();}
 const again=await createStore(options);try{expect((await again.getProject(a.body.data.projectId)).claudeModel).toBe('model-a');expect((await again.getProject(a.body.data.projectId)).modelSettingsVersion).toBe(1);}finally{await again.close();}
});
import {createMockSnapshot} from '../../src/shared/모의자료.js';
test('실행을 새로 만들지 않는 카드 승인도 최근 활동순에 반영한다',async()=>{
 const {s,options}=await fixture();await s.close();const p=createMockSnapshot('review');const db=new Database(options.dbPath);db.prepare('INSERT INTO projects VALUES(?,?)').run(p.projectId,JSON.stringify(p));db.close();
 const at='2026-10-26T12:00:00.000Z';const reopened=await createStore({...options,clock:()=>at});try{
 const out=await reopened.mutate('cardApprove',{projectId:p.projectId,cardId:p.result!.cards[0]!.cardId},{requestId:randomUUID(),version:1,resultVersion:1});expect(out.status).toBe(200);
 expect((await reopened.listProjects()).projects[0]!.updatedAt).toBe(at);expect((await reopened.getProject(p.projectId)).modelSettingsVersion).toBe(0);
 }finally{await reopened.close();}
});
import {AppErrorSchema} from '../../src/shared/검증.js';
test('설정 버전 0의 충돌도 표준 오류 스키마를 만족한다',async()=>{
 const {s}=await fixture();try{const made=await s.createProject({createRequestId:randomUUID(),topic:'초기 버전'});if(!('data'in made.body))throw Error('create');const out=await s.setProjectModel(made.body.data.projectId,{requestId:randomUUID(),version:1,model:null});expect(out.status).toBe(409);if(!('error'in out.body))throw Error('conflict');expect(AppErrorSchema.safeParse(out.body.error).success).toBe(true);}finally{await s.close();}
});
import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createStore} from '../../src/backend/저장소.js';
async function fixture(){const dataDir=resolve('실행데이터/작업공간개선/저장소/임시',randomUUID());await mkdir(dataDir,{recursive:true});const options={dbPath:resolve(dataDir,'검사.sqlite'),dataDir,dataMode:'mock' as const,clock:()=> '2026-10-24T12:00:00.000Z'};return {options,s:await createStore(options)};}
test('모든 프로젝트를 안정적인 활동순으로 나열하고 기본 모델을 복원한다',async()=>{
 const {s}=await fixture();try{
 const ids:string[]=[];for(let i=0;i<3;i++){const out=await s.createProject({createRequestId:randomUUID(),topic:`프로젝트 ${i}`});if('data'in out.body)ids.push(out.body.data.projectId);}
 const list=await s.listProjects();expect(list.projects.map(p=>p.projectId)).toEqual(ids.sort());
 for(const p of list.projects){expect(p.claudeModel).toBeNull();expect(p.updatedAt).toBe('2026-10-24T12:00:00.000Z');expect(p.activeRunId).toBeNull();expect(p.cardCount).toBe(0);expect((await s.getProject(p.projectId)).modelSettingsVersion).toBe(0);}
 }finally{await s.close();}
});
