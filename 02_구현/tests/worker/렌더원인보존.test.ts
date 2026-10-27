import {describe,expect,it} from 'vitest';
import {RenderFailure} from '../../src/render/파일경계.js';
import {normalizeError} from '../../src/worker/실행단계.js';
import {MOCK_IDS} from '../../src/shared/모의자료.js';

const fence={projectId:MOCK_IDS.project,runId:MOCK_IDS.run,ownerId:'isolated-test',attempt:1,fencingToken:1,baseProjectVersion:5};
const context={projectId:MOCK_IDS.project,runId:MOCK_IDS.run,resultVersion:1};

describe('앱 소유 렌더 원인의 안전한 전달',()=>{
  it.each(['TEXT_OVERFLOW','FONT_UNAVAILABLE','BROWSER_UNAVAILABLE','BACKGROUND_INVALID'])('안전 원인 %s는 유지하되 원시 오류는 공개하지 않는다',reason=>{
    const raw=new RenderFailure('RENDER_FAILED','private-path-and-content',context,reason);
    const error=normalizeError(raw,fence);
    expect(error.code).toBe('RENDER_FAILED');
    expect(error.details.reason).toBe(reason);
    expect(error.message).not.toContain('private-path');
    expect(error.message).not.toBe('카드 렌더 또는 글자 배치 검증에 실패했습니다.');
  });
  it('외부가 주입한 임의 reason은 전달하지 않는다',()=>{
    const error=normalizeError({error:{code:'RENDER_FAILED',message:'private-path-and-content',retryable:true,nextActions:['revise'],projectId:MOCK_IDS.project,runId:MOCK_IDS.run,currentVersion:5,details:{reason:'private-path-and-content'}}},fence);
    expect(error.details.reason).toBe('RENDER_FAILED');
    expect(JSON.stringify(error)).not.toContain('private-path');
  });
});
