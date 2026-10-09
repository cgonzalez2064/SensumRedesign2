-- Monthly site report: each run of the scheduled check (availability figure)
-- and each report sent to clients (history, and the reminder after day 5).
CREATE TABLE monitor_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    failed     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX monitor_runs_created ON monitor_runs(created_at);

CREATE TABLE site_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    period     TEXT    NOT NULL,                -- 'YYYY-MM', the month the report covers
    sent_at    INTEGER NOT NULL,
    sent_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recipients TEXT    NOT NULL,                -- JSON list (the owner always goes in copy)
    lang       TEXT    NOT NULL DEFAULT 'es',
    status     TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
    summary    TEXT    NOT NULL DEFAULT '{}'    -- figures as sent
);
CREATE INDEX site_reports_period ON site_reports(period, status);
