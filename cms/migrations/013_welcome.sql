-- First sign-in: each person chooses the panel's language and appearance once
-- (welcome screen). People who already used the panel are not asked again.
ALTER TABLE users ADD COLUMN onboarded_at INTEGER;
UPDATE users SET onboarded_at = last_login_at WHERE last_login_at IS NOT NULL;
