/** CN-1 공개 DTO. 이 파일과 검증.ts만 의미 스키마이며 SDK 타입을 공개하지 않습니다. */
export const CONTRACT_VERSION = 'CN-1' as const;
export const DEFAULT_SIZE: Size = '1080x1080';
export type ReviewProvider = 'agy'|'claude';
export type ReviewEffort = 'high'|'medium'|'low';
export type ReviewSelection = {provider:ReviewProvider;model:string|null};
export const DEFAULT_FACT_REVIEWER:Readonly<ReviewSelection> = {provider:'agy',model:'gemini-3.8-flash-high'};
export type SemanticReviewIssue = {cardId:string|null;claimIndex:number|null;sourceIds:string[];message:string;suggestion:string|null};
export type SemanticReviewDecision = {verdict:'supported'|'unsupported'|'unverifiable';reviewedCardIds:string[];reviewedClaimIndices:number[];issues:SemanticReviewIssue[]};
export type SemanticReviewReport = SemanticReviewDecision & {reviewer:ReviewSelection;actualModel:string|null;reviewedAt:string;inputHash:string};
export type SemanticReviewInput = {projectId:string;cards:FactCardPatch[];claims:{claimIndex:number;claim:Claim}[];sources:Source[]};
export type ReviewContext = {projectId:string;runId:string;attempt:number;cwd:string};
export const LOCAL_SERVER = { host: '127.0.0.1', port: 8765, viteOrigin: 'http://127.0.0.1:5173' } as const;
export type Stage = 'topic'|'research'|'selection'|'editorial'|'storyboard'|'production'|'review'|'export';
export type RunStatus = 'queued'|'running'|'waiting_for_user'|'cancel_requested'|'succeeded'|'failed'|'canceled'|'interrupted';
export type ProjectStatus = 'idle'|'working'|'waiting_for_user'|'ready'|'approved'|'error'|'interrupted'|'canceled';
export type Size = '1080x1350'|'1080x1080';
export type NextAction = 'retry'|'answer'|'select'|'approve_storyboard'|'approve_final'|'revise'|'cancel'|'check_login'|'wait_quota'|'contact_user'|'reverify_facts'|'apply_fact_proposal'|'rebuild_exports'|'resume_fact_review';
export type AppError = {
  code:string;message:string;retryable:boolean;nextActions:NextAction[];
  projectId:string|null;runId:string|null;currentVersion:number|null;
  details:{field?:string;reason?:string;retryAfterSeconds?:number;requestOutcome?:'rejected'|'unknown'};
};
export type MutationReceipt = {projectId:string;projectVersion:number;runId:string|null;status:RunStatus|null;accepted:true};
export type Success<T> = {data:T};
export type Failure = {error:AppError};
export type Source = {sourceId:string;candidateId:string;url:string;title:string;
  publisher:string|null;publishedDate:string|null;eventDate:string|null;accessedAt:string|null;primary:boolean;
  access:'not_opened'|'opened'|'blocked'|'failed';evidence:string|null;limitations:string[]};
