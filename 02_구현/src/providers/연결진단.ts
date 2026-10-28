import {ProviderFailure} from './오류.js';
/** 앱 소유 고정 문구만 공개하며 모델 reason/본문/경로는 복사하지 않습니다. */
export const FACT_LINK_MESSAGES={
 FACT_LINK_UNRESOLVABLE:'기존 자료에서 연결을 확정하지 못했습니다. 저장된 보완 응답을 반복 호출하지 않으며 기존 원고는 유지됩니다.',
 FACT_LINK_PAIR_DUPLICATE:'저장된 보완 응답에 같은 주장·카드 연결쌍이 중복되었습니다. 사용자 선택 문제가 아니며 반복 보완은 차단됩니다.',
 FACT_LINK_TARGET_INVALID:'저장된 보완 응답의 연결 대상이 기존 주장·누락 카드 범위와 맞지 않습니다. 사용자 선택 문제가 아니며 기존 원고는 유지됩니다.',
 FACT_LINK_COVERAGE_MISSING:'저장된 보완 응답에도 해결되지 않은 카드 연결 누락이 있습니다. 같은 보완을 반복하지 않으며 기존 원고는 유지됩니다.',
 FACT_LINK_VALIDATION_FAILED:'연결 보완의 참조·출처 검증에 실패했습니다. 저장된 응답·근거의 검증이 필요하며 기존 원고는 유지됩니다.',
} as const;
export type FactLinkReason=keyof typeof FACT_LINK_MESSAGES;
export class FactLinkFailure extends ProviderFailure{
 constructor(readonly reason:FactLinkReason,code:'FACT_SCOPE_INVALID'|'FACT_REVIEW_FAILED'='FACT_SCOPE_INVALID'){super(code);}
}
export function linkFailure(reason:FactLinkReason,code?:'FACT_SCOPE_INVALID'|'FACT_REVIEW_FAILED'):never{throw new FactLinkFailure(reason,code);}
export function linkDiagnostic(error:unknown):{code:FactLinkReason;message:string}{const code=error instanceof FactLinkFailure?error.reason:'FACT_LINK_VALIDATION_FAILED';return {code,message:FACT_LINK_MESSAGES[code]};}
