import {test,expect} from 'vitest';
import {createAgyAdapter} from '../../src/providers/agy.js';
import {childrenReport} from '../../src/providers/정리증거.js';
test('실제 자식과 Job 후손 종료가 모두 확인되면 미검증 reason을 남기지 않는다',()=>{
 expect(childrenReport('fixture',[{pid:1,parentPid:2,executablePath:'test',createdAt:'2026-10-23T00:00:00Z',identityVerified:true,exitConfirmed:true,descendantsConfirmed:true,evidence:'test_double'}])).toMatchObject({status:'confirmed',reason:null});
});
test('시작하지 않은 ID도 종료 증거가 없으면 unknown 보고를 반환한다',async()=>{
 const a=createAgyAdapter({executablePath:'C:/unavailable/agy.exe',livePermission:{inference:false,search:false,image:false}});
 expect(await a.cancel('never-observed')).toMatchObject({runId:'never-observed',status:'unknown',children:[]});
 expect(await a.dispose()).toEqual([]);
});
