import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {mkdir,open,readFile,writeFile,unlink} from 'node:fs/promises';
import {createAgyAdapter} from '../dist/server/providers/agy.js';
import {initializeOwnedScope,ownedDescendantsExited,closeOwnedScope} from '../dist/server/providers/프로세스격리.js';
const root=process.cwd(),budgetPath=resolve('실행데이터/가독성개선/이미지승인.json'),lock=await open(budgetPath+'.lock','wx'),runId=randomUUID(),dir=resolve('실행데이터/가독성개선/샘플',runId);await mkdir(dir,{recursive:true});
let adapter,budget,entry,errorCode,output;const controller=new AbortController();
try{
 budget=JSON.parse(await readFile(budgetPath,'utf8'));if(!budget.approved||budget.attempts.length>=budget.maxImageRequests)throw Object.assign(Error('BUDGET'),{code:'IMAGE_BUDGET_EXHAUSTED'});
 const base='http://127.0.0.1:5173',boot=await fetch(base+'/api/bootstrap',{headers:{Origin:base}}),cookie=boot.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),response=await fetch(base+'/api/projects/'+budget.projectId,{headers:{Origin:base,Cookie:cookie}});if(!response.ok)throw Object.assign(Error('SNAPSHOT'),{code:'SNAPSHOT_READ_FAILED'});const p=(await response.json()).data;if(p.activeRun)throw Object.assign(Error('ACTIVE'),{code:'RUN_ACTIVE'});
 const card=p.result.cards.find(c=>c.role==='cover')??p.result.cards[0];await initializeOwnedScope();
 const prompt=card.imagePlan+'\n구도 고정: 완성된 1080x1080 정사각형 그림의 주요 유럽 지도와 쟁점 아이콘 묶음의 시각적 중심을 가로50%, 위에서30%(아래에서70%)에 놓으세요. 모든 주요 객체는 대체로 위쪽55% 안에 모으고 아래쪽45%는 뉴스 원고를 합성할 조용하고 단순한 크림색 빈 공간으로 남기세요. 중앙/하단에 중요 객체를 놓지 마세요. 기존 편집 일러스트 스타일(크림색·네이비 윤곽·청록 포인트)을 유지하세요. 글자·숫자·라벨·날짜·URL·워터마크·뉴스회사 로고는 그림에 넣지 마세요. 실제 시위 사진으로 오인되는 실사 대신 지도/아이콘 일러스트만 만드세요. 정확히 한 번의 generate_image로 배경1장만 생성하고 변형/추가 이미지/자동 재생성은 하지 마세요.';
 adapter=createAgyAdapter({executablePath:resolve(homedir(),'AppData/Local/agy/bin/agy.EXE'),livePermission:{inference:true,search:true,image:true,approvalReference:budget.approvalReference}});
 entry={runId,startedAt:new Date().toISOString(),state:'reserved',folder:dir,projectVersion:p.projectVersion,resultVersion:p.result.version,cardId:card.cardId};budget.attempts.push(entry);await writeFile(budgetPath,JSON.stringify(budget,null,2));
 const timer=setTimeout(()=>controller.abort(),610000);
 try{output=await adapter.generate({projectId:p.projectId,runId,attempt:1,card:{...card,imagePlan:prompt},size:'1080x1080',attemptDir:dir,prompt,expectedFilename:'image.png'},controller.signal,e=>console.log(JSON.stringify({phase:e.phase,status:e.status,message:e.message})));}finally{clearTimeout(timer);}
 await writeFile(resolve(dir,'샘플자산.json'),JSON.stringify(output,null,2));entry.state='generated';entry.imagePath=output.asset.absolutePath;entry.sha256=output.asset.sha256;
}catch(e){errorCode=e.code??'SAMPLE_GENERATION_FAILED';if(entry){entry.state='failed';entry.errorCode=errorCode;}process.exitCode=1;}
finally{
 const cleanup=await adapter?.dispose()??[],jobEmpty=await ownedDescendantsExited();if(entry){entry.finishedAt=new Date().toISOString();entry.cleanup=cleanup.map(x=>({status:x.status,evidence:x.children.map(c=>c.evidence)}));await writeFile(budgetPath,JSON.stringify(budget,null,2));}
 const result={runId,generated:!!output,imagePath:output?.asset.absolutePath??null,errorCode:errorCode??null,jobEmpty,cleanup:cleanup.map(x=>x.status),appWrites:0,finalApproval:0,extraImageRequestsByHarness:0};await writeFile(resolve(dir,'생성결과.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(jobEmpty)await closeOwnedScope();else if(adapter){process.exitCode=1;throw Error('OWNED_SAMPLE_SCOPE_NOT_EMPTY');}await lock.close();await unlink(budgetPath+'.lock');
}
