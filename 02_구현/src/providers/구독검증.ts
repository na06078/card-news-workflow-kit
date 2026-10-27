import type {AccountInfo} from '@anthropic-ai/claude-agent-sdk';
import type {ClaudeOptions,SemanticReviewerOptions} from '../shared/포트.js';
import {fail} from './오류.js';
export const SDK_VERSION='0.3.309';
/** 동일 Query의 control 응답만 전달. optional source 부재는 오류도 OAuth enum도 아님.
 * 실제 0.3.309 firstParty/Claude Team 응답을 포함한 구독 범주를 양성 근거로 사용.
 * 계정의 추가 사용량 설정까지 증명하는 함수가 아닙니다. */
export function inspectAccountMetadata(account:AccountInfo):void {
 if(account.apiProvider && account.apiProvider!=='firstParty')fail('AUTH_PATH_FORBIDDEN');
 if(account.apiKeySource && account.apiKeySource!=='none')fail('AUTH_PATH_FORBIDDEN');
 if(account.tokenSource && !['oauth','claude.ai'].includes(account.tokenSource))fail('AUTH_PATH_FORBIDDEN');
 if(account.apiProvider!=='firstParty'||!/^(?:Claude )?(?:Pro|Max|Team)$/i.test(account.subscriptionType??''))fail('AUTH_MODE_UNKNOWN');
}
/** 초기화 자체의 사용자 허가. 양성 인증은 생성한 동일 Query에서 반드시 별도 확인. */
export async function subscriptionPreflight(options:Pick<ClaudeOptions,'livePermission'|'usageCreditsDisabled'>):Promise<void> {
 const p=options.livePermission;
 if(!p.inference||!p.search||!p.image||!p.approvalReference)fail('AUTH_MODE_UNKNOWN');
}
/** 도구 없는 의미 검수만 허가합니다. 실제 구독 인증은 같은 Query에서 다시 확인합니다. */
export async function reviewSubscriptionPreflight(options:Pick<SemanticReviewerOptions,'livePermission'>):Promise<void> {
 const p=options.livePermission;
 if(!p.inference||!p.approvalReference?.trim())fail('AUTH_MODE_UNKNOWN');
}
