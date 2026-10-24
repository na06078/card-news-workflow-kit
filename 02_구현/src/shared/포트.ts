/**
 * S0 연결 지점. 소비자는 이 파일(재수출 DTO/validator 포함)을 읽습니다.
 * factory는 아래 지정 모듈에서 named export. 아직 구현이 있다는 뜻이 아닙니다.
 * DB commit/event seq 할당은 Store만. provider/render는 raw SQL/승인 변경 금지.
 */
import type { Express } from 'express';
import type { ReactElement } from 'react';
import type * as C from './계약.js';
import type {ProjectList,ModelSelectionRequest,ModelSelectionResponse,DeleteProjectRequest,DeleteProjectResponse} from './작업공간계약.js';
export * from './계약.js';
export * from './검증.js';
export type DeepReadonly<T> = T extends (...args:never[])=>unknown ? T : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
export type HttpReply<T> = {status:number;body:C.Success<T>|C.Failure;replayed:boolean};
export type Clock = ()=>string; // UTC ISO; 테스트는 명시 고정 clock 주입
export type IdFactory = ()=>string;
export type DataMode = 'real'|'mock';
export type MutationTarget = {projectId:string;runId?:string;cardId?:string};
/** method+정규 route+검증/default 적용 payload(requestId 제외)의 canonical bytes 비교.
 * replay 검사가 CAS보다 먼저. 최초 status/body를 완료 이후에도 그대로 재생.
 * 4xx 형식 오류는 원장 미소비, transaction 내 domain 거절은 저장.
 */
export type RequestIdentity = {method:'POST';route:string;requestId:string;canonical:string;sha256:string};
export type StoredReceipt = RequestIdentity & {projectId:string|null;status:number;body:unknown};
export type LeaseFence = {projectId:string;runId:string;ownerId:string;attempt:number;fencingToken:number;baseProjectVersion:number};
export type ClaimedJob = {fence:LeaseFence;leaseUntil:string;run:C.Run;snapshot:C.ProjectSnapshot;
  context:C.EngineContext|null;revision:C.RevisionRequest|null;attemptDir:string};
export type EventDraft = C.EngineEvent extends infer E ? E extends C.EngineEvent ? Omit<E,'seq'|'at'|'projectId'|'runId'|'attempt'> : never : never;
export type EngineContent =
 | {kind:'candidates';researchVersion:number;candidates:C.Candidate[];sources:C.Source[];shortageReason:string|null}
 | {kind:'storyboard';storyboard:C.Storyboard;sources:C.Source[];claims:C.Claim[]}
 | {kind:'cards';cards:C.CardRevision[];factsCheck:C.ResultVersion['factsCheck'];visualCheck:C.ResultVersion['visualCheck']};
export type ImageProvenance = {tool:'agy';toolVersion:string;generatedAt:string;prompt:string;illustrative:true;
  usageConditions:string;usageConditionsVerified:boolean;conversationId:string|null};
export type VerifiedAsset = {assetId:string;projectId:string;runId:string;attempt:number;kind:'image'|'preview'|'export'|'license';
  absolutePath:string;mimeType:string;bytes:number;sha256:string;width:number|null;height:number|null;provenance:ImageProvenance|null};
export type InvocationMark = {phase:string;cardId:string|null;state:'prepared'|'started'|'output_observed'|'validated'|'committed';expectedPath:string|null;sha256:string|null;at:string};
export type WorkerCommit =
 | {type:'content';content:EngineContent}
 | {type:'production';result:C.ResultVersion;assets:VerifiedAsset[]}
 | {type:'exports';resultVersion:number;entries:C.ExportEntry[];assets:VerifiedAsset[]}
 | {type:'failure';error:C.AppError;externalOutcome:C.Run['externalOutcome'];retryAllowed:boolean}
 | {type:'canceled';cleanupConfirmed:true};
/** 모든 worker 변경은 owner/attempt/fence/base version/lease/cancel 검증 후 원자 적용.
 * 진행/heartbeat만으로 projectVersion을 올리지 않음. 질문/결과 commit 뒤 새 base version 반환.
 * 변경된 fence는 이후 호출마다 사용. 오래된 fence는 예외/false로 거절하며 overwrite 금지.
 * B1이 상태 전이/부분수정의 불변 manifest·비대상 승인 보존을 구현합니다.
 */
