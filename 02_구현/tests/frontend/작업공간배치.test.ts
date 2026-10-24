import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('본문 높이를 가두지 않고 기본 페이지 스크롤과 오른쪽 사용량 공간을 사용한다',()=>{
 const css=readFileSync('src/frontend/스타일.css','utf8');
 expect(css).not.toContain('grid-template-rows:auto minmax(0,1fr) auto');
 expect(css).toContain('grid-template-columns:minmax(0,1fr) var(--usage-width)');
 expect(css).toContain('.event-history ol{padding-left:24px;max-height:none;overflow:visible}');
 expect(css).toContain('.project-row');expect(css).toContain('min-height:48px');expect(css).toContain('.quota-main');
});
