import {test,expect} from 'vitest';import {randomUUID} from 'node:crypto';import Database from 'better-sqlite3';
import {review} from './도움.js';import {buildSemanticReviewInput} from '../../src/providers/검수내용.js';import {syntheticReport} from './의미검수대역.js';import type * as C from '../../src/shared/포트.js';
test.each(['supported','missing','unsupported','unverifiable','changed_title','changed_body'] as const)('최종 승인 admission은 저장된 passed 대신 %s 현재 전체 내용을 재판정한다',async mode=>{
 const {s,target,options}=await review();try{
  let p=await s.getProject(target.projectId);expect(p.stage).toBe('review');expect(p.result!.factsCheck).toBe('pending');
  const db=new Database(options.dbPath);try{
   const row=db.prepare('SELECT payload FROM projects WHERE id=?').get(target.projectId) as {payload:string};const saved=JSON.parse(row.payload) as C.ProjectSnapshot;
   saved.sources=saved.sources.map(source=>({...source,access:'opened',accessedAt:new Date().toISOString(),evidence:'명시 합성 근거'}));saved.claims=[{text:'명시 합성 주장',sourceIds:saved.sources.map(source=>source.sourceId),kind:'verified',availability:'unknown',conditions:[]}];
   saved.result!.factsCheck='passed';saved.result!.semanticReview=syntheticReport(buildSemanticReviewInput(saved),undefined,mode==='unsupported'?'unsupported':mode==='unverifiable'?'unverifiable':'supported');
   if(mode==='missing')delete saved.result!.semanticReview;
   if(mode==='changed_title')saved.result!.cards[0].title+=' 999';if(mode==='changed_body')saved.result!.cards[0].body+=' 999';
   db.prepare('UPDATE projects SET payload=? WHERE id=?').run(JSON.stringify(saved),target.projectId);
  }finally{db.close();}
  p=await s.getProject(target.projectId);const out=await s.mutate('approve',target,{requestId:randomUUID(),version:p.result!.version,stage:'final'});
  if(mode==='supported'){expect(out.status).toBe(202);expect((await s.getProject(target.projectId)).result!.finalApprovedVersion).toBe(p.result!.version);}else{expect(out.status).toBe(409);expect('error'in out.body&&out.body.error.code).toBe('STAGE_CONFLICT');const after=await s.getProject(target.projectId);expect(after.projectVersion).toBe(p.projectVersion);expect(after.result!.finalApprovedVersion).toBeNull();expect(after.activeRun).toBeNull();expect(after.factIssues!.some(i=>i.code.startsWith('SEMANTIC_REVIEW_'))).toBe(true);expect(after.allowedActions).toContain('approve_final');expect(after.allowedActions).toContain('reverify_facts');}
 }finally{await s.close();}
});
