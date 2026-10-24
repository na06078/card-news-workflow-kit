import {appError,ProviderFailure} from '../providers/오류.js';
import type * as C from '../shared/포트.js';
import {AppErrorSchema,EngineEventSchema,ERROR_HTTP} from '../shared/포트.js';
export function workerError(code:string,f:C.LeaseFence):C.AppError{const requiresInput=code==='CANCEL_CLEANUP_FAILED'||code==='SESSION_RECOVERY_UNVERIFIED';return {code,message:code==='CANCEL_CLEANUP_FAILED'?'취소 정리를 확인하지 못했습니다. 소유 실행 상태 확인이 필요합니다.':code==='SESSION_RECOVERY_UNVERIFIED'?'저장 세션의 pending 질문 재개는 검증되지 않았습니다. 사용자 확인이 필요합니다.':'작업을 중단했습니다. 상태를 확인한 뒤 명시적으로 재시도해 주세요.',retryable:!requiresInput,nextActions:requiresInput?['contact_user']:['retry'],projectId:f.projectId,runId:f.runId,currentVersion:f.baseProjectVersion,details:{reason:code}};}
export function normalizeError(error:unknown,f:C.LeaseFence,fallback='PROVIDER_PROTOCOL_ERROR'):C.AppError{
 if(error instanceof ProviderFailure)error=appError(error);
 const parsed=AppErrorSchema.safeParse(error&&typeof error==='object'&&'error'in error?error.error:error);
 // 외부 예외의 message/stack/stdout을 공개하지 않습니다.
 const rawCode=parsed.success?parsed.data.code:error&&typeof error==='object'&&'code'in error?error.code:null;
 const code=typeof rawCode==='string'&&Object.hasOwn(ERROR_HTTP,rawCode)?rawCode:fallback;
 const out=workerError(code,f);
 if(Object.hasOwn(ERROR_HTTP,code))out.message=appError(new ProviderFailure(code as C.ErrorCode)).message;
 if(parsed.success&&code===parsed.data.code){out.retryable=parsed.data.retryable;out.nextActions=parsed.data.nextActions;if(parsed.data.details.retryAfterSeconds!==undefined)out.details.retryAfterSeconds=parsed.data.details.retryAfterSeconds;}
 return out;
}
export function validateEvent(event:C.EngineEvent,f:C.LeaseFence){EngineEventSchema.parse(event);if(event.runId!==f.runId||event.projectId!==f.projectId||event.attempt!==f.attempt)throw workerError('PROVIDER_PROTOCOL_ERROR',f);}
