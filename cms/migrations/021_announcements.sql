-- «Avisos al equipo» (October 2026): e-mails from the owner about the panel's
-- «Novedades» (cms/wiki/wiki.json). One row per send, and which item reached
-- whom by e-mail, so nobody gets the same item twice.
CREATE TABLE announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    sent_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    news_ids   TEXT    NOT NULL DEFAULT '[]',
    message    TEXT    NOT NULL DEFAULT '',
    recipients INTEGER NOT NULL DEFAULT 0,
    failed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE news_emailed (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    news_id         TEXT    NOT NULL,
    announcement_id INTEGER REFERENCES announcements(id) ON DELETE SET NULL,
    sent_at         INTEGER NOT NULL,
    PRIMARY KEY (user_id, news_id)
);
