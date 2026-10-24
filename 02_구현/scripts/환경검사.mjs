import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
const require = createRequire(import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.브라우저');
const { chromium } = await import('playwright');
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const installed={};
for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})) {
  // export map에 package.json이 없는 패키지는 lock의 실제 해석 결과 사용.
  const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  installed[name]=lock.packages['node_modules/'+name].version;
}
const dbPath=resolve('실행데이터/S0/환경검사.sqlite');
const db=new Database(dbPath); db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT OR REPLACE INTO probe VALUES (?,?)').run(1,'한글 SQLite 지속'); db.close();
const reopened=new Database(dbPath); const persisted=reopened.prepare('SELECT value FROM probe WHERE id=1').get();
const sqlite=reopened.prepare('SELECT sqlite_version() AS version').get(); reopened.close();
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/*',r=>r.abort());
 const font=readFileSync('.도구/글꼴/NotoSansKR.woff2').toString('base64');
 await page.setContent(`<style>@font-face{font-family:'Noto Sans KR';src:url(data:font/woff2;base64,${font})}body{font-family:'Noto Sans KR'}</style><p>카드뉴스 한글 글꼴 확인</p>`);
 await page.evaluate(()=>document.fonts.ready);
 const fontLoaded=await page.evaluate(()=>document.fonts.check('16px "Noto Sans KR"','카드뉴스 한글'));
 if(!fontLoaded) throw new Error('폰트 로드 실패');
 const record={node:process.version,executable:process.execPath,abi:process.versions.modules,npm:require('../.도구/node-v24.22.1-win-x64/node_modules/npm/package.json').version,installed,sqlite,persisted,dbPath,browserVersion:browser.version(),browserExecutable:chromium.executablePath(),fontPath:resolve('.도구/글꼴/NotoSansKR.woff2'),fontLoaded,liveCalls:0};
 writeFileSync('실행데이터/S0/환경검사.json',JSON.stringify(record,null,2)); console.log(JSON.stringify(record,null,2));
} finally { await browser.close(); }
