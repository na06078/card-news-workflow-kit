import { createRoot } from 'react-dom/client';
import {App} from './frontend/App.js';
const root=document.getElementById('root');
if (!root) throw new Error('root 요소 없음');
createRoot(root).render(<App />);
