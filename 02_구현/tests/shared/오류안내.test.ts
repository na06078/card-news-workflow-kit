import {it,expect} from 'vitest';
import {safeReason,errorDetailText} from '../../src/shared/오류안내.js';
it.each(['TEXT_OVERFLOW','FONT_UNAVAILABLE','BROWSER_UNAVAILABLE','ASSET_HASH_MISMATCH','ASSET_PATH_INVALID','CONNECTION_BUSY','WORKER_UNAVAILABLE','SESSION_RECOVERY_UNSUPPORTED','AUTH_PATH_FORBIDDEN','AUTH_MODE_UNKNOWN','METADATA_CLEANUP_UNCONFIRMED','METADATA_UNAVAILABLE','NATIVE_CLEANUP_UNCONFIRMED','ACCOUNT_MISMATCH','LOGOUT_UNCONFIRMED','ACCOUNT_ID_UNAVAILABLE','AUTH_METADATA_UNCONFIRMED','SEARCH_TOOL_UNAVAILABLE','TOOL_PERMISSION_DENIED'])('안전 코드 %s만 고정 행동 문구로 변환한다',code=>{expect(safeReason(code)).toEqual(expect.any(String));expect(safeReason(code)).not.toContain(code);});
it.each(['secret=/private/key','__proto__','constructor','toString','UNKNOWN','',null,17])('미지 원인 %s를 출력하지 않는다',code=>expect(safeReason(code)).toBeNull());
it('필드와 대기값도 허용 범위를 벗어나면 출력하지 않는다',()=>{
 for(const n of [-1,Infinity,NaN,1.5,604801])expect(errorDetailText({details:{field:'C:/token',reason:'raw-secret',retryAfterSeconds:n}})).toEqual([]);
 expect(errorDetailText({details:{field:'__proto__'}})).toEqual([]);expect(errorDetailText({details:{field:'body',retryAfterSeconds:0}})).toEqual(['대상: 카드 본문','최소 0초 후 다시 시도하세요. 자동 재시도하지 않습니다.']);
});
it.each([['answer.0.text','질문 답변'],['claimIndices.0','문제 주장 선택'],['reviewRunId','재검증 제안']] as const)('실제 검증 경로 %s를 안전한 대상 이름으로 설명한다',(field,label)=>{
 expect(errorDetailText({details:{field}})).toEqual(['대상: '+label]);
 expect(errorDetailText({details:{field:'unknown.private.path'}})).toEqual([]);
});
