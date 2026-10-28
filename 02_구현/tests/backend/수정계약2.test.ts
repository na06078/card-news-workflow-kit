import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {DomainError} from '../../src/backend/도메인.js';
import {review} from './도움.js';
const root='실행데이터/카드수정복구/서버';
async function start(scope:'text'|'layout'|'image'='text'){
 const x=await review(root);const before=await x.s.getProject(x.target.projectId);
 const input={requestId:randomUUID(),version:1,scope,cardIds:[x.cards[0]!.cardId],instruction:'명시 수정'};
 const receipt=await x.s.mutate('revisions',x.target,input);expect(receipt.status).toBe(202);
 return {...x,before,input,j:await x.claim()};
}
test('접수는 현재 결과·카드·승인·단계를 무효화하지 않고 protocol2를 소유한다',async()=>{
 const x=await start();try{const p=await x.s.getProject(x.target.projectId);expect(p.result).toEqual(x.before.result);expect(p.exports).toEqual(x.before.exports);expect(p.stage).toBe(x.before.stage);expect(p.status).toBe(x.before.status);expect(p.projectVersion).toBe(x.before.projectVersion+1);expect(x.j.run.revisionProtocol).toBe(2);expect(x.j.context?.revisionProtocol).toBe(2);
 const replay=await x.s.mutate('revisions',x.target,x.input);expect(replay.replayed).toBe(true);expect((await x.s.getProject(x.target.projectId)).projectVersion).toBe(p.projectVersion);
 }finally{await x.s.close();}
});
test.each([
 {kind:'revision',status:'needs_scope',requestedScope:'text',reason:'문구 변경은 text 범위입니다.'},
 {kind:'revision',status:'no_change',reason:'현재와 같습니다.'},
 {kind:'revision',status:'unsupported',reason:'지원하지 않는 배치입니다.'},
 {kind:'revision',status:'clarification',question:'어떤 문구를 바꿀까요?'},
] as const)('$status는 원본 보존·safe progress·terminal journal을 원자 저장한다',async decision=>{
 const x=await start('layout');try{const a=await x.s.commit(x.j.fence,{type:'revision',decision});const p=await x.s.getProject(x.target.projectId);expect(p.result).toEqual(x.before.result);expect(p.stage).toBe(x.before.stage);expect(p.status).toBe(x.before.status);expect(p.exports).toEqual(x.before.exports);expect(p.lastRun).toMatchObject({revisionOutcome:decision,status:'succeeded',externalOutcome:'known',retryAllowed:false});expect(p.lastRun?.revisionApplied).toBeUndefined();expect(a.event?.type).toBe('progress');const db=new Database(x.options.dbPath);try{expect(db.prepare("SELECT count(*) n FROM invocations WHERE run_id=? AND json_extract(payload,'$.phase')='terminal_commit'").get(x.j.run.runId)).toEqual({n:1});}finally{db.close();}await expect(x.s.commit(a.fence,{type:'revision',decision})).rejects.toThrow('VERSION_CONFLICT');}finally{await x.s.close();}
});
test('유효 text patch만 적용하고 재적용/구형 content 우회는 거절한다',async()=>{
 const x=await start();try{const c=x.cards[0]!;const decision={kind:'revision',status:'patch',patches:[{cardId:c.cardId,scope:'text',changes:{title:'새 제목',body:c.body,sourceIds:c.sourceIds}}]} as const;
 const a=await x.s.commit(x.j.fence,{type:'revision',decision:structuredClone(decision) as any});const p=await x.s.getProject(x.target.projectId);expect(p.result?.version).toBe(2);expect(p.result?.cards[0]).toMatchObject({title:'새 제목',revision:2,state:'pending',previewAssetId:null,imageAssetId:c.imageAssetId});expect(p.result?.cards[1]).toEqual(x.before.result?.cards[1]);expect(p.activeRun).toMatchObject({status:'running',revisionApplied:{resultVersion:2,cardRevisions:[{cardId:c.cardId,revision:2}]}});expect(p.stage).toBe('production');expect(p.status).toBe('working');await expect(x.s.commit(x.j.fence,{type:'revision',decision:decision as any})).rejects.toThrow('VERSION_CONFLICT');await expect(x.s.commit(a.fence,{type:'revision',decision:decision as any})).rejects.toThrow('STAGE_CONFLICT');await expect(x.s.commit(a.fence,{type:'content',content:{kind:'cards',cards:[p.result!.cards[0]!],factsCheck:'passed',visualCheck:'pending'}})).rejects.toThrow('STAGE_CONFLICT');
 }finally{await x.s.close();}
});
test.each(['scope','id','source','metadata','duplicate'] as const)('잘못된 %s 결정은 적용·event·journal 없이 거절한다',async bad=>{
 const x=await start();try{const c=x.cards[0]!;const patch:any={cardId:c.cardId,scope:'text',changes:{title:'새 제목',body:c.body,sourceIds:c.sourceIds}};if(bad==='scope')patch.scope='layout';if(bad==='id')patch.cardId=randomUUID();if(bad==='source')patch.changes.sourceIds=[randomUUID()];if(bad==='metadata')patch.changes.approvedRevision=1;
 const decision:any={kind:'revision',status:'patch',patches:bad==='duplicate'?[patch,patch]:[patch]};const before=await x.s.getProject(x.target.projectId),events=await x.s.getEvents(x.target.projectId,0);await expect(x.s.commit(x.j.fence,{type:'revision',decision})).rejects.toMatchObject({error:{code:'PROVIDER_PROTOCOL_ERROR'}});expect(await x.s.getProject(x.target.projectId)).toEqual(before);expect(await x.s.getEvents(x.target.projectId,0)).toEqual(events);
 }finally{await x.s.close();}
});
test.each(['events','invocations'] as const)('%s 저장 실패 시 결과·run·terminal 전체 rollback',async table=>{
 const x=await start();const db=new Database(x.options.dbPath);try{const before=await x.s.getProject(x.target.projectId);db.exec(`CREATE TRIGGER revision_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'revision_atomic'); END`);const decision:any=table==='invocations'?{kind:'revision',status:'no_change',reason:'같습니다.'}:{kind:'revision',status:'patch',patches:[{cardId:x.cards[0]!.cardId,scope:'text',changes:{title:'새 제목',body:x.cards[0]!.body,sourceIds:x.cards[0]!.sourceIds}}]};await expect(x.s.commit(x.j.fence,{type:'revision',decision})).rejects.toThrow('revision_atomic');expect(await x.s.getProject(x.target.projectId)).toEqual(before);expect(db.prepare('SELECT count(*) n FROM invocations WHERE run_id=?').get(x.j.run.runId)).toEqual({n:0});}finally{db.close();await x.s.close();}
});
