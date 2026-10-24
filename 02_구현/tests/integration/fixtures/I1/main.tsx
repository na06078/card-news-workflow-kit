import {createRoot} from 'react-dom/client';
import {App} from '../../../../src/frontend/App.js';
// App 기본 real HTTP 경로. snapshot의 mock 표시는 실제 SQLite에 저장한 합성 자료 출처 고지.
createRoot(document.getElementById('root')!).render(<App/>);
