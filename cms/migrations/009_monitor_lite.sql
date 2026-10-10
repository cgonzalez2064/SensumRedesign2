-- Response time of the home page, measured by every scheduled check
-- (informational: it does not count toward availability).
ALTER TABLE monitor_runs ADD COLUMN response_ms INTEGER;
ALTER TABLE monitor_runs ADD COLUMN http_status INTEGER;

-- New access: "monitor" — the summary version of Monitoring (site status,
-- availability, response time and error counts, without technical details).
-- Accounts that could manage the whole site get it.
UPDATE users SET permissions = permissions || ',monitor' WHERE (',' || permissions || ',') LIKE '%,site,%';
