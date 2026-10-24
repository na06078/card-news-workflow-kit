// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {it,expect} from 'vitest';
import {act,screen} from '@testing-library/react';
it('정상 진입점은 고정된 생성 차단 문구 없이 계정 연결을 제공한다',async()=>{
 const root=document.createElement('div');root.id='root';document.body.replaceChildren(root);
 await act(async()=>{await import('../../src/main.js');});
 expect(screen.getByRole('button',{name:'계정 연결'})).toBeVisible();
 expect(screen.queryByText(/생성 차단 유지/)).not.toBeInTheDocument();
});
