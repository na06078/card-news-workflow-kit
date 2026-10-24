import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('전체 폭 목록과 축소 사용량을 독립 행으로 배치하며 과거 사이드바 제약을 제거한다',()=>{const css=readFileSync('src/frontend/스타일.css','utf8');expect(css).toContain('grid-template-rows:auto minmax(0,1fr) auto');expect(css).toContain('.project-row');expect(css).toContain('min-height:48px');expect(css).toContain('.quota-main');expect(css).not.toContain('grid-template-columns:300px minmax(0,1fr)');expect(css).not.toContain('padding-bottom:calc(260px');});
