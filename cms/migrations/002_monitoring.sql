-- Monitoring: every error occurrence is kept (owner-only log), with the
-- status of the e-mail alert sent for critical ones. Replaces the grouped
-- error_events table; existing groups are carried over as one entry each.

CREATE TABLE error_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  INTEGER NOT NULL,
    severity    TEXT    NOT NULL CHECK (severity IN ('critical', 'error', 'warning')),
    source      TEXT    NOT NULL CHECK (source IN ('server', 'admin', 'public', 'system')),
    event       TEXT    NOT NULL,
    message     TEXT    NOT NULL DEFAULT '',
    location    TEXT    NOT NULL DEFAULT '',
    request     TEXT    NOT NULL DEFAULT '',
    ref         TEXT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    fingerprint TEXT    NOT NULL,
    alert       TEXT    CHECK (alert IN ('sent', 'failed', 'suppressed', 'off')),
    details     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX error_log_created ON error_log(created_at);
CREATE INDEX error_log_fingerprint ON error_log(fingerprint, created_at);
CREATE INDEX error_log_severity ON error_log(severity, created_at);

INSERT INTO error_log (created_at, severity, source, event, message, location, request, fingerprint, details)
SELECT last_seen, 'error', source,
       CASE source WHEN 'server' THEN 'server_error' ELSE 'client_error' END,
       message, location, page, fingerprint,
       '{"count":' || count || ',"firstSeen":' || first_seen || '}'
  FROM error_events;

DROP TABLE error_events;
