CREATE TABLE project_model_settings(
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 model TEXT,
 version INTEGER NOT NULL CHECK(version>=0),
 updated_at TEXT NOT NULL
);
