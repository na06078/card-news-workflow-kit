import {test,expect,vi} from 'vitest';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../../src/backend/저장소.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import {convertQuestion} from '../../src/providers/질문변환.js';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,fixture,enqueueEditorial,confirmed} from './도움.js';
test('질문은 영속되고 서버 저장소만 재열면 살아 있는 callback에 답변을 한 번 전달한다',async()=>{
 const s=await setup(),o=options(s);let deliveries=0;
 const w=createWorker({...o,createClaudeAdapter:({bridge,signal})=>({async *start(c){const q=convertQuestion({questions:[{question:'누가 읽나요?',header:'독자',options:[{label:'일반인',description:'쉽게'},{label:'개발자',description:'자세히'}],multiSelect:false}]},{runId:c.runId,toolUseId:'original-tool-id',createdAt:new Date().toISOString()});yield await bridge.openQuestion(c,q);const answer=await bridge.waitForAnswer(c,q.question.questionId,q.question.version,signal!);expect(answer[0].optionIds).toEqual(['o0']);deliveries++;yield await bridge.publishResult(c,{kind:'storyboard',storyboard:createMockSnapshot('storyboard').storyboard!,sources:fixture.sources,claims:[]});},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[]})});
 try{await enqueueEditorial(s);const task=w.tick();await vi.waitFor(async()=>expect((await s.store.getProject(s.pid)).status).toBe('waiting_for_user'));
 const http=await createStore({dataDir:s.dataDir,dbPath:resolve(s.dataDir,'worker.sqlite'),dataMode:'mock'});
 const p=await http.getProject(s.pid);expect(p.question?.status).toBe('open');expect(p.activeRun?.status).toBe('waiting_for_user');
 const request={version:p.question!.version,questionId:p.question!.questionId,requestId:randomUUID(),answer:[{itemId:p.question!.items[0].itemId,optionIds:['o0'],text:null}]};
 expect((await http.mutate('answers',{projectId:s.pid},request)).status).toBe(202);expect((await http.mutate('answers',{projectId:s.pid},request)).replayed).toBe(true);await http.close();await task;
 expect(deliveries).toBe(1);expect((await s.store.getProject(s.pid)).stage).toBe('storyboard');
 }finally{await w.dispose();await s.store.close();}
});
