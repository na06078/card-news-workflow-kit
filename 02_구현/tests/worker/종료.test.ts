import {test,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {convertQuestion} from '../../src/providers/질문변환.js';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,enqueueEditorial,confirmed} from './도움.js';
test('stop은 callback만 정리하고 원 질문을 남기며 자연 lease 만료 뒤 interrupted로 복구된다',async()=>{
 const s=await setup(),o=options(s);o.leaseMs=100;o.heartbeatMs=10;
 o.createClaudeAdapter=({bridge,signal})=>({async *start(c){const q=convertQuestion({questions:[{question:'살아 있는 질문?',header:'질문',options:[{label:'A',description:'a'},{label:'B',description:'b'}],multiSelect:false}]},{runId:c.runId,toolUseId:'shutdown-context',createdAt:new Date().toISOString()});yield await bridge.openQuestion(c,q);await bridge.waitForAnswer(c,q.question.questionId,q.question.version,signal!);},answer:async()=>{},status:id=>s.store.getRun(id),cancel:async id=>confirmed(id),dispose:async()=>[]});
 const w=createWorker(o);
 try{await enqueueEditorial(s);const task=w.tick();await vi.waitFor(async()=>expect((await s.store.getProject(s.pid)).status).toBe('waiting_for_user'));const before=await s.store.getProject(s.pid);await w.stop();await task;expect((await s.store.getProject(s.pid)).question?.status).toBe('open');await new Promise(r=>setTimeout(r,150));const next=createWorker(options(s));expect(await next.tick()).toBe(false);const p=await s.store.getProject(s.pid);expect(p.lastRun?.status).toBe('interrupted');expect(p.question?.questionId).toBe(before.question?.questionId);expect(p.question?.status).toBe('superseded');await next.dispose();
 }finally{await w.dispose();await s.store.close();}
});
