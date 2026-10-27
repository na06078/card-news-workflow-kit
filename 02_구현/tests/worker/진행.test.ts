import {randomUUID} from 'node:crypto';
import {test,expect,vi} from 'vitest';
import {ProviderFailure} from '../../src/providers/오류.js';
import {createWorker} from '../../src/worker/작업자.js';
import {setup,options,enqueueProduction,applySyntheticSemanticReview} from './도움.js';
import {fakeImage,fakeRender} from './합성자산.js';
test('제작 경계와 실제 완료 장수가 저장되며 공급자 콜백에 카드 ID를 붙인다',async()=>{
 const s=await setup('실행데이터/실사용검수복구/작업자회귀'),o=options(s);o.agy.generate=async(i,_signal,progress)=>{await progress?.({phase:'conversion',message:'PNG 변환 시작',status:'started'});await progress?.({phase:'conversion',message:'PNG 변환 완료',status:'completed'});return fakeImage(i);};o.renderCard=fakeRender;
 const w=createWorker(o);try{await enqueueProduction(s);await w.tick();const p=await s.store.getProject(s.pid),events=(await s.store.getEvents(s.pid,0)).events;
 const progress=events.filter(e=>e.type==='progress'&&e.activity);expect(progress.length).toBeGreaterThan(0);
 const first=p.result!.cards[0].cardId;
 expect(progress.filter(e=>e.type==='progress'&&e.activity?.cardId===first).map(e=>e.type==='progress'&&[e.activity?.operation,e.activity?.status])).toEqual([['planning','started'],['image','started'],['conversion','started'],['conversion','completed'],['image','completed'],['render','started'],['render','completed']]);
 const completed=progress.filter(e=>e.type==='progress'&&e.activity?.operation==='render'&&e.activity.status==='completed');expect(completed.map(e=>e.type==='progress'&&e.completed)).toEqual([1,2]);expect(completed.every(e=>e.type==='progress'&&e.total===2)).toBe(true);
 }finally{await w.dispose();await s.store.close();}
});
test('내보내기 예외도 실제 실패 활동으로 남긴다',async()=>{
 const s=await setup('실행데이터/실사용검수복구/작업자회귀'),o=options(s);o.agy.generate=fakeImage;o.renderCard=fakeRender;o.buildExport=vi.fn(async()=>{throw Error('SECRET_EXPORT');});const w=createWorker(o);
 try{await enqueueProduction(s,true);await w.tick();expect(o.buildExport).not.toHaveBeenCalled();const p=await applySyntheticSemanticReview(s,w);expect(o.buildExport).not.toHaveBeenCalled();expect((await s.store.mutate('approve',{projectId:s.pid},{stage:'final',version:p.result!.version,requestId:randomUUID()})).status).toBe(202);expect((await s.store.getProject(s.pid)).result!.finalApprovedVersion).toBe(p.result!.version);await w.tick();expect(o.buildExport).toHaveBeenCalledTimes(1);const failed=await s.store.getProject(s.pid);expect(failed.lastRun).toMatchObject({kind:'export',status:'failed',error:{code:'EXPORT_FAILED'}});expect(failed.result!.finalApprovedVersion).toBe(p.result!.version);expect(failed.exports).toEqual([]);const events=(await s.store.getEvents(s.pid,0,100)).events;expect(events.filter(e=>e.type==='progress'&&e.activity?.operation==='export').map(e=>e.type==='progress'&&e.activity?.status)).toEqual(['started','failed']);expect(JSON.stringify(events)).not.toContain('SECRET_EXPORT');}finally{await w.dispose();await s.store.close();}
});
test('spawn 미도달 정리 증거가 있을 때만 외부 결과를 not_started로 기록한다',async()=>{
 const s=await setup('실행데이터/실사용검수복구/작업자회귀'),o=options(s);o.agy.generate=async()=>{throw new ProviderFailure('PROCESS_SCOPE_UNVERIFIED');};o.agy.cancel=async runId=>({runId,status:'not_started',verifiedAt:new Date().toISOString(),reason:'SPAWN_NOT_REACHED',children:[]});const w=createWorker(o);
 try{await enqueueProduction(s);await w.tick();const p=await s.store.getProject(s.pid);expect(p.lastRun).toMatchObject({status:'failed',externalOutcome:'not_started',error:{code:'PROCESS_SCOPE_UNVERIFIED'}});expect(p.lastRun!.error!.message).toContain('격리');const events=(await s.store.getEvents(s.pid,0,100)).events;expect(events.some(e=>e.type==='progress'&&e.activity?.status==='failed')).toBe(true);}finally{await w.dispose();await s.store.close();}
});
