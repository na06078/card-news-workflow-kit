import {vi} from 'vitest';
import {resolve} from 'node:path';
// 기존 검사를 수정하지 않고 산출물만 이번 승인된 증거 경로로 격리합니다.
vi.mock('./도움.js',async original=>{const actual=await original<typeof import('./도움.js')>();return {...actual,setup:()=>actual.setup(resolve('실행데이터/리뷰보강/작업자연결/기존회귀'))};});
await import('./기동리스대기.test.js');
await import('./실행상태.test.js');
await import('./취소.test.js');
await import('./종료.test.js');
