import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,enqueueProduction} from './도움.js';
import {fakeImage,fakeRender} from './합성자산.js';
import {RevisionRequestSchema} from '../../src/shared/포트.js';
test.each(['storyboard','text','image'])('renderOnly는 다른 scope=%s의 모델 경계를 우회하지 않는다',scope=>{expect(RevisionRequestSchema.safeParse({requestId:randomUUID(),version:1,scope,renderOnly:true,cardIds:[randomUUID()],instruction:'잘못된 범위'}).success).toBe(false);});
test('renderOnly 렌더 실패의 retry도 그림/모델을 다시 호출하지 않는다',async()=>{
 const s=await setup('실행데이터/가독성개선/연결'),o=options(s);o.agy.generate=vi.fn(fakeImage);o.renderCard=fakeRender;o.createClaudeAdapter=vi.fn(()=>{throw Error('UNEXPECTED_PROVIDER_CALL');});const w=createWorker(o);
 try{await enqueueProduction(s,true);await w.tick();let p=await s.store.getProject(s.pid);let fail=true;const images=vi.mocked(o.agy.generate).mock.calls.length;
  o.renderCard=async i=>{if(fail){fail=false;throw Error('SYNTHETIC_RENDER_FAILURE');}return fakeRender(i);};
  expect((await s.store.mutate('revisions',{projectId:s.pid},{requestId:randomUUID(),version:p.result!.version,scope:'layout',renderOnly:true,cardIds:[p.result!.cards[0]!.cardId],instruction:'재합성 실패 재개'})).status).toBe(202);await w.tick();p=await s.store.getProject(s.pid);expect(p.lastRun?.status).toBe('failed');
  expect((await s.store.mutate('retry',{projectId:s.pid,runId:p.lastRun!.runId},{requestId:randomUUID(),version:p.projectVersion,confirmUnknownOutcome:true})).status).toBe(202);await w.tick();p=await s.store.getProject(s.pid);expect(p.lastRun?.status).toBe('succeeded');expect(o.createClaudeAdapter).not.toHaveBeenCalled();expect(vi.mocked(o.agy.generate).mock.calls.length).toBe(images);
 }finally{await w.dispose();await s.store.close();}
});
