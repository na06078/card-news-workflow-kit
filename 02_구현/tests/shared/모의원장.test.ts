import {describe,it,expect} from 'vitest';
import * as mocks from '../../src/shared/모의자료.js';
import * as validators from '../../src/shared/검증.js';
const m=mocks as Record<string,any>, v=validators as Record<string,any>;
describe('공용 모의자료와 요청 동일성',()=>{
 it('각 화면 단계에 실제가 아닌 독립 스냅샷을 제공한다',()=>{
   expect(m.createMockSnapshot).toBeTypeOf('function');
   for(const stage of ['topic','selection','question','storyboard','review','export']) {
     const a=m.createMockSnapshot(stage), b=m.createMockSnapshot(stage);
     expect(a.dataMode).toBe('mock');
     expect(validators.ProjectSnapshotSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
     a.topic='오염'; expect(b.topic).not.toBe('오염');
   }
 });
 it('object key 순서만 정규화하고 배열·공백·Unicode 원문을 보존한다',()=>{
   expect(v.canonicalJson).toBeTypeOf('function');
   expect(v.canonicalJson({z:1,a:{b:2,a:' 원문 '}})).toBe(v.canonicalJson({a:{a:' 원문 ',b:2},z:1}));
   expect(v.canonicalJson(['a','b'])).not.toBe(v.canonicalJson(['b','a']));
   expect(v.canonicalJson(' 원문 ')).not.toBe(v.canonicalJson('원문'));
   for(const bad of [undefined,NaN,Infinity,{bad:undefined},new Date(),{x:BigInt(1)}]) expect(()=>v.canonicalJson(bad)).toThrow();
 });
});
