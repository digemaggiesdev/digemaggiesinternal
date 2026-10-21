CREATE TABLE subteam_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_subteam TEXT NOT NULL,
  current_subteam TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX subteam_change_requests_user_created_idx ON subteam_change_requests(user_id, created_at DESC);
CREATE UNIQUE INDEX subteam_change_requests_one_pending_per_user_idx ON subteam_change_requests(user_id) WHERE status = 'pending';
