-- Sensum Content Manager — initial schema (SQLite).
-- All timestamps are Unix epoch seconds (UTC).

CREATE TABLE users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT    NOT NULL UNIQUE,              -- stored lower-case
    name                TEXT    NOT NULL,
    role                TEXT    NOT NULL CHECK (role IN ('admin', 'editor')),
    status              TEXT    NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
    password_hash       TEXT,                                 -- NULL until the invitation is accepted
    lang                TEXT    NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
    theme               TEXT    NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    last_login_at       INTEGER,
    password_changed_at INTEGER,
    invited_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Server-side sessions. Only a SHA-256 hash of the cookie value is stored,
-- so a copy of the database cannot be used to hijack a live session.
CREATE TABLE sessions (
    id_hash      TEXT    PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token   TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,                            -- absolute expiry
    user_agent   TEXT,
    ip_hash      TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Single-use, expiring tokens for invitations and password resets.
-- Only a SHA-256 hash of the token is stored.
CREATE TABLE user_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT    NOT NULL CHECK (purpose IN ('invite', 'reset')),
    token_hash TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);
CREATE INDEX user_tokens_user ON user_tokens(user_id, purpose);

-- Editable text. Rows exist only for values that differ from the
-- approved defaults (cms/content/defaults.php).
CREATE TABLE content (
    key        TEXT    NOT NULL,
    lang       TEXT    NOT NULL CHECK (lang IN ('es', 'en', '*')),   -- '*' = language-independent (phones, URLs…)
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (key, lang)
);

-- Published photos and documents. Files live in public_html/assets/uploads
-- under server-generated names; nothing here is a user-supplied path.
CREATE TABLE media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slot          TEXT    NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    kind          TEXT    NOT NULL CHECK (kind IN ('image', 'pdf')),
    file_base     TEXT    NOT NULL UNIQUE,                    -- e.g. proj1-card-3f9a1c0b7d2e
    ext           TEXT    NOT NULL CHECK (ext IN ('webp', 'jpg', 'pdf')),
    width         INTEGER,
    height        INTEGER,
    bytes         INTEGER NOT NULL,
    variants      TEXT    NOT NULL DEFAULT '[]',              -- JSON array of widths, e.g. [800,1600]
    alt_es        TEXT    NOT NULL DEFAULT '',
    alt_en        TEXT    NOT NULL DEFAULT '',
    original_name TEXT    NOT NULL DEFAULT '',                -- sanitized, display only
    created_at    INTEGER NOT NULL,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at    INTEGER                                     -- files are garbage-collected 30 days later
);
CREATE INDEX media_slot ON media(slot, deleted_at, position);

CREATE TABLE settings (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Support / issue reports (minimal audit trail — not a ticketing system).
CREATE TABLE support_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reporter_name   TEXT    NOT NULL,
    reporter_email  TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK (type IN ('problem', 'improvement', 'content', 'design', 'other')),
    title           TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    area            TEXT    NOT NULL CHECK (area IN ('website', 'admin', 'both')),
    page            TEXT    NOT NULL DEFAULT '',
    context         TEXT    NOT NULL DEFAULT '{}',            -- JSON, allow-listed keys only
    screenshot      TEXT,                                     -- file name in storage/reports
    fingerprint     TEXT    NOT NULL,                         -- duplicate-submission detection
    email_status    TEXT    NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
    email_attempts  INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    sent_at         INTEGER,
    created_at      INTEGER NOT NULL
);
CREATE INDEX support_reports_user ON support_reports(user_id, created_at);

-- Administrative activity (who changed what). Never contains secrets.
CREATE TABLE activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT    NOT NULL,
    target     TEXT    NOT NULL DEFAULT '',
    details    TEXT    NOT NULL DEFAULT '{}',
    ip_hash    TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX activity_log_created ON activity_log(created_at);

-- Fixed-window counters for throttling (login, resets, reports, telemetry).
CREATE TABLE rate_limits (
    bucket       TEXT    NOT NULL,
    key_hash     TEXT    NOT NULL,
    window_start INTEGER NOT NULL,
    hits         INTEGER NOT NULL,
    PRIMARY KEY (bucket, key_hash)
);

-- Grouped application errors (server, admin panel, optionally public site).
CREATE TABLE error_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT    NOT NULL UNIQUE,
    source      TEXT    NOT NULL CHECK (source IN ('server', 'admin', 'public')),
    message     TEXT    NOT NULL,
    location    TEXT    NOT NULL DEFAULT '',
    page        TEXT    NOT NULL DEFAULT '',
    count       INTEGER NOT NULL DEFAULT 1,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
CREATE INDEX error_events_last ON error_events(last_seen);
