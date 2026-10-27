import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setup,review} from './도움.js';

describe('복구 워크플로 경계',()=>{
 it('앱 고정 크기 질문은 자유 입력을 허용하지 않는다',async()=>{const {s,target}=await setup(null);try{expect((await s.getProject(target.projectId)).question!.items[0].allowFreeText).toBe(false);}finally{await s.close();}});
 it('트랜잭션에서 거절한 변경만 rejected로 명시한다',async()=>{const {s,target}=await setup();try{const p=await s.getProject(target.projectId);const out=await s.mutate('approve',target,{requestId:randomUUID(),version:999,stage:'storyboard'});expect(out.status).toBe(409);expect('error'in out.body&&out.body.error.details.requestOutcome).toBe('rejected');expect((await s.getProject(target.projectId)).projectVersion).toBe(p.projectVersion);}finally{await s.close();}});
});
it('주장 목록 자체가 없을 때도 기획 스냅샷이 검수 차단 이유를 공개한다',async()=>{const {s,target}=await setup();try{expect((await s.getProject(target.projectId)).factIssues!.some(i=>i.code==='FACT_CLAIMS_REQUIRED')).toBe(true);}finally{await s.close();}});
