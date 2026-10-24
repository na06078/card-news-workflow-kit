/** 명시 offline fixture만. real bootstrap/provider는 import 금지. */
import type { ProjectSnapshot,Run,Question,Storyboard,ResultVersion,ExportEntry } from './계약.js';
import { ProjectSnapshotSchema } from './검증.js';
export const MOCK_IDS={project:'a1111111-1111-4111-8111-111111111111',candidate:'b1111111-1111-4111-8111-111111111111',source:'c1111111-1111-4111-8111-111111111111',run:'d1111111-1111-4111-8111-111111111111',question:'e1111111-1111-4111-8111-111111111111',card:'f1111111-1111-4111-8111-111111111111',image:'a2222222-2222-4222-8222-222222222222',preview:'b2222222-2222-4222-8222-222222222222',export:'c2222222-2222-4222-8222-222222222222'} as const;
export const MOCK_NOTICE='모의 데이터 · 실제 조사/생성 아님';
export type MockStage='topic'|'selection'|'question'|'storyboard'|'review'|'export';
export function createMockSnapshot(stage:MockStage='topic'):ProjectSnapshot {
 const id=MOCK_IDS, at='2026-10-23T00:00:00Z';
 const p:ProjectSnapshot={projectId:id.project,topic:'[모의] AI 최신소식',projectVersion:1,stage:'topic',status:'idle',period:{days:7,anchorAt:at,from:'2026-10-16T00:00:00Z',to:at},researchVersion:0,candidates:[],sources:[],claims:[],selectedCandidateIds:[],question:null,storyboard:null,result:null,activeRun:null,lastRun:null,allowedActions:[],exports:[],dataMode:'mock'};
 if(stage==='topic') return p;
 p.projectVersion=2;p.stage='selection';p.status='ready';p.researchVersion=1;p.allowedActions=['select'];
 p.candidates=[{candidateId:id.candidate,researchVersion:1,eventKey:'mock-announcement',category:'모의 제품',title:'[모의] 발표 후보',summary:'실제 뉴스가 아닌 테스트용 후보입니다.',publishedDate:null,eventDate:null,sourceIds:[id.source],selectionReason:'선택 동작 확인',uncertainties:['실제 검색하지 않았습니다.']}];
 p.sources=[{sourceId:id.source,candidateId:id.candidate,url:'https://example.org/mock-report',title:'모의 원문',publisher:null,publishedDate:null,eventDate:null,accessedAt:null,primary:true,access:'not_opened',evidence:null,limitations:['원문을 열지 않은 모의 출처입니다.']}];
 if(stage==='selection') return ProjectSnapshotSchema.parse(p);
 const run:Run={runId:id.run,projectId:id.project,kind:'editorial',status:'waiting_for_user',attempt:1,phase:'editorial',createdAt:at,updatedAt:at,lastEventSeq:1,questionId:id.question,error:null,externalOutcome:'not_started',retryAllowed:false};
 const question:Question={questionId:id.question,version:1,runId:id.run,kind:'editorial',items:[{itemId:'audience',text:'어떤 독자에게 전달할까요?',header:'독자',options:[{optionId:'public',label:'일반 사용자',description:'쉬운 개념 중심'},{optionId:'developer',label:'개발자',description:'활용과 기술 중심'}],multiSelect:false,allowFreeText:true,recommendedOptionId:'public',recommendationReason:'입문 설명에 적합'}],status:'open',createdAt:at};
 p.selectedCandidateIds=[id.candidate];p.projectVersion=3;
 if(stage==='question') {p.stage='editorial';p.status='waiting_for_user';p.activeRun=run;p.question=question;p.allowedActions=['answer','cancel'];return ProjectSnapshotSchema.parse(p);}
 const storyboard:Storyboard={version:1,audience:'일반 사용자',rationale:'모의 기획',format:'한 가지 소식 설명',hooks:['모의 소식을 살펴봐요','실제 조사가 아닌 화면 예시'],size:'1080x1080',cards:[{cardId:id.card,order:1,role:'cover',title:'모의 카드',body:'실제 생성물이 아닙니다.',sourceIds:[id.source],imagePlan:'텍스트 없는 설명용 모의 그림'}],approvedVersion:null};
 p.stage='storyboard';p.status='ready';p.storyboard=storyboard;p.projectVersion=4;p.allowedActions=['approve_storyboard','revise'];
 p.lastRun={...run,status:'succeeded',questionId:null};
 if(stage==='storyboard') return ProjectSnapshotSchema.parse(p);
 const result:ResultVersion={version:1,storyboardVersion:1,size:'1080x1080',cards:[{...storyboard.cards[0]!,revision:1,imageAssetId:id.image,previewAssetId:id.preview,state:'ready',approvedRevision:null,error:null}],factsCheck:'passed',visualCheck:'passed',finalApprovedVersion:null};
 p.storyboard.approvedVersion=1;p.result=result;p.stage='review';p.projectVersion=5;p.allowedActions=['approve_final','revise'];
 if(stage==='review') return ProjectSnapshotSchema.parse(p);
 p.stage='export';p.status='approved';p.projectVersion=6;result.finalApprovedVersion=1;result.cards[0]!.approvedRevision=1;p.allowedActions=['revise'];
 const entry:ExportEntry={exportId:id.export,projectId:id.project,resultVersion:1,kind:'zip',cardId:null,cardRevision:null,filename:'모의-카드.zip',mimeType:'application/zip',bytes:1,sha256:'0'.repeat(64),downloadUrl:`/api/projects/${id.project}/exports/${id.export}/download`};
 // 실제 파일/다운로드 성공 fixture가 아닙니다. mock URL은 실제 서버로 보내지 마세요.
 p.exports=[entry];return ProjectSnapshotSchema.parse(p);
}
