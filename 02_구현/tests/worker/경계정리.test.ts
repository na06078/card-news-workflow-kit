import {test,expect} from 'vitest';
import {waitForSettlement,cleanupAccepted} from '../../src/worker/프로세스관리.js';
import {confirmed} from './도움.js';
test('abort는 종료 증거가 아니며 끝나지 않은 작업은 bounded 대기 뒤 거절한다',async()=>{
 const ac=new AbortController();const task=waitForSettlement(new Promise(()=>{}),ac.signal,20);ac.abort();await expect(task).rejects.toMatchObject({code:'WORKER_BOUNDARY_UNSETTLED'});
});
test('report의 run/신원/종료/후손 증거가 틀리면 confirmed 라벨도 채택하지 않는다',()=>{
 expect(cleanupAccepted(confirmed('a'),'b')).toBe(false);expect(cleanupAccepted({...confirmed('a'),children:[{pid:1,parentPid:2,executablePath:null,createdAt:null,identityVerified:null,exitConfirmed:true,descendantsConfirmed:null,evidence:'unverified'}]},'a')).toBe(false);expect(cleanupAccepted(confirmed('a'),'a')).toBe(true);
});
