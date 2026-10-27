import Database from 'better-sqlite3';
import {getSessionMessages} from '@anthropic-ai/claude-agent-sdk';
import {resolve} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {FactProposalDraftSchema} from '../dist/server/shared/포트.js';
import {captureFetchReceipt,validateFactReview} from '../dist/server/providers/사실재검증.js';
const runId=process.argv[2]??'09fb5413-8567-4b0d-8d0e-377e5c6b032c',out=resolve('실행데이터/실사용검수복구/수집재생',runId);await mkdir(out,{recursive:true});
const db=new Database('실행데이터/앱/카드뉴스.sqlite',{readonly:true}),session=db.prepare('SELECT session_id,cwd FROM sessions WHERE run_id=?').get(runId);db.close();
if(!session)throw Error('SESSION_NOT_FOUND');const messages=await getSessionMessages(session.session_id,{dir:session.cwd});
let snapshot,draft;const uses=new Map(),receipts=[],toolResults=[];
for(const m of messages){const content=m.message?.content;if(m.type==='user'&&typeof content==='string'){try{const value=JSON.parse(content.slice(content.lastIndexOf('\n')+1));if(value.snapshot?.factReview?.runId===runId)snapshot=value.snapshot;}catch{}}
 if(!Array.isArray(content))continue;for(const b of content){if(b.type==='tool_use'&&b.name==='StructuredOutput')draft=b.input;if(b.type==='tool_use'&&b.name==='WebFetch')uses.set(b.id,b.input.url);
 if(b.type==='tool_result'&&uses.has(b.tool_use_id)){receipts.push(captureFetchReceipt(b.tool_use_id,uses.get(b.tool_use_id),undefined,!!b.is_error,m.timestamp));toolResults.push({id:b.tool_use_id,failed:!!b.is_error,contentType:typeof b.content,chars:typeof b.content==='string'?b.content.length:0});}}
}
if(!snapshot||!draft)throw Error('CAPTURED_DOMAIN_INPUT_MISSING');
const schema=FactProposalDraftSchema.safeParse(draft),stats={session:session.session_id,messages:messages.length,webFetchAttempts:uses.size,toolResults,schemaValid:schema.success,schemaIssues:schema.success?[]:schema.error.issues.map(i=>({path:i.path,code:i.code})),sourceCount:draft.sources?.length,cardCount:draft.cards?.length,findings:draft.findings?.map(f=>({index:f.claimIndex,classification:f.classification,kind:f.afterClaim.kind,sourceCount:f.afterClaim.sourceIds.length,comparisons:f.comparisons.length})),sources:draft.sources?.map(s=>({id:s.sourceId,host:new URL(s.url).hostname,access:s.access,evidenceChars:s.evidence?.length??0}))};
try{validateFactReview(draft,snapshot,receipts);stats.replay='passed';}catch(e){stats.replayCode=e.code;stats.boundary=e.stack?.split('\n').find(l=>l.includes('사실재검증.js:'))?.trim()??null;}
await writeFile(resolve(out,'검증입력.json'),JSON.stringify({snapshot,draft,receipts,receiptLimit:'SDK getSessionMessages strips native HTTP metadata; failure flags are preserved; no positive HTTP receipt is invented.'},null,2));await writeFile(resolve(out,'재생결과.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats));
