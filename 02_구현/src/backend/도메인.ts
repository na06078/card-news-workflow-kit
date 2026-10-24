import {ERROR_HTTP,type AppError,type ErrorCode,type NextAction} from '../shared/포트.js';
const messages:Partial<Record<ErrorCode,string>>={
 VALIDATION_ERROR:'입력값을 확인해 주세요.',NOT_FOUND:'해당 프로젝트·작업·파일을 찾을 수 없습니다.',
 VERSION_CONFLICT:'현재 스냅샷을 다시 불러와 주세요.',QUESTION_STALE:'현재 질문을 다시 불러와 주세요.',REQUEST_ID_CONFLICT:'같은 요청 ID에 다른 입력이 있습니다. 새 요청 ID로 제출해 주세요.',
 RUN_ACTIVE:'이미 진행 중인 작업이 있습니다.',STAGE_CONFLICT:'현재 단계에서 허용하지 않는 요청입니다.',FINAL_NOT_APPROVED:'현재 결과를 먼저 최종 승인해 주세요.',EXPORT_STALE:'수정 전의 다운로드입니다. 현재 결과를 다시 승인해 주세요.',
 LOCAL_REQUEST_DENIED:'로컬 Host·Origin·세션·CSRF 검증에 실패했습니다.',INVALID_JSON:'올바른 JSON을 보내 주세요.',PAYLOAD_TOO_LARGE:'JSON 요청은 256 KiB 이하여야 합니다.',
 STORAGE_BUSY:'저장소가 사용 중입니다. 잠시 후 같은 요청으로 재시도해 주세요.',ASSET_INVALID:'파일의 경로·형식·크기·해시 검증에 실패했습니다.',
 IMAGE_GENERATION_FAILED:'해당 카드의 그림 생성에 실패했습니다.',RENDER_FAILED:'카드 렌더링에 실패했습니다.',EXPORT_FAILED:'내보내기에 실패했습니다. 콘텐츠 최종 승인은 유지됩니다.',
 EXTERNAL_OUTCOME_UNKNOWN:'이전 외부 요청의 결과가 불명입니다. 중복 호출 가능성을 확인한 후 명시적으로 재시도해 주세요.',SESSION_RECOVERY_UNVERIFIED:'중단된 질문의 자동 SDK 재개는 검증되지 않았습니다. 기록을 확인하고 새 실행을 선택해 주세요.',CANCEL_CLEANUP_FAILED:'하위 작업 정리를 확인하지 못했습니다. 취소가 완료된 것은 아닙니다.'
};
const actions:Partial<Record<ErrorCode,NextAction[]>>={RUN_ACTIVE:['cancel'],FINAL_NOT_APPROVED:['approve_final'],EXPORT_STALE:['approve_final'],QUESTION_STALE:['answer'],IMAGE_GENERATION_FAILED:['retry'],RENDER_FAILED:['retry'],EXPORT_FAILED:['retry'],RESEARCH_FAILED:['retry'],PROVIDER_PROTOCOL_ERROR:['retry'],STORAGE_BUSY:['retry'],EXTERNAL_OUTCOME_UNKNOWN:['retry'],SESSION_RECOVERY_UNVERIFIED:['retry'],CANCEL_CLEANUP_FAILED:['contact_user'],AUTH_MODE_UNKNOWN:['check_login'],AUTH_PATH_FORBIDDEN:['check_login'],LOGIN_REQUIRED:['check_login'],SUBSCRIPTION_EXPIRED:['check_login'],SUBSCRIPTION_QUOTA:['wait_quota'],TOOL_PERMISSION_DENIED:['contact_user'],SEARCH_TOOL_UNAVAILABLE:['contact_user']};
export class DomainError extends Error {
 readonly status:number;readonly error:AppError;
 constructor(code:ErrorCode,projectId:string|null=null,currentVersion:number|null=null,reason?:string,runId:string|null=null){
  super(code);this.status=ERROR_HTTP[code];const nextActions=actions[code]??[];
  this.error={code,message:messages[code]??'요청을 처리할 수 없습니다. 상태와 권한을 확인해 주세요.',retryable:nextActions.includes('retry'),nextActions:[...nextActions],projectId,runId,currentVersion,details:reason?{reason}:{}};
 }
}
export function requireThat(ok:unknown,code:ErrorCode,projectId:string|null=null,version:number|null=null,reason?:string):asserts ok {if(!ok)throw new DomainError(code,projectId,version,reason);}
