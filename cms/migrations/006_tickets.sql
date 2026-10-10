-- Support reports become tickets the owner (IT) manages: status, priority,
-- a conversation with the person who reported it, internal notes, and
-- "unread" markers for both sides.
ALTER TABLE support_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'waiting', 'resolved', 'closed'));
ALTER TABLE support_reports ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE support_reports ADD COLUMN updated_at INTEGER;
ALTER TABLE support_reports ADD COLUMN resolved_at INTEGER;
ALTER TABLE support_reports ADD COLUMN owner_unread INTEGER NOT NULL DEFAULT 1;
ALTER TABLE support_reports ADD COLUMN reporter_unread INTEGER NOT NULL DEFAULT 0;
-- Reports sent before tickets existed were already e-mailed to IT.
UPDATE support_reports SET updated_at = created_at, owner_unread = 0;
CREATE INDEX support_reports_status ON support_reports(status, updated_at);

-- The conversation: public messages, internal notes (IT only) and events
-- (status, priority and edits) in the order they happened.
CREATE TABLE report_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id    INTEGER NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name  TEXT    NOT NULL,
    author_role  TEXT    NOT NULL CHECK (author_role IN ('support', 'reporter')),
    kind         TEXT    NOT NULL CHECK (kind IN ('message', 'note', 'event')),
    body         TEXT    NOT NULL DEFAULT '',
    details      TEXT    NOT NULL DEFAULT '{}',              -- events: {"action":"status","from":"new","to":"waiting"}
    email_status TEXT    CHECK (email_status IN ('sent', 'failed')), -- the other side was notified
    created_at   INTEGER NOT NULL
);
CREATE INDEX report_messages_report ON report_messages(report_id, id);
