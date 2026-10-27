import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createSemanticReviewer} from '../dist/server/providers/의미검수.js';
import {buildSemanticReviewInput} from '../dist/server/providers/검수내용.js';
import {initializeOwnedScope,ownedDescendantsExited,closeOwnedScope} from '../dist/server/providers/프로세스격리.js';
const base='http://127.0.0.1:5173',pid='43daccac-2d26-4db1-bdd7-3b0e6416cd55',runId=randomUUID(),cwd=resolve('실행데이터/실사용검수복구/클로드실호출',runId);await mkdir(cwd,{recursive:true});
const boot=await fetch(base+'/api/bootstrap',{headers:{Origin:base}});if(!boot.ok)throw Error('BOOTSTRAP_FAILED');const cookie=boot.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),response=await fetch(base+'/api/projects/'+pid,{headers:{Origin:base,Cookie:cookie}});if(!response.ok)throw Error('SNAPSHOT_READ_FAILED');const p=(await response.json()).data;
if(p.factReview?.state!=='ready'||!p.factReview.proposal?.semanticReview)throw Error('EXISTING_ACTUAL_REVIEW_REQUIRED');
const input=buildSemanticReviewInput(p,p.factReview.proposal),selection={provider:'claude',model:p.claudeModel??null};let reviewer,report,errorCode;
try{
 await initializeOwnedScope();reviewer=createSemanticReviewer({selection,livePermission:{inference:true,approvalReference:'사용자: 물어보지말고 완수할때까지 계속 반복해; 기존7장 입력의 선택 가능한 Claude 검수만 확인, 저장/적용/승인 변경 없음'},onProgress:e=>console.log(JSON.stringify({status:e.status,provider:e.provider}))});
 report=await reviewer.review({projectId:pid,runId,attempt:1,cwd},input);await writeFile(resolve(cwd,'클로드검수응답.json'),JSON.stringify(report,null,2));
}catch(e){errorCode=e.code??'CLAUDE_VERIFICATION_FAILED';process.exitCode=1;}
finally{
 const cleanup=await reviewer?.dispose()??[],jobEmpty=await ownedDescendantsExited();const result={projectId:pid,runId,sourceRunId:p.factReview.runId,selection,actualModel:report?.actualModel??null,verdict:report?.verdict??null,reviewedCards:report?.reviewedCardIds.length??0,reviewedClaims:report?.reviewedClaimIndices.length??0,inputHash:report?.inputHash??null,errorCode:errorCode??null,cleanup:cleanup.map(r=>({status:r.status,children:r.children.map(c=>({identity:c.identityVerified,exit:c.exitConfirmed,descendants:c.descendantsConfirmed,evidence:c.evidence}))})),jobEmpty,appWrites:0,newSourceQueries:0,loginChanges:0};await writeFile(resolve(cwd,'실호출검증.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,resultPath:resolve(cwd,'실호출검증.json')}));if(jobEmpty)await closeOwnedScope();else{process.exitCode=1;throw Error('OWNED_REVIEW_SCOPE_NOT_EMPTY');}
}