export type Claim = {text:string;sourceIds:string[];kind:'verified'|'publisher_claim'|'uncertain'|'conflicting';availability:'announced'|'released'|'unknown';conditions:string[]};
export type Candidate = {candidateId:string;researchVersion:number;eventKey:string;category:string;title:string;summary:string;publishedDate:string|null;eventDate:string|null;sourceIds:string[];selectionReason:string;uncertainties:string[]};
export type QuestionItem = {itemId:string;text:string;header:string;options:{optionId:string;label:string;description:string}[];multiSelect:boolean;allowFreeText:boolean;recommendedOptionId:string|null;recommendationReason:string|null};
export type Question = {questionId:string;version:number;runId:string|null;kind:'period_expansion'|'editorial'|'output_size';items:QuestionItem[];status:'open'|'answered'|'superseded'|'canceled';createdAt:string};
export type AnswerItem = {itemId:string;optionIds:string[];text:string|null};
export type CardPlan = {cardId:string;order:number;role:'cover'|'body'|'closing';title:string;body:string;sourceIds:string[];imagePlan:string};
export type Storyboard = {version:number;audience:string;rationale:string;format:string;hooks:string[];size:Size|null;cards:CardPlan[];approvedVersion:number|null};
export type CardLayout = {fontScale:'small'|'normal'|'large';textAlign:'left'|'center';placement:'top'|'bottom'};
export type CardRevision = CardPlan & {layout?:CardLayout;revision:number;imageAssetId:string|null;previewAssetId:string|null;state:'pending'|'generating'|'rendering'|'ready'|'failed';approvedRevision:number|null;error:AppError|null};
export type ManualApproval = {resultVersion:number;approvedAt:string;contentHash:string;warningsAcknowledged:true};
export type ResultVersion = {version:number;storyboardVersion:number;size:Size;cards:CardRevision[];factsCheck:'pending'|'passed'|'failed';visualCheck:'pending'|'passed'|'failed';finalApprovedVersion:number|null;semanticReview?:SemanticReviewReport;manualApproval?:ManualApproval};
/** AI 의견과 분리한 사용자 직접 확인의 공통 준비 조건입니다. 실제 승인·CAS는 Store만 수행합니다. */
export function canManuallyApprove(p:ProjectSnapshot):boolean {
 const r=p.result;
 return !!r&&p.stage==='review'&&r.cards.length>0&&!p.activeRun&&p.question?.status!=='open'&&r.finalApprovedVersion!==r.version&&r.visualCheck==='passed'&&r.cards.every(c=>c.state==='ready'&&!!c.imageAssetId&&!!c.previewAssetId)&&p.execution?.worker.state!=='unavailable';
}
export type FactSourceScope = {
 sourceId:string;country:string|null;event:string|null;period:string|null;population:string|null;
 metric:string|null;unit:string|null;value:string|null;aggregation:'point_in_time'|'cumulative'|'period'|'unknown';provisional:boolean|null;
};
export type FactFinding = {
 claimIndex:number;cardIds:string[];classification:'factual_error'|'scope_difference'|'unverifiable'|'explained_discrepancy'|'supported';
 reason:string;afterClaim:Claim;comparisons:FactSourceScope[];
};
export type FactCardPatch = Pick<CardPlan,'cardId'|'title'|'body'|'sourceIds'>;
export type FactSourceObservation = {
 sourceId:string;toolUseId:string;requestedUrl:string;url:string;statusCode:number|null;bytes:number|null;
 outcome:'opened'|'blocked'|'empty'|'failed'|'unconfirmed';observedAt:string;evidenceSha256:string|null;
};
export type FactProposalDraft = {kind:'factReview';sources:Source[];findings:FactFinding[];cards:FactCardPatch[]};
export type FactProposal = Omit<FactProposalDraft,'kind'> & {
 observations:FactSourceObservation[];beforeClaims:{claimIndex:number;claim:Claim}[];beforeCards:FactCardPatch[];semanticReview?:SemanticReviewReport;
};
export type FactReviewState = {
 runId:string;baseVersion:number;storyboardVersion:number;resultVersion:number|null;contentHash:string;
 claimIndices:number[];cardIds:string[];state:'pending'|'ready'|'applied';readyVersion:number|null;proposal:FactProposal|null;reviewer?:ReviewSelection;
};
export type FactIssue = {code:string;message:string;claimIndex:number|null;cardIds:string[];sourceIds:string[]};
/** 공개 요약에는 원문 처리 응답·관측 영수증·저장 경로를 포함하지 않습니다. */
export type FactRecoverySummary = {checkpointId:string;sourceRunId:string;step:'links'|'semantic';available:boolean;reason:string|null;issues:FactIssue[];savedAt:string};
export type FactFetchReceipt = Omit<FactSourceObservation,'sourceId'> & {result:string|null};
export type FactRepairObservation = {decision:FactLinkRepairDecision;actualModel:string|null;observedAt:string;originRunId:string};
export type FactCheckpointWrite = {step:'links'|'semantic';draft:FactProposalDraft;receipts:FactFetchReceipt[];issues:FactIssue[];repairObservation?:FactRepairObservation};
export type FactCheckpoint = FactCheckpointWrite & {checkpointId:string;projectId:string;sourceRunId:string;snapshotVersion:number;contentHash:string;savedAt:string;reviewer:ReviewSelection;requestedModel:string|null};
export type FactCheckpointImport = {sourceRunId:string;snapshotVersion:number;draft:FactProposalDraft;receipts:FactFetchReceipt[];sourceFileSha256:string};
export type FactLinkRepairDecision = {status:'repaired'|'unresolvable';links:{claimIndex:number;cardIds:string[]}[];reason:string};
export type FactLinkRepairInput = {snapshot:ProjectSnapshot;draft:FactProposalDraft;issues:FactIssue[]};
export type ExecutionState = {
 worker:{state:'unknown'|'ready'|'busy'|'unavailable';reason:string|null;checkedAt:string|null};
 queue:{blockingProjectId:string;reason:'running'|'waiting_for_user'|'cancel_requested'}|null;
};
export type Run = {runId:string;projectId:string;kind:'research'|'editorial'|'production'|'revision'|'export'|'factReview'|'factApply';status:RunStatus;attempt:number;phase:string;createdAt:string;updatedAt:string;lastEventSeq:number;questionId:string|null;error:AppError|null;externalOutcome:'not_started'|'known'|'unknown';retryAllowed:boolean;retryRequiresUnknownConfirmation?:boolean;requestedModel?:string|null;actualModel?:string};
export type ExportEntry = {exportId:string;projectId:string;resultVersion:number;kind:'png'|'zip'|'records';cardId:string|null;cardRevision:number|null;filename:string;mimeType:string;bytes:number;sha256:string;downloadUrl:string};
export type ProjectSnapshot = {projectId:string;topic:string;projectVersion:number;stage:Stage;status:ProjectStatus;claudeModel?:string|null;modelSettingsVersion?:number;
  period:{days:7|30;anchorAt:string;from:string;to:string};researchVersion:number;candidates:Candidate[];sources:Source[];claims:Claim[];
  selectedCandidateIds:string[];question:Question|null;storyboard:Storyboard|null;result:ResultVersion|null;activeRun:Run|null;lastRun:Run|null;allowedActions:NextAction[];exports:ExportEntry[];dataMode:'real'|'mock';factReview?:FactReviewState;factRecovery?:FactRecoverySummary;factIssues?:FactIssue[];execution?:ExecutionState};
