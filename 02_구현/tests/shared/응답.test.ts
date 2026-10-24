import {it,expect} from 'vitest';
import * as V from '../../src/shared/검증.js';
import {MOCK_IDS} from '../../src/shared/모의자료.js';
const api=V as Record<string,any>;
it('mutation별 성공 응답과 생성 version=1을 엄격 검증한다',()=>{
 expect(api.ResponseSchemas).toBeDefined();
 expect(api.CreateProjectResponseSchema.safeParse({projectId:MOCK_IDS.project,projectVersion:1}).success).toBe(true);
 expect(api.CreateProjectResponseSchema.safeParse({projectId:MOCK_IDS.project,projectVersion:2}).success).toBe(false);
 const receipt={projectId:MOCK_IDS.project,projectVersion:2,runId:MOCK_IDS.run,status:'queued',accepted:true};
 expect(api.ResponseSchemas.selection.safeParse({...receipt,selectedCandidateIds:[MOCK_IDS.candidate]}).success).toBe(true);
 expect(api.ResponseSchemas.selection.safeParse({...receipt,selectedCandidateIds:[MOCK_IDS.candidate,MOCK_IDS.candidate]}).success).toBe(false);
 expect(api.ResponseSchemas.answers.safeParse({...receipt,questionId:MOCK_IDS.question,questionVersion:1}).success).toBe(true);
 expect(api.ResponseSchemas.approve.safeParse({...receipt,finalApprovedVersion:1}).success).toBe(true);
 expect(api.ResponseSchemas.cardApprove.safeParse({projectId:MOCK_IDS.project,projectVersion:2,cardId:MOCK_IDS.card,approvedRevision:1}).success).toBe(true);
 expect(api.ResponseSchemas.research.safeParse({...receipt,unrecognized:true}).success).toBe(false);
});
