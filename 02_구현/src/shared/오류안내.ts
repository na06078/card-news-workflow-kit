/** 공개된 코드만 사용자 행동으로 번역합니다. 원시 reason/field는 반환하지 않습니다. */
const reasons:Record<string,string>={
 TEXT_OVERFLOW:'글자가 카드 영역을 넘었습니다. 제목·본문을 줄이거나 글자 배치를 조정하세요.',
 FONT_UNAVAILABLE:'한글 글꼴을 사용할 수 없습니다. 앱의 글꼴 설치 상태를 담당자에게 확인하세요.',
 BROWSER_UNAVAILABLE:'카드 렌더링 도구를 사용할 수 없습니다. 앱의 렌더링 환경을 확인하세요.',
 ASSET_HASH_MISMATCH:'저장된 이미지의 무결성이 일치하지 않습니다. 해당 자료를 확인하세요.',
 ASSET_PATH_INVALID:'저장된 자료 위치를 사용할 수 없습니다. 해당 자료를 확인하세요.',
 CONNECTION_BUSY:'계정 연결 작업이 진행 중입니다. 계정 연결에서 완료·취소 상태를 확인하세요.',
 WORKER_UNAVAILABLE:'작업 처리기를 사용할 수 없습니다. 앱의 작업자 상태를 담당자에게 확인하세요.',
 CANCEL_CLEANUP_FAILED:'앱이 시작한 하위 작업의 종료·정리를 확인하지 못했습니다. 재실행 전에 해당 작업의 상태를 확인해 주세요. 취소 완료로 처리된 것은 아닙니다.',
 SESSION_RECOVERY_UNSUPPORTED:'이 저장 세션은 이어서 실행할 수 없습니다. 저장 결과를 보존하고 지원 여부를 확인하세요.',
 AUTH_PATH_FORBIDDEN:'허용되지 않은 인증 경로입니다. 계정 연결에서 공식 구독·Google 계정 인증을 확인하세요. API 키로 대체하지 않습니다.',
 AUTH_MODE_UNKNOWN:'인증 방식을 확인하지 못했습니다. 계정 연결에서 해당 도구의 인증 상태를 확인하세요.',
 METADATA_CLEANUP_UNCONFIRMED:'메타데이터 조회 도구의 종료를 확인하지 못했습니다. 도구 정리 상태를 담당자에게 확인하세요.',
 METADATA_UNAVAILABLE:'모델·사용량 정보를 조회하지 못했습니다. 잠시 후 메타데이터를 다시 조회하세요.',
 NATIVE_CLEANUP_UNCONFIRMED:'계정 연결 전용 창·하위 프로세스의 종료를 확인하지 못했습니다. 해당 연결 창의 정리 상태를 확인한 뒤 연결 상태 다시 조회를 누르세요. 새 로그인·연결 검사는 정리 확인 전까지 시작할 수 없습니다.',
 ACCOUNT_MISMATCH:'현재 공식 도구의 계정이 선택한 계정과 다릅니다. 계정 연결에서 현재 계정을 다시 조회하세요.',
 LOGOUT_UNCONFIRMED:'공식 도구의 실제 로그아웃을 확인하지 못했습니다. 현재 계정을 다시 조회하세요.',
 ACCOUNT_ID_UNAVAILABLE:'공식 도구의 현재 계정 ID를 확인하지 못했습니다. 계정 연결에서 해당 도구의 계정을 확인하세요.',
 AUTH_METADATA_UNCONFIRMED:'인증 메타데이터가 확인되지 않았습니다. 계정 연결에서 해당 도구의 인증 상태를 확인하세요.',
 SEARCH_TOOL_UNAVAILABLE:'검색 도구를 사용할 수 없습니다. 해당 도구의 설치·권한을 확인하세요.',
 TOOL_PERMISSION_DENIED:'필요한 도구의 실행 권한이 없습니다. 해당 도구의 권한 설정을 확인하세요.'
};
const fields:Record<string,string>={topic:'조사 주제',period:'조사 기간',claudeModel:'Claude 모델',model:'Claude 모델',candidateIds:'선택한 후보',questionId:'현재 질문',answer:'질문 답변',size:'카드 크기',title:'카드 제목',body:'카드 본문',instruction:'수정 요청',cardIds:'대상 카드',claimIndices:'문제 주장 선택',reviewRunId:'재검증 제안',version:'저장 버전',resultVersion:'결과 버전',stage:'진행 단계',scope:'수정 범위'};
export function safeReason(code:unknown):string|null {return typeof code==='string'&&Object.hasOwn(reasons,code)?reasons[code]!:null;}
export function errorDetailText(error:{code?:string;details?:{field?:string;reason?:string;retryAfterSeconds?:number}}):string[]{
 const d=error.details,result:string[]=[];
 const field=typeof d?.field==='string'?d.field.match(/^([A-Za-z][A-Za-z0-9]*)(?:\.(?:[A-Za-z][A-Za-z0-9]*|[0-9]+))*$/)?.[1]:undefined;
 // 검증기의 answer.0.text 같은 경로도 알려진 최상위 필드 이름만 표시합니다.
 if(field&&Object.hasOwn(fields,field))result.push(`대상: ${fields[field]}`);
 const reason=safeReason(d?.reason)??safeReason(error.code);if(reason)result.push(reason);
 const seconds=d?.retryAfterSeconds;if(typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=604800)result.push(`최소 ${seconds}초 후 다시 시도하세요. 자동 재시도하지 않습니다.`);
 return result;
}
