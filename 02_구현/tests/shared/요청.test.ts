import { describe,it,expect } from 'vitest';
import * as boundary from '../../src/shared/검증.js';
const api = boundary as Record<string, any>;
const id='b1111111-1111-4111-8111-111111111111';
describe('mutation 경계', () => {
  it('각 요청 스키마를 제공하며 잘못된 enum/version/중복을 거절한다', () => {
    expect(api.SelectionRequestSchema).toBeDefined();
    expect(api.SelectionRequestSchema.safeParse({requestId:id,version:1,candidateIds:[id]}).success).toBe(true);
    for (const candidateIds of [[],[id,id],[id,id,id,id],['외부ID']])
      expect(api.SelectionRequestSchema.safeParse({requestId:id,version:1,candidateIds}).success).toBe(false);
    for(const version of [0,-1,1.2,'1',null])
      expect(api.VersionRequestSchema.safeParse({requestId:id,version}).success).toBe(false);
    expect(api.ApproveRequestSchema.safeParse({requestId:id,version:1,stage:'production'}).success).toBe(false);
    expect(api.RevisionRequestSchema.safeParse({requestId:id,version:1,cardIds:[id],instruction:'😀'.repeat(4000),scope:'text'}).success).toBe(true);
    expect(api.RevisionRequestSchema.safeParse({requestId:id,version:1,cardIds:[id],instruction:'x'.repeat(4001),scope:'text'}).success).toBe(false);
  });
  it('답변은 자유문자열 또는 선택지 중 하나만 받는다', () => {
    expect(api.AnswerRequestSchema).toBeDefined();
    const base={requestId:id,version:1,questionId:id};
    for(const answer of [[{itemId:'audience',optionIds:[],text:'교육자'}],[{itemId:'audience',optionIds:['teacher'],text:null}]])
      expect(api.AnswerRequestSchema.safeParse({...base,answer}).success).toBe(true);
    for(const answer of [[],[{itemId:'audience',optionIds:[],text:null}],[{itemId:'audience',optionIds:['teacher'],text:'둘다'}],[{itemId:'audience',optionIds:['teacher','teacher'],text:null}]])
      expect(api.AnswerRequestSchema.safeParse({...base,answer}).success).toBe(false);
  });
});
