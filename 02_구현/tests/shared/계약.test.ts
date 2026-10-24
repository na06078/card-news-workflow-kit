import { describe, it, expect } from 'vitest';
import { CreateProjectRequestSchema } from '../../src/shared/검증.js';
const id = 'b1111111-1111-4111-8111-111111111111';
describe('CN-1 생성 요청', () => {
  it('알 수 없는 필드를 거절한다', () => {
    expect(CreateProjectRequestSchema.safeParse({ topic: 'AI 최신소식', createRequestId: id, apiKey: '금지' }).success).toBe(false);
  });
  it('Unicode code point 500자 제한이며 입력을 trim하지 않는다', () => {
    expect(CreateProjectRequestSchema.safeParse({topic:'😀'.repeat(500),createRequestId:id}).success).toBe(true);
    expect(CreateProjectRequestSchema.safeParse({topic:'😀'.repeat(501),createRequestId:id}).success).toBe(false);
    expect(CreateProjectRequestSchema.parse({topic:' 주제 ',createRequestId:id})).toEqual({topic:' 주제 ',createRequestId:id,period:7});
  });
  it.each(['', 1, null])('빈 문자열과 비문자열을 거절한다: %s', topic => {
    expect(CreateProjectRequestSchema.safeParse({topic,createRequestId:id}).success).toBe(false);
  });
  it.each([0, 8, 365, '7'])('CN-1 밖 기간을 거절한다: %s', period => {
    expect(CreateProjectRequestSchema.safeParse({topic:'주제',createRequestId:id,period}).success).toBe(false);
  });
});
