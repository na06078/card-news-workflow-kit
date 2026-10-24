-- 콘텐츠 없는 삭제 의도/완료 표식. 프로젝트 제거 후에도 멱등 응답에 사용한다.
CREATE TABLE IF NOT EXISTS project_deletions(
 project_id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 state TEXT NOT NULL CHECK(state IN ('pending','complete'))
);
