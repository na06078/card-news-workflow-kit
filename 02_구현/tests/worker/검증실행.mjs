import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const app=process.cwd(),data=resolve('실행데이터/W1');mkdirSync(join(data,'임시'),{recursive:true});
const node=resolve('.도구/node-v24.22.1-win-x64/node.exe');
const env={...process.env,CARDNEWS_LIVE_CALLS:'forbidden',PLAYWRIGHT_BROWSERS_PATH:resolve('.브라우저'),TEMP:join(data,'임시'),TMP:join(data,'임시'),npm_config_userconfig:resolve('.도구/npmrc'),npm_config_globalconfig:resolve('.도구/global-npmrc'),npm_config_cache:join(data,'npm-cache')};
const commands=[
 ['worker',['scripts/오프라인검증.mjs','worker','--reporter=json','--outputFile=실행데이터/W1/최종-worker.json']],
 ['영향회귀',['node_modules/vitest/vitest.mjs','run','tests/shared','tests/providers/정리보고.test.ts','tests/providers/클로드.test.ts','tests/providers/agy파일.test.ts','tests/providers/실호출감사.test.ts','--reporter=json','--outputFile=실행데이터/W1/최종-영향회귀.json']],
 ['typecheck',['node_modules/typescript/bin/tsc','--noEmit','-p','tests/worker/tsconfig.json']]
];const tests=[];
for(const [name,args]of commands){const startedAt=new Date().toISOString();const r=spawnSync(node,args,{cwd:app,env,encoding:'utf8',shell:false,timeout:120000});const log=join(data,`최종-${name}.log`);writeFileSync(log,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));const item={name,command:[node,...args],cwd:app,exit:r.status,startedAt,endedAt:new Date().toISOString(),log};tests.push(item);console.log(name,r.status);}
const changedFiles=['src/shared/계약.ts','src/shared/포트.ts','src/providers/정리증거.ts','src/providers/클로드.ts','src/providers/agy.ts','src/worker/작업자.ts','src/worker/실행단계.ts','src/worker/제작.ts','src/worker/검수.ts','src/worker/프로세스관리.ts','tests/providers/정리보고.test.ts','tests/providers/클로드.test.ts','tests/providers/agy파일.test.ts','tests/providers/실호출감사.test.ts','tests/worker/작업자.test.ts','tests/worker/도움.ts','tests/worker/질문대기.test.ts','tests/worker/제작.test.ts','tests/worker/취소.test.ts','tests/worker/복구.test.ts','tests/worker/프로세스.test.ts','tests/worker/테스트자식.mjs','tests/worker/경계정리.test.ts','tests/worker/종료.test.ts','tests/worker/tsconfig.json','tests/worker/검증실행.mjs'];
const result={status:'PARTIAL_NEEDS_CONTRACT_DECISION',app,tests_run:tests,changed_files:changedFiles.map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(p)).digest('hex')})),scratch_files:[],decisions:['실제 B1 Store 사용, 공급자/렌더만 명시 주입','SDK/agy 실호출 및 인증 명령 0회','실제 Node toy만 소유 ChildProcess로 종료; 후손 증거 null은 unknown','terminal committed journal을 선기록하지 않음'],unverified:['layout 지시 전달 경계 없음; 현재는 대상 고정 템플릿 재렌더만 가능','terminal committed journal row: B1 commit 성공 event만 존재','실제 SDK pending 질문 resume·구독 인증·검색·agy 실행/취소','연속 OS 후손 추적/정리 증명','추가 취소/commit·렌더중 취소·작업 무응답 timeout 통합 시나리오 일부 미검증','전체 앱/AC 및 I2 조립 미검증']};writeFileSync(join(data,'재개실행결과.json'),JSON.stringify(result,null,2));process.exitCode=tests.every(t=>t.exit===0)?0:1;
