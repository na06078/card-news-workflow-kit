import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {ProjectSnapshotSchema} from '../../src/shared/포트.js';
import {validateContent,contentSchema} from '../../src/providers/조사검증.js';
const projectId='6332b148-8030-4a6a-b0a0-d9405ebd4d5b';
const runId='8106ab9d-86cd-4920-b339-b1eb9f972b38';
test.skipIf(!process.env.CARDNEWS_REPLAY_PROJECT)('승인된 기존 SDK 응답의 공통 출처 실패를 로컬로 재검사한다 — 새 AI 요청0',async()=>{
 expect(process.env.CARDNEWS_REPLAY_PROJECT).toBe(projectId);
 const db=new Database(resolve('실행데이터/앱/카드뉴스.sqlite'),{readonly:true,fileMustExist:true});
 let session:{session_id:string;cwd:string};let payload:string;
 try{
  session=db.prepare('SELECT s.session_id,s.cwd FROM sessions s JOIN runs r ON r.id=s.run_id WHERE r.id=? AND r.project_id=? AND s.project_id=?').get(runId,projectId,projectId) as typeof session;
  payload=(db.prepare('SELECT payload FROM projects WHERE id=?').get(projectId) as {payload:string}).payload;
 }finally{db.close();}
 expect(session!.session_id).toBe('10368cd9-3249-453d-8237-ed93e5cda257');
 expect(resolve(session!.cwd)).toBe(resolve('실행데이터/앱/projects',projectId,'engine'));
 const {getSessionMessages}=await import('@anthropic-ai/claude-agent-sdk');
 const messages=await getSessionMessages(session!.session_id,{dir:session!.cwd,limit:200});
 const outputs:unknown[]=[];
 for(const record of messages){
  const message=record.message as {content?:unknown};
  if(!Array.isArray(message?.content))continue;
  for(const block of message.content){
   if(block&&typeof block==='object'&&block.type==='tool_use'&&block.name==='StructuredOutput')outputs.push(block.input);
  }
 }
 expect(outputs).toHaveLength(1);
 const raw=contentSchema.parse(outputs[0]);if(raw.kind!=='candidates')throw Error('EXPECTED_RESEARCH_CONTENT');
 const before=JSON.stringify(raw),snapshot=ProjectSnapshotSchema.parse(JSON.parse(payload!));
 const result=validateContent(raw,snapshot,'research');if(result.kind!=='candidates')throw Error('EXPECTED_CANDIDATES');
 expect(raw.candidates).toHaveLength(9);expect(raw.sources).toHaveLength(18);
 expect(result.candidates).toHaveLength(9);expect(result.sources).toHaveLength(20);
 expect(JSON.stringify(raw)).toBe(before);
 for(const candidate of result.candidates)for(const id of candidate.sourceIds)expect(result.sources.find(s=>s.sourceId===id)?.candidateId).toBe(candidate.candidateId);
 for(const source of raw.sources)expect(result.sources.find(s=>s.sourceId===source.sourceId)).toEqual(source);
 const report={kind:'local_saved_response_replay',projectId,runId,messages:messages.length,candidatesBefore:raw.candidates.length,candidatesAfter:result.candidates.length,sourceRowsBefore:raw.sources.length,sourceRowsAfter:result.sources.length,rawPreserved:true,referenceValidation:'PASS',newModelRequests:0,newImageRequests:0};
 await writeFile(resolve('실행데이터/조사재시도수정/저장응답검사.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
});
