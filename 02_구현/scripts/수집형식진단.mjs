import Database from 'better-sqlite3';
import {getSessionMessages} from '@anthropic-ai/claude-agent-sdk';
import {readFile,writeFile} from 'node:fs/promises';
const rid=process.argv[2],dir=`실행데이터/실사용검수복구/수집재생/${rid}`,{draft}=JSON.parse(await readFile(`${dir}/검증입력.json`,'utf8'));
const db=new Database('실행데이터/앱/카드뉴스.sqlite',{readonly:true}),s=db.prepare('SELECT session_id,cwd FROM sessions WHERE run_id=?').get(rid);db.close();
const ms=await getSessionMessages(s.session_id,{dir:s.cwd}),uses=new Map(),results=new Map();
for(const m of ms)if(Array.isArray(m.message?.content))for(const b of m.message.content){if(b.type==='tool_use'&&b.name==='WebFetch')uses.set(b.id,b.input.url);if(b.type==='tool_result'&&uses.has(b.tool_use_id))results.set(uses.get(b.tool_use_id),b.content);}
const sm=new Map(draft.sources.map(s=>[s.sourceId,s])),pm=new Map(draft.cards.map(c=>[c.cardId,c]));
const out={quotes:draft.sources.map(s=>({host:new URL(s.url).hostname,chars:s.evidence?.length??0,matches:s.evidence?results.get(s.url)?.includes(s.evidence):null})),findings:draft.findings.map(f=>({i:f.claimIndex,kind:f.afterClaim.kind,attribution:/(따르면|발표|보고|보도|주장|에 의하면|according to|reports?|claims?|announc)/i.test(f.afterClaim.text),publisherExact:f.afterClaim.sourceIds.map(id=>({publisher:sm.get(id).publisher,matched:f.afterClaim.text.includes(sm.get(id).publisher)})),cardExact:f.cardIds.map(id=>!!pm.get(id)&&`${pm.get(id).title}\n${pm.get(id).body}`.includes(f.afterClaim.text)),comparisonFailures:f.comparisons.flatMap(c=>Object.entries(c).filter(([k,v])=>k!=='sourceId'&&v!==null&&v!=='unknown'&&!sm.get(c.sourceId).evidence?.includes(String(v))).map(([key,value])=>({key,value}))) }))};
await writeFile(`${dir}/형식진단.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(out));
