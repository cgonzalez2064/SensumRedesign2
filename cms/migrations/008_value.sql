-- "Prospectos": every contact-form message kept in the panel (a small CRM).
CREATE TABLE leads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL,
    phone        TEXT    NOT NULL DEFAULT '',
    service      TEXT    NOT NULL DEFAULT '',
    message      TEXT    NOT NULL DEFAULT '',
    lang         TEXT    NOT NULL DEFAULT 'es',
    status       TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost')),
    amount       INTEGER,                          -- quoted / won amount, whole quetzales
    notified     INTEGER NOT NULL DEFAULT 0,       -- 1 once the e-mail notice went out
    unread       INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    contacted_at INTEGER,                          -- first time it left "new" (response time)
    closed_at    INTEGER                           -- won or lost
);
CREATE INDEX leads_created ON leads(created_at);
CREATE INDEX leads_status ON leads(status, created_at);

-- Notes and the history (status and amount changes) of each lead.
CREATE TABLE lead_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author     TEXT    NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('note', 'event')),
    body       TEXT    NOT NULL DEFAULT '',
    details    TEXT    NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);
CREATE INDEX lead_notes_lead ON lead_notes(lead_id, id);

-- New access: "leads". Accounts that could manage the whole site get it.
UPDATE users SET permissions = permissions || ',leads' WHERE (',' || permissions || ',') LIKE '%,site,%';

-- Cookie-free visit statistics: daily totals only, never one row per visitor.
--   view (dim = page), visitor, source (google, facebook, direct…),
--   device (mobile/tablet/desktop), lang, click (whatsapp, phone, email…)
CREATE TABLE analytics_daily (
    day    TEXT    NOT NULL,
    metric TEXT    NOT NULL,
    dim    TEXT    NOT NULL DEFAULT '',
    count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, dim)
) WITHOUT ROWID;

-- Today's unique-visitor markers: a hash of a random salt of the day, the
-- IP address and the browser. Deleted (with the salt) when the day ends, so
-- no one can be followed from one day to the next.
CREATE TABLE analytics_seen (
    day  TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (day, hash)
) WITHOUT ROWID;

-- Ticket service levels: first answer from support, automatic closing and
-- the reporter's satisfaction rating.
ALTER TABLE support_reports ADD COLUMN first_response_at INTEGER;
ALTER TABLE support_reports ADD COLUMN closed_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_reports ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE support_reports ADD COLUMN rating_comment TEXT;
ALTER TABLE support_reports ADD COLUMN rated_at INTEGER;
UPDATE support_reports SET first_response_at = (
    SELECT MIN(m.created_at) FROM report_messages m
    WHERE m.report_id = support_reports.id AND m.author_role = 'support'
      AND (m.kind = 'message' OR (m.kind = 'event' AND m.details LIKE '%"action":"status"%'))
);
