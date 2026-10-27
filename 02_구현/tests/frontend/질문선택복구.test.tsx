import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {질문} from '../../src/frontend/화면/질문.js';
import {createMockSnapshot} from '../../src/shared/모의자료.js';
import type {Question} from '../../src/shared/포트.js';
afterEach(cleanup);
function question(kind:Question['kind'],allowFreeText=true){const q=createMockSnapshot('question').question!;q.kind=kind;q.items=q.items.map(i=>({...i,allowFreeText}));return q;}
it.each(['output_size','period_expansion'] as const)('기존 true인 앱 질문 %s도 선택 전용이다',kind=>{render(<질문 q={question(kind)} busy={false} onAnswer={vi.fn()}/>);expect(screen.queryByText('직접 입력')).not.toBeInTheDocument();expect(screen.getByText(/선택지로만 답변/)).toBeVisible();});
it('편집 질문의 false도 직접 입력을 숨긴다',()=>{render(<질문 q={question('editorial',false)} busy={false} onAnswer={vi.fn()}/>);expect(screen.queryByText('직접 입력')).not.toBeInTheDocument();});
it('편집 질문 true 자유 입력과 2000자 제한은 유지한다',()=>{const onAnswer=vi.fn();render(<질문 q={question('editorial')} busy={false} onAnswer={onAnswer}/>);fireEvent.click(screen.getByText('직접 입력'));fireEvent.change(screen.getByRole('textbox'),{target:{value:'검증 대상 독자'}});fireEvent.click(screen.getByRole('button',{name:'답변 저장'}));expect(onAnswer).toHaveBeenCalledWith([expect.objectContaining({text:'검증 대상 독자',optionIds:[]})]);});
