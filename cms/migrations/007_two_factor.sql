-- Two-step sign-in (TOTP authenticator apps) with one-time recovery codes,
-- and the short-lived challenges between the password and the code.
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;        -- encrypted (Secrets, purpose "totp")
ALTER TABLE users ADD COLUMN totp_pending_enc TEXT;       -- during set-up, until the first code is confirmed
ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0; -- a code cannot be used twice

CREATE TABLE recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT    NOT NULL,
    used_at    INTEGER
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);

CREATE TABLE login_challenges (
    id_hash    TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
);
