ALTER TABLE users ADD COLUMN tag TEXT NOT NULL DEFAULT 'member' CHECK (tag IN ('member', 'dev'));
