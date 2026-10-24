import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateAnswer, type ProviderQuestion, type AnswerItem} from '../shared/포트.js';
import {fail} from './오류.js';
const nonempty=z.string().min(1).max(4000);
const questionInput=z.object({questions:z.array(z.object({question:nonempty,header:z.string().min(1).max(12),options:z.array(z.object({label:nonempty,description:nonempty,preview:z.string().optional()})).min(2).max(4).refine(a=>new Set(a.map(x=>x.label)).size===a.length),multiSelect:z.boolean()})).min(1).max(4).refine(a=>new Set(a.map(x=>x.question)).size===a.length)});
function parse(input:unknown){const p=questionInput.safeParse(input);return p.success?p.data:fail('PROVIDER_PROTOCOL_ERROR');}
export function convertQuestion(input:unknown,meta:{runId:string;toolUseId:string;createdAt:string}):ProviderQuestion {
 const original=parse(input);if(!meta.toolUseId)fail('PROVIDER_PROTOCOL_ERROR');
 const items=original.questions.map((q,i)=>({itemId:`q${i}`,text:q.question,header:q.header,options:q.options.map((o,j)=>({optionId:`o${j}`,label:o.label,description:o.description})),multiSelect:q.multiSelect,allowFreeText:true as const,recommendedOptionId:null,recommendationReason:null}));
 return {question:{questionId:randomUUID(),version:1,runId:meta.runId,kind:'editorial',items,status:'open',createdAt:meta.createdAt},mapping:{toolUseId:meta.toolUseId,items:items.map(q=>({itemId:q.itemId,originalQuestion:q.text,options:q.options.map(o=>({optionId:o.optionId,label:o.label}))}))}};
}
export function sdkAnswer(original:unknown,pending:ProviderQuestion,answer:AnswerItem[]):{questions:unknown[];answers:Record<string,string>} {
 const input=parse(original);
 try{validateAnswer(pending.question,{questionId:pending.question.questionId,version:pending.question.version,requestId:randomUUID(),answer});}catch{return fail('PROVIDER_PROTOCOL_ERROR');}
 const answers:Record<string,string>=Object.create(null);
 for(const map of pending.mapping.items){
  const a=answer.find(x=>x.itemId===map.itemId)!;
  answers[map.originalQuestion]=a.text??a.optionIds.map(id=>map.options.find(o=>o.optionId===id)!.label).join(', ');
 }
 // 검증 전 원본 객체는 별도로 보존. preview 등 원본 필드 손실 없이 공식 updatedInput 구성.
 const raw=original as {questions:unknown[]};
 if(input.questions.some(q=>!(q.question in answers)))return fail('PROVIDER_PROTOCOL_ERROR');
 return {questions:raw.questions,answers};
}
