-- 원고/승인/자산과 분리한 비공개 실행별 복구 자료.
CREATE TABLE IF NOT EXISTS fact_checkpoints(
 checkpoint_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
 payload TEXT NOT NULL,
 source_file_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS fact_checkpoint_jobs(
 run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
 checkpoint_id TEXT NOT NULL REFERENCES fact_checkpoints(checkpoint_id) ON DELETE CASCADE
);