export interface Store {
  deleteProject(projectId:string,input:DeleteProjectRequest):Promise<HttpReply<DeleteProjectResponse>>;
  listProjects():Promise<ProjectList>;
  setProjectModel(projectId:string,input:ModelSelectionRequest,validateModel?:(model:string|null)=>void):Promise<HttpReply<ModelSelectionResponse>>;
  createProject(input:C.CreateProjectRequest,validateModel?:(model:string|null)=>void):Promise<HttpReply<{projectId:string;projectVersion:number}>>;
  mutate<K extends C.MutationName>(name:K,target:MutationTarget,input:C.RequestByMutation[K]):Promise<HttpReply<C.ResponseByMutation[K]>>;
  getProject(projectId:string):Promise<C.ProjectSnapshot>;
  getRun(runId:string):Promise<C.Run>;
  getEvents(projectId:string,after:number,limit?:number):Promise<C.EventPage>;
  getExports(projectId:string):Promise<C.ExportList>;
  getAsset(projectId:string,assetId:string):Promise<VerifiedAsset>;
  getDownload(projectId:string,exportId:string):Promise<VerifiedAsset>;
  claimJob(input:{ownerId:string;now:string;leaseMs:number;dataMode:DataMode}):Promise<ClaimedJob|null>;
  heartbeat(fence:LeaseFence,input:{now:string;leaseMs:number}):Promise<boolean>;
  isCancelRequested(fence:LeaseFence):Promise<boolean>;
  appendEvent(fence:LeaseFence,event:EventDraft):Promise<C.EngineEvent>;
  saveQuestion(fence:LeaseFence,question:C.Question,mapping:QuestionMapping|null):Promise<{fence:LeaseFence;event:C.EngineEvent}>;
  /** 현재 질문의 저장 답변만 읽고, 그 답변 transaction으로 증가한 base version을 채택합니다.
   * owner/attempt/fencing/lease 및 질문 ID/version은 유지 검증. 임의 최신 버전 채택은 금지.
   */
  readAnswer(fence:LeaseFence,questionId:string,version:number):Promise<{answer:C.AnswerItem[];fence:LeaseFence}|null>;
  markAnswerDelivered(fence:LeaseFence,questionId:string,version:number):Promise<LeaseFence>;
  saveSession(fence:LeaseFence,sessionId:string,cwd:string):Promise<void>;
  journal(fence:LeaseFence,mark:InvocationMark):Promise<void>;
  /** terminal은 같은 transaction에서 phase=terminal_commit/state=committed를 단일 기록.
   * 이 예약 phase를 journal로 선기록/사후 기록하지 않습니다. 실패시 결과·상태·event도 rollback. */
  commit(fence:LeaseFence,result:WorkerCommit):Promise<{fence:LeaseFence;event:C.EngineEvent|null}>;
  reconcile(input:{now:string}):Promise<{interruptedRunIds:string[];orphanAssetIds:string[]}>;
  close():Promise<void>;
}
export type StoreOptions = {dbPath:string;dataDir:string;dataMode:DataMode;clock?:Clock;idFactory?:IdFactory;busyTimeoutMs?:number;deleteProjectFiles?:(dataDir:string,projectId:string)=>Promise<void>};
/** B1 src/backend/저장소.ts */
export type CreateStore = (options:StoreOptions)=>Promise<Store>;
export type AppOptions = {store:Store;dataDir:string;allowedOrigins:readonly string[];allowedHosts:readonly string[];staticDir?:string;clock?:Clock};
/** B1 src/backend/앱.ts. factory는 listen하지 않음. bootstrap이 loopback listen/서버 close 담당.
 * store 수명도 호출자 소유. HTTP는 job 접수만; provider를 import/호출하지 않음.
 */
export type CreateApp = (options:AppOptions)=>Express;
export type QuestionMapping = {toolUseId:string;items:{itemId:string;originalQuestion:string;options:{optionId:string;label:string}[]}[]};
export type ProviderQuestion = {question:C.Question;mapping:QuestionMapping};
/** W1이 run별 closure로 구현, G1에 전달. 질문/답변은 DB; 메모리 callback만 영속이라고 주장하지 않음.
 * publishResult는 Store.commit(content) 완료 뒤 seq 있는 result event 반환.
 * EngineAdapter.start가 yield하는 이벤트는 이 bridge에서 이미 commit한 것만, W1이 재append하지 않음.
 * start 종료만으로 성공 아님: 유효 result 또는 명시 오류가 필수.
 */
export interface ProviderBridge {
  progress(context:C.EngineContext,event:Extract<EventDraft,{type:'progress'}>):Promise<C.EngineEvent>;
  openQuestion(context:C.EngineContext,input:ProviderQuestion):Promise<C.EngineEvent>;
  waitForAnswer(context:C.EngineContext,questionId:string,version:number,signal:AbortSignal):Promise<C.AnswerItem[]>;
  publishResult(context:C.EngineContext,content:EngineContent):Promise<C.EngineEvent>;
  publishError(context:C.EngineContext,error:C.AppError):Promise<C.EngineEvent>;
  saveSession(context:C.EngineContext,sessionId:string):Promise<void>;
  status(runId:string):Promise<C.Run>;
}
export type LivePermission = {inference:false;search:false;image:false} | {inference:true;search:true;image:true;approvalReference:string};
export type AuthAttestation = {mode:'subscription_oauth';sdkVersion:string;verifiedAt:string;settingsFingerprint:string;
  sameChildId:string;evidence:string[];usageCreditsDisabled:{confirmedAt:string;reference:string}};
/** active auth attestation은 G1이 같은 자식에서 직접 검증해 내부 보유합니다.
 * 호출자가 전달한 객체를 양성 인증으로 신뢰하지 않습니다. 크레딧 근거만 비밀 없이 입력.
 */
