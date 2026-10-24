import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
test('선택 소식의 기획 근거를 병합해도 전체 조사 후보의 기존 출처 참조를 보존한다',async()=>{
 const dir=await mkdtemp(resolve(process.env.TMPDIR!,'기획출처-'));
 const s=await createStore({dataDir:dir,dbPath:resolve(dir,'검사.sqlite'),dataMode:'mock'});
 try{
  const created=await s.createProject({topic:'격리 출처 병합 검사',createRequestId:randomUUID()});if(!('data' in created.body))throw Error('create');
  const target={projectId:created.body.data.projectId};
  const claim=async()=>{const j=await s.claimJob({ownerId:randomUUID(),now:new Date().toISOString(),leaseMs:30000,dataMode:'mock'});if(!j)throw Error('claim');return j;};
  await s.mutate('research',target,{version:1,requestId:randomUUID()});const research=await claim();const fixture=createMockSnapshot('selection');
  const secondCandidateId=randomUUID(),secondSourceId=randomUUID();
  fixture.candidates.push({...fixture.candidates[0],candidateId:secondCandidateId,eventKey:'다른-조사-사건',sourceIds:[secondSourceId]});
  fixture.sources.push({...fixture.sources[0],sourceId:secondSourceId,candidateId:secondCandidateId,url:'https://example.com/other-source'});
  await s.commit(research.fence,{type:'content',content:{kind:'candidates',researchVersion:1,candidates:fixture.candidates,sources:fixture.sources,shortageReason:null}});
  const cid=fixture.candidates[0].candidateId;expect(fixture.candidates.length).toBeGreaterThan(1);
  await s.mutate('selection',target,{version:1,candidateIds:[cid],requestId:randomUUID()});const j=await claim();
  const selected=fixture.sources.filter(s=>s.candidateId===cid);
  const extra={...selected[0],sourceId:randomUUID(),url:'https://example.com/official-document',primary:true};
  const board={...createMockSnapshot('storyboard').storyboard!,size:'1080x1080' as const,cards:createMockSnapshot('storyboard').storyboard!.cards.map(c=>({...c,sourceIds:[extra.sourceId]}))};
  await s.commit(j.fence,{type:'content',content:{kind:'storyboard',storyboard:board,sources:[...selected,extra],claims:[]}});
  const p=await s.getProject(target.projectId);expect(p.stage).toBe('storyboard');expect(p.candidates).toEqual(fixture.candidates);
  for(const old of fixture.sources)expect(p.sources.find(x=>x.sourceId===old.sourceId)).toEqual(old);
  expect(p.sources.find(x=>x.sourceId===extra.sourceId)).toEqual(extra);expect(p.lastRun?.status).toBe('succeeded');
 }finally{await s.close();await rm(dir,{recursive:true,force:true});}
});
