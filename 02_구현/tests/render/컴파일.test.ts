import {test,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture,data} from './자료.js';
test('컴파일된 backend 모듈도 실제 APP 자산 경계와 CSS를 찾아 PNG를 만든다',async()=>{
 const input=await fixture('TEST-컴파일');await writeFile(resolve(data,'컴파일입력.json'),JSON.stringify(input,null,2));
 const compile=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','실행데이터/R1/tsconfig.compile.json'],{encoding:'utf8'});
 expect(compile.status,compile.stdout+compile.stderr).toBe(0);
 const run=spawnSync(process.execPath,['실행데이터/R1/컴파일검사.mjs'],{encoding:'utf8',env:process.env});
 await writeFile(resolve(data,'컴파일실행.log'),run.stdout+run.stderr);
 expect(run.status,run.stdout+run.stderr).toBe(0);
 const report=JSON.parse(await readFile(resolve(data,'컴파일검사.json'),'utf8'));expect(report.appRoot).toBe(resolve('.'));expect(report.width).toBe(1080);
},30000);
