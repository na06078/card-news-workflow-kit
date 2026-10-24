# API 명세 — CN-1 구현 연결 안내

단일 계약은 [인터페이스 계약 CN-1](../../01_기술설계/📖%20인터페이스%20계약.md)입니다. 원본 PRD 초안의 상세화, HTTP 경로/정확한 JSON/version 대상/오류는 해당 문서 §1–8과 `src/shared/{계약,검증,포트}.ts`를 그대로 따릅니다. 이 문서는 경쟁 DTO를 정의하지 않습니다.

## 실제 구현 위치
- `src/backend/앱.ts:createApp`가 CN-1 HTTP 경로를 등록하고 런타임 validator를 적용합니다.
- `src/backend/저장소.ts:createStore`가 requestId 원장·버전/CAS·승인·작업·파일 자산을 보관합니다.
- `src/frontend/클라이언트.ts:createHttpClient`가 bootstrap 쿠키/CSRF, 응답 validator, 실패 `{status,error}`를 처리합니다. main은 기본 `<App />`의 실제 HTTP client를 사용합니다.
- server bootstrap은 loopback bind, 정확한 Host/Origin allowlist, staticDir와 Store 수명을 담당합니다. HTTP는 작업 접수만 하며 SDK/이미지/렌더 완료를 기다리지 않습니다.
- worker bootstrap은 실제 G1 SDK/agy factory와 R1 render/export를 W1에 주입합니다. 기본 dataMode는 real이고 실공급자 허가는 전부 false입니다.

## 설치된 실제 경로와 연결 차이
| 항목 | 현재 구현/운용 |
|---|---|
| 기본 주소 | Express `http://127.0.0.1:8765`; 개발 UI `http://127.0.0.1:5173` → 같은 Origin 정책을 유지한 `/api` proxy |
| 정적 화면 | `dist/web`을 실제 Express가 제공. 브라우저에서 빌드된 React 앱/저장 복원 검사 실행 |
| 질문 | POST answers 저장 후 W1 DB polling이 callback으로 전달. 서버 세션 재생성 시 bootstrap 재발급 필요; 죽은 callback이 복구됐다고 주장하지 않음 |
| 반복 요청 | method/route/canonical input 동일이면 최초 status/body 재생. 완료 뒤에도 202 영수증 재생; 현재 상태는 GET으로 확인 |
| 최종/부분 승인 | final은 현재 result.version; 카드 승인은 현재 card.revision+resultVersion. text 수정은 대상만 개정, 그림 보존, final/export 무효화 |
| 비동기 실패 | 이미 받은 202를 나중에 502로 바꾸지 않음. Run.error/event와 재조회 화면에 표시 |
| 현재 생산 오류 | G1 SDK start는 import/query 전에 AUTH_MODE_UNKNOWN; agy는 spawn 전에 TOOL_PERMISSION_DENIED. 앱의 추적상 externalOutcome=unknown일 수 있어도 실제 호출 발생 증거로 해석하지 않음 |
| synthetic 시험 | 테스트 모듈 `tests/integration/fixtures/I2`만 명시 외부 결과 주입, dataMode=mock. HTTP/SQLite/worker/render/export는 실제 모듈. 정상 bootstrap에서 이 fixture를 import하지 않음 |
| layout | CN-1 후속 승인(233–242행)의 제한된 옵션이 shared/provider/W1/B1/R1에 이미 구현됨. I2는 의미 변경 없이 소비, 이번 E2E는 text 수정 중심; layout 실렌더는 W1 선행 증거 |
| 취소 | CleanupReport 확인 후 상태 확정. I2 실제 프로세스 재시작은 앱 소유 Node IPC 종료/재기동, active 질문 취소는 명시 대역. 실SDK/agy 후손 정리는 미검증 |

## I2가 실제 사용한 요청
`GET /api/bootstrap`, `POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/research`, `selection`, `answers`, `approve`, `revisions`, `cards/:cardId/approve`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`, `retry`, `GET /api/projects/:id/assets/:assetId`, `GET /api/projects/:id/exports/:exportId/download`.

전체 등록 경로에는 `events`·`exports` 목록 조회도 있으며 `src/backend/앱.ts`/CN-1이 기준입니다. 각 시험의 실제 method/path/status/replay 기록은 `실행데이터/I2/<UUID>/증거.json`에 있습니다. 정상 세션 보호를 거치지 않은 호출은 403, 다른 프로젝트 자산은 404, 오래된 질문/승인/다운로드와 requestId 충돌은 409로 검사했습니다.

실제 검색/원문 날짜/SDK 인증·질문 재개/agy generation 프로토콜 성공은 이 HTTP 계약 검증만으로 입증하지 않습니다.
