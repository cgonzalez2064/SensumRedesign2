-- Wiki (October 2026): which «Novedades» (new features, cms/wiki/wiki.json)
-- each person has already seen, so each one is shown once.
CREATE TABLE wiki_news_seen (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    news_id TEXT    NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, news_id)
);
