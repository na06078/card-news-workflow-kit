import {describe,it,expect} from 'vitest';
import {convertQuestion, sdkAnswer} from '../../src/providers/질문변환.js';
const original={questions:[{question:'누구에게 전달할까요?',header:'독자',options:[{label:'일반인',description:'개념'},{label:'개발자',description:'기술'}],multiSelect:true}]};
const meta={runId:'d1111111-1111-4111-8111-111111111111',toolUseId:'tool-test',createdAt:'2026-10-23T00:00:00Z'};
describe('OFFLINE 공식 SDK 질문/답변 mapping',()=>{
 it('원 질문 배열과 label 합침/자유 입력 원문 보존, 추천 자동응답 없음',()=>{
  const q=convertQuestion(original,meta);
  expect(q.question.items[0].recommendedOptionId).toBeNull();
  const item=q.question.items[0];
  expect(sdkAnswer(original,q,[{itemId:item.itemId,optionIds:item.options.map(o=>o.optionId),text:null}])).toEqual({questions:original.questions,answers:{'누구에게 전달할까요?':'일반인, 개발자'}});
  const result=sdkAnswer(original,q,[{itemId:item.itemId,optionIds:[],text:'  사용자 원문\n그대로  '}]);
  expect(result.answers['누구에게 전달할까요?']).toBe('  사용자 원문\n그대로  ');
 });
 it.each([{questions:[]},{questions:[original.questions[0],original.questions[0]]},{questions:[{...original.questions[0],options:[{label:'같음',description:'a'},{label:'같음',description:'b'}]}]}])('모호한 질문 거부 %j',input=>{
  expect(()=>convertQuestion(input,meta)).toThrowError(expect.objectContaining({code:'PROVIDER_PROTOCOL_ERROR'}));
 });
 it('모든 항목/선택 ID/singleSelect를 다시 확인',()=>{
  const input={questions:[{...original.questions[0],multiSelect:false}]};const q=convertQuestion(input,meta);const item=q.question.items[0];
  for(const a of [[],[{itemId:'wrong',optionIds:['a'],text:null}],[{itemId:item.itemId,optionIds:item.options.map(o=>o.optionId),text:null}]])expect(()=>sdkAnswer(input,q,a)).toThrow();
 });
});
