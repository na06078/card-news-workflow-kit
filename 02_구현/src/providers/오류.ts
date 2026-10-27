import type {AppError,EngineContext,ErrorCode} from '../shared/포트.js';
export class ProviderFailure extends Error {
 readonly code:ErrorCode;
 constructor(code:ErrorCode,readonly details:{retryAfterSeconds?:number}={}){super(code);this.name='ProviderFailure';this.code=code;}
}
export function fail(code:ErrorCode):never {throw new ProviderFailure(code);}
/** 원시 stdout/stderr/SDK 오류 문장은 공개 이벤트에 복사하지 않습니다. */
export function appError(error:unknown,context?:EngineContext):AppError {
 const code=error instanceof ProviderFailure?error.code:'PROVIDER_PROTOCOL_ERROR';
 const recoveryMessages:Partial<Record<ErrorCode,string>>={
  REVIEW_TIMEOUT:'검수 엔진의 응답을 제한 시간 안에 확인하지 못했습니다. 원고·그림·기존 승인은 유지됩니다. 선택 항목을 확인해 새 검수를 요청할 수 있으며 사용량이 추가로 소모될 수 있습니다.',
  FACT_FETCH_NOT_ATTEMPTED:'원문 확인을 실제로 시도하지 않아 재검증을 중단했습니다. 기존 원고와 근거는 보존됩니다. 선택 항목의 원문을 확인하는 새 재검증을 요청해 주세요.',
  MODEL_UNAVAILABLE:'선택한 모델을 사용할 수 없습니다. 모델과 계정 접근 권한을 확인해 주세요. 다른 모델로 자동 전환하지 않았습니다.',
  FACT_REVIEW_FAILED:'사실 재검증 결과의 범위·근거 검증에 실패했습니다. 문제 항목과 원문 접근 결과를 확인해 주세요.',
  FACT_PROPOSAL_STALE:'다른 수정 이후의 이전 제안입니다. 최신 상태와 수정안을 다시 확인해 주세요.',
  FACT_SCOPE_INVALID:'선택한 주장·카드 범위를 확인해 주세요. 현재 프로젝트의 대상만 재검증할 수 있습니다.',
  WORKER_UNAVAILABLE:'작업 처리기를 사용할 수 없습니다. 모델 요청을 반복하기 전에 처리기 상태와 남은 정리 작업을 확인해 주세요.',
 };
 const message:Partial<Record<ErrorCode,string>>={SEARCH_TOOL_UNAVAILABLE:'필요한 검색 도구를 사용할 수 없어 조사를 진행하지 않았습니다. 현재 계정의 검색 도구 제공 여부와 권한을 확인해 주세요. 다른 엔진으로 자동 전환하지 않습니다.',RESEARCH_FAILED:'조사·기획 결과의 출처 연결 또는 내용 검증에 실패했습니다.',PROCESS_SCOPE_UNVERIFIED:'앱 소유 프로세스의 격리 상태를 확인하지 못해 실행을 시작하지 않았습니다.',AGY_RATE_LIMIT:'이미지 도구가 요청 제한을 반환했습니다. 계정 전체 구독 소진 여부는 확인되지 않았습니다.',LOGIN_REQUIRED:'공식 로그인 상태를 확인해 주세요.',IMAGE_GENERATION_FAILED:'이미지 생성 완료 또는 결과 파일을 확인하지 못했습니다.',ASSET_INVALID:'그림 파일의 경로·형식·무결성 검증에 실패했습니다.',RENDER_FAILED:'카드 렌더 또는 글자 배치 검증에 실패했습니다.',EXPORT_FAILED:'내보내기 파일 생성에 실패했습니다.',PROVIDER_PROTOCOL_ERROR:'공급자 응답 형식 또는 실행 식별 검증에 실패했습니다.',AUTH_MODE_UNKNOWN:'본인 구독 인증·추가 과금 없음이 확인되지 않아 호출을 차단했습니다.',AUTH_PATH_FORBIDDEN:'허용되지 않은 인증·과금 경로입니다.',SUBSCRIPTION_QUOTA:'구독 한도에 도달했습니다. 다른 엔진으로 전환하지 않습니다.',TOOL_PERMISSION_DENIED:'필요한 도구 권한이 거절됐습니다.',SESSION_RECOVERY_UNVERIFIED:'중단된 세션의 질문 재전달은 검증되지 않았습니다.',EXTERNAL_OUTCOME_UNKNOWN:'외부 실행 결과가 불명확합니다. 자동 재호출하지 않습니다.'};
 return {code,message:recoveryMessages[code]??message[code]??'공급자 응답 또는 파일 검증에 실패했습니다.',retryable:false,nextActions:code==='REVIEW_TIMEOUT'||code==='FACT_FETCH_NOT_ATTEMPTED'?['reverify_facts']:(code==='SUBSCRIPTION_QUOTA'||code==='AGY_RATE_LIMIT')?['wait_quota']:code.startsWith('AUTH_')||code==='LOGIN_REQUIRED'?['check_login']:['contact_user'],projectId:context?.projectId??null,runId:context?.runId??null,currentVersion:context?.baseProjectVersion??null,details:{reason:code,...(error instanceof ProviderFailure&&Number.isFinite(error.details.retryAfterSeconds)&&error.details.retryAfterSeconds!>=0?{retryAfterSeconds:error.details.retryAfterSeconds}:{})}};
}