export type ClaudeOptions = {bridge:ProviderBridge;livePermission:LivePermission;usageCreditsDisabled?:AuthAttestation['usageCreditsDisabled'];
  clock?:Clock;signal?:AbortSignal};
export interface ClaudeAdapter extends C.EngineAdapter {dispose():Promise<C.CleanupReport[]>}
/** G1 src/providers/클로드.ts. 네트워크/자식 실행은 start 내부 승인 게이트 이후만. */
export type CreateClaudeAdapter = (options:ClaudeOptions)=>ClaudeAdapter;
export type AgyInput = {projectId:string;runId:string;attempt:number;card:C.CardRevision;size:C.Size;
  attemptDir:string;prompt:string;expectedFilename:'image.png'};
export type AgyOutput = {asset:VerifiedAsset;provenance:ImageProvenance};
export type AgyProgress = {phase:string;message:string;status:'started'|'completed'|'failed'|'waiting'};
export type AgyProgressCallback = (event:AgyProgress)=>Promise<void>|void;
export interface AgyAdapter {generate(input:DeepReadonly<AgyInput>,signal:AbortSignal,onProgress?:AgyProgressCallback):Promise<AgyOutput>;cancel(runId:string):Promise<C.CleanupReport>;dispose():Promise<C.CleanupReport[]>}
/** G1 src/providers/agy.ts. shell:false, 별도 직접 연결. 자동 mock fallback 없음. */
export type CreateAgyAdapter = (options:{executablePath:string;livePermission:LivePermission;clock?:Clock})=>AgyAdapter;
export type RenderOptions = {signal?:AbortSignal;browserExecutablePath?:string};
/** R1 src/render/렌더러.ts. 함수가 열었던 browser/context는 finally close, DB 권한 없음. */
export type RenderCard = (input:DeepReadonly<C.RenderInput>,options?:RenderOptions)=>Promise<C.RenderOutput>;
export type ExportInput = {projectId:string;runId:string;attempt:number;result:C.ResultVersion;
  manifest:readonly {cardId:string;revision:number;order:number;asset:VerifiedAsset}[];
  period:C.ProjectSnapshot['period'];sources:C.Source[];claims:C.Claim[];
  imageRecords:{cardId:string;cardRevision:number;image:VerifiedAsset;provenance:ImageProvenance}[];fontLicensePath:string;outputDir:string};
export type ExportOutput = {projectId:string;resultVersion:number;entries:C.ExportEntry[];assets:VerifiedAsset[]};
/** R1 src/render/내보내기.ts. 현재 승인 manifest 검증/파일 생성만; B1 commit 후 목록 노출. */
export type BuildExport = (input:DeepReadonly<ExportInput>,options?:{signal?:AbortSignal})=>Promise<ExportOutput>;
export type WorkerOptions = {store:Store;dataDir:string;ownerId:string;dataMode:DataMode;
  createClaudeAdapter:CreateClaudeAdapter;claudeOptions:Omit<ClaudeOptions,'bridge'|'signal'>;
  agy:AgyAdapter;renderCard:RenderCard;buildExport:BuildExport;
  font:{family:'Noto Sans KR';absolutePath:string;licenseAssetId:string};fontLicensePath:string;
  clock?:Clock;leaseMs?:number;heartbeatMs?:number;pollMs?:number};
export interface Worker {start():Promise<void>;tick():Promise<boolean>;stop():Promise<void>;dispose():Promise<void>}
/** W1 src/worker/작업자.ts. start는 loop 준비 후 resolve, tick은 최대 한 claim 처리.
 * stop/dispose는 자신이 만든 SDK adapter·자식 정리까지 대기; 공유 store.close는 호출자 담당.
 * dataMode real에서 fixture/provider mock 주입은 금지. max external concurrency=1은 안전한 초기 제한.
 */
export type CreateWorker = (options:WorkerOptions)=>Worker;
/** 프론트 API는 data를 반환, 실패는 status+AppError를 가진 객체를 throw. credentials는 브라우저 쿠키만. */
export type ClientFailure = {status:number;error:C.AppError};
export interface FrontendClient {
  bootstrap():Promise<C.Bootstrap>;
  createProject(input:C.CreateProjectRequest):Promise<{projectId:string;projectVersion:number}>;
  getProject(projectId:string):Promise<C.ProjectSnapshot>;
  mutate<K extends C.MutationName>(name:K,target:MutationTarget,input:C.RequestByMutation[K]):Promise<C.ResponseByMutation[K]>;
  getRun(runId:string):Promise<C.Run>;
  getEvents(projectId:string,after:number):Promise<C.EventPage>;
  getExports(projectId:string):Promise<C.ExportList>;
}
export type AppProps = {client?:FrontendClient;initialProjectId?:string;dataMode?:DataMode};
/** F1 src/frontend/App.tsx: named App (default 추가 가능). 미주입 시 실제 HTTP만, mock 자동대체 금지. */
export type FrontendApp = (props:AppProps)=>ReactElement;
