import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const suite = process.argv[2];
const allowed = ['shared','frontend','backend','providers','render','worker','integration','e2e'];
if (!allowed.includes(suite)) { console.error('알 수 없는 suite'); process.exit(2); }
const dir = resolve('tests', suite === 'e2e' ? 'integration' : suite);
const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter(p => typeof p === 'string' && (suite === 'e2e' ? /\.spec\.tsx?$/.test(p) : /\.test\.tsx?$/.test(p)) && !p.includes('실검증')) : [];
if (!files.length) { console.error(`NOT_READY: ${suite} 실제 테스트 파일이 없습니다.`); process.exit(2); }
let extra = process.argv.slice(3);
let filter = [join('tests',suite)];
const checkpoint = extra.find(x => x.startsWith('--checkpoint='));
if (checkpoint) {
  const mapping = { storage:'저장연결', question:'질문연결', production:'제작연결', export:'수정출력' };
  const pattern = mapping[checkpoint.split('=')[1]];
  if (!pattern) { console.error('checkpoint는 storage|question|production|export'); process.exit(2); }
  extra = extra.filter(x => x !== checkpoint);
  filter = files.filter(p => p.includes(pattern)).map(p => join('tests',suite,p));
  if(!filter.length) { console.error(`NOT_READY: ${checkpoint} 실제 테스트 파일이 없습니다.`); process.exit(2); }
}
// 범위 지정 + 실검증 파일 제외. 공급자 모듈은 테스트가 명시적으로 주입한 offline 경계만 사용.
process.env.CARDNEWS_LIVE_CALLS = 'forbidden';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.브라우저');
const cli = suite === 'e2e' ? 'node_modules/@playwright/test/cli.js' : 'node_modules/vitest/vitest.mjs';
const args = suite === 'e2e' ? ['test', ...extra] : ['run', ...filter, ...(suite==='frontend'?['--environment','jsdom']:[]), ...extra];
const result = spawnSync(process.execPath, [cli,...args], { stdio:'inherit', env:process.env, shell:false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
