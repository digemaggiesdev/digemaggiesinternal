import 'dotenv/config'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATABASE_PATH || 'data/digem.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('part_request', 'sponsorship')),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS records_kind_created_idx ON records(kind, created_at DESC);

  CREATE TABLE IF NOT EXISTS sponsor_leads (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sponsor_leads_created_idx ON sponsor_leads(created_at DESC);

  CREATE TABLE IF NOT EXISTS subteam_change_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_subteam TEXT NOT NULL,
    current_subteam TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS subteam_change_requests_user_created_idx
    ON subteam_change_requests(user_id, created_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS subteam_change_requests_one_pending_per_user_idx
    ON subteam_change_requests(user_id) WHERE status = 'pending';
`)

const userColumns = db.pragma('table_info(users)')
if (!userColumns.some((column) => column.name === 'subteam')) {
  db.exec("ALTER TABLE users ADD COLUMN subteam TEXT NOT NULL DEFAULT ''")
}
if (!userColumns.some((column) => column.name === 'tag')) {
  db.exec("ALTER TABLE users ADD COLUMN tag TEXT NOT NULL DEFAULT 'member' CHECK(tag IN ('member', 'dev'))")
}

db.prepare(`
  UPDATE records
  SET data = json_set(data, '$.status', ?), updated_at = ?
  WHERE kind = ? AND json_extract(data, '$.status') = ?
`).run('In transit', new Date().toISOString(), 'part_request', 'In progress')