import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {사실검수} from '../../src/frontend/컴포넌트/사실검수.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';

afterEach(cleanup);
it.each([['failed','실패'],['canceled','취소됨'],['interrupted','중단됨']] as const)('종료된 사실 검토 %s를 진행 대기로 오표시하지 않는다',(status,label)=>{
 const p=createMockSnapshot('review'),send=vi.fn();
 p.status='error';p.allowedActions=['reverify_facts'];
 p.claims=[{text:'합성 검토 주장',sourceIds:[p.sources[0]!.sourceId],kind:'uncertain',availability:'unknown',conditions:[]}];
 p.lastRun={...p.lastRun!,kind:'factReview',status,error:{code:'FACT_REVIEW_FAILED',message:'원문 근거를 확보하지 못했습니다.',retryable:false,nextActions:['contact_user'],projectId:p.projectId,runId:p.lastRun!.runId,currentVersion:p.projectVersion,details:{}}};
 p.factReview={runId:p.lastRun.runId,baseVersion:p.projectVersion,storyboardVersion:p.storyboard!.version,resultVersion:p.result!.version,contentHash:'0'.repeat(64),claimIndices:[0],cardIds:[p.result!.cards[0]!.cardId],state:'pending',readyVersion:null,proposal:null};
 render(<사실검수 p={p} busy={false} send={send}/>);
 expect(screen.getByRole('heading',{name:new RegExp('재검증 '+label)})).toBeVisible();
 expect(screen.queryByText(/재검증 진행 대기/)).not.toBeInTheDocument();
 expect(screen.getByText('원문 근거를 확보하지 못했습니다.')).toBeVisible();
 expect(send).not.toHaveBeenCalled();
});