export type EngineContext = {projectId:string;runId:string;attempt:number;engine:'claude-agent-sdk';engineSessionId:string|null;cwd:string;phase:'research'|'editorial'|'revision'|'factReview';baseProjectVersion:number;requestedModel?:string|null};
export type ProgressActivity = {provider:'claude'|'agy'|'app';operation:'authentication'|'search'|'fetch'|'planning'|'image'|'conversion'|'render'|'export';status:'started'|'completed'|'failed'|'waiting';cardId?:string;tool?:string};
export type EngineEvent = {seq:number;projectId:string;runId:string;attempt:number;at:string} & (
  {type:'progress';phase:string;message:string;completed:number|null;total:number|null;activity?:ProgressActivity;actualModel?:string} |
  {type:'need_input';question:Question} |
  {type:'result';kind:'candidates'|'storyboard'|'cards'|'exports'|'factReview';version:number} |
  {type:'error';error:AppError});
export type ChildCleanupEvidence = {
  pid:number|null;parentPid:number|null;executablePath:string|null;createdAt:string|null;
  identityVerified:boolean|null;exitConfirmed:boolean|null;descendantsConfirmed:boolean|null;
  evidence:'actual_os'|'test_double'|'unverified';
};
export type CleanupReport = {runId:string|null;status:'confirmed'|'not_started'|'failed'|'unknown';verifiedAt:string;reason:string|null;children:ChildCleanupEvidence[]};
export interface EngineAdapter {
  start(context:EngineContext,input:unknown):AsyncIterable<EngineEvent>;
  answer(context:EngineContext,questionId:string,version:number):Promise<void>;
  status(runId:string):Promise<Run>;
  cancel(runId:string):Promise<CleanupReport>;
}
export type RenderInput = {projectId:string;runId:string;attempt:number;resultVersion:number;card:CardRevision;size:Size;
  image:{assetId:string;absolutePath:string;sha256:string};researchAt:string;sourceLabels:{sourceId:string;label:string;url:string}[];
  font:{family:'Noto Sans KR';absolutePath:string;licenseAssetId:string};templateVersion:'cn-basic-1'|'cn-basic-2';outputPath:string};
