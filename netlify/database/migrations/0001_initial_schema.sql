CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  subteam TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('part_request', 'sponsorship')),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX records_kind_created_idx ON records(kind, created_at DESC);

CREATE TABLE sponsor_leads (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sponsor_leads_created_idx ON sponsor_leads(created_at DESC);

CREATE TABLE auth_attempts (
  bucket_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);
