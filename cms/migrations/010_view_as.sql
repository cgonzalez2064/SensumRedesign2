-- "Ver como" (owner only): while set, the owner's own session shows the panel
-- as another account — read-only — until view_as_until.
ALTER TABLE sessions ADD COLUMN view_as_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN view_as_until INTEGER;