export type RenderOutput = {projectId:string;resultVersion:number;cardId:string;cardRevision:number;path:string;mimeType:'image/png';width:1080;height:1350|1080;sha256:string;bytes:number;checks:{fontLoaded:boolean;imageDecoded:boolean;overflow:boolean};warnings:string[]};
export type CreateProjectRequest = {topic:string;createRequestId:string;period?:7|30;claudeModel?:string|null};
export type VersionRequest = {requestId:string;version:number};
export type SelectionRequest = VersionRequest & {candidateIds:string[]};
export type AnswerRequest = VersionRequest & {questionId:string;answer:AnswerItem[]};
export type ApproveRequest = VersionRequest & {stage:'storyboard'|'final';acknowledgeWarnings?:true};
export type RevisionRequest = VersionRequest & {cardIds:string[];instruction:string;scope:'storyboard'|'text'|'image'|'layout';renderOnly?:true};
export type CancelRequest = {requestId:string};
export type RetryRequest = VersionRequest & {confirmUnknownOutcome?:boolean};
export type CardApproveRequest = VersionRequest & {resultVersion:number};
export type FactReviewRequest = VersionRequest & {claimIndices:number[];cardIds:string[];reviewer?:ReviewProvider;reviewEffort?:ReviewEffort;resumeFromRunId?:string;checkpointId?:string};
export type FactApplyRequest = VersionRequest & {reviewRunId:string};
export type RebuildExportsRequest = VersionRequest;
export type MutationName = 'research'|'selection'|'answers'|'approve'|'revisions'|'cancel'|'retry'|'cardApprove'|'factReview'|'factApply'|'rebuildExports';
export interface RequestByMutation {
  research:VersionRequest;selection:SelectionRequest;answers:AnswerRequest;approve:ApproveRequest;
  revisions:RevisionRequest;cancel:CancelRequest;retry:RetryRequest;cardApprove:CardApproveRequest;
  factReview:FactReviewRequest;factApply:FactApplyRequest;rebuildExports:RebuildExportsRequest;
}
export interface ResponseByMutation {
  research:MutationReceipt;selection:MutationReceipt & {selectedCandidateIds:string[]};
  answers:MutationReceipt & {questionId:string;questionVersion:number};
  approve:MutationReceipt & {finalApprovedVersion?:number};revisions:MutationReceipt;
  cancel:MutationReceipt;retry:MutationReceipt;
  cardApprove:{projectId:string;projectVersion:number;cardId:string;approvedRevision:number};
  factReview:MutationReceipt;factApply:MutationReceipt;rebuildExports:MutationReceipt;
}
export type Bootstrap = {csrfToken:string;contractVersion:typeof CONTRACT_VERSION};
export type EventPage = {events:EngineEvent[];nextSeq:number;hasMore:boolean};
export type ExportList = {resultVersion:number;entries:ExportEntry[];exportRun:Run|null};
export const ERROR_HTTP = {
  REVIEW_TIMEOUT:504,FACT_FETCH_NOT_ATTEMPTED:502,
  MODEL_UNAVAILABLE:422,
  FACT_REVIEW_FAILED:502,FACT_PROPOSAL_STALE:409,FACT_SCOPE_INVALID:422,WORKER_UNAVAILABLE:503,
  PROJECT_DELETING:409,PROJECT_DELETE_FAILED:503,
  VALIDATION_ERROR:422,INVALID_JSON:400,PAYLOAD_TOO_LARGE:413,NOT_FOUND:404,LOCAL_REQUEST_DENIED:403,
  VERSION_CONFLICT:409,QUESTION_STALE:409,REQUEST_ID_CONFLICT:409,STAGE_CONFLICT:409,RUN_ACTIVE:409,FINAL_NOT_APPROVED:409,EXPORT_STALE:409,
  AUTH_PATH_FORBIDDEN:409,AUTH_MODE_UNKNOWN:409,LOGIN_REQUIRED:409,SUBSCRIPTION_EXPIRED:409,SUBSCRIPTION_QUOTA:429,
  PROCESS_SCOPE_UNVERIFIED:409,AGY_RATE_LIMIT:429,SEARCH_TOOL_UNAVAILABLE:409,TOOL_PERMISSION_DENIED:409,RESEARCH_FAILED:502,PROVIDER_PROTOCOL_ERROR:502,
  IMAGE_GENERATION_FAILED:502,ASSET_INVALID:502,RENDER_FAILED:502,STORAGE_BUSY:503,EXPORT_FAILED:500,
  SESSION_RECOVERY_UNVERIFIED:409,EXTERNAL_OUTCOME_UNKNOWN:409,CANCEL_CLEANUP_FAILED:500
} as const;
export type ErrorCode = keyof typeof ERROR_HTTP;
