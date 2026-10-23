ALTER TABLE users DROP CONSTRAINT users_tag_check;
ALTER TABLE users ADD CONSTRAINT users_tag_check CHECK (tag IN ('member', 'dev', 'stl'));
