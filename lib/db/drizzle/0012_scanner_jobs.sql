CREATE TABLE IF NOT EXISTS scanner_jobs (
  scan_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  universe_id TEXT NOT NULL,
  trader_token_encrypted TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  result JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scanner_jobs_user_id_started_at ON scanner_jobs (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_jobs_status_started_at ON scanner_jobs (status, started_at) WHERE status IN ('queued', 'running');
