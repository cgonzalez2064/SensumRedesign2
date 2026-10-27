-- Fewer, clearer roles (October 2026): Administrador, Editor del sitio web,
-- Ventas y prospectos and Consulta (solo lectura). Anything else is added one
-- section at a time («Secciones adicionales», or by granting «Pedir acceso»).
--
-- Every account keeps all it could already open and, when no role covers it
-- (the old Redactor, Fotos y portafolio, Datos de contacto, Soporte técnico or
-- a custom mix), gets the role that adds the least to what it already has:
--   Redactor / Fotos y portafolio / Datos de contacto -> Editor del sitio web
--   Gerencia (consulta: stats, monitor)               -> Consulta (+ informe)
--   Soporte técnico (support, monitor, report, site)  -> Consulta + its sections
--   only "site" or "users" (no role shares anything)   -> Consulta + that section
-- Nobody loses access; the owner is unaffected (decided by OWNER_EMAIL).
--
-- Rollback (the accounts' previous access, kept here):
--   UPDATE users SET permissions = (SELECT m.before FROM roles_migration_017 m WHERE m.user_id = users.id)
--    WHERE id IN (SELECT user_id FROM roles_migration_017);
CREATE TABLE roles_migration_017 (
  user_id     INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  before      TEXT NOT NULL,
  after       TEXT NOT NULL,
  role        TEXT NOT NULL,
  migrated_at INTEGER NOT NULL
);

CREATE TEMP TABLE r17 AS
SELECT id, email, permissions AS p,
  (',' || permissions || ',' LIKE '%,texts,%') AS t,
  (',' || permissions || ',' LIKE '%,contact,%') AS c,
  (',' || permissions || ',' LIKE '%,photos,%') AS ph,
  (',' || permissions || ',' LIKE '%,documents,%') AS d,
  (',' || permissions || ',' LIKE '%,site,%') AS si,
  (',' || permissions || ',' LIKE '%,leads,%') AS l,
  (',' || permissions || ',' LIKE '%,stats,%') AS s,
  (',' || permissions || ',' LIKE '%,monitor,%') AS m,
  (',' || permissions || ',' LIKE '%,report,%') AS r,
  (',' || permissions || ',' LIKE '%,support,%') AS su,
  (',' || permissions || ',' LIKE '%,users,%') AS u
FROM users;

-- What each role would add (missing) and share (overlap) for each account.
-- Administrador is never given here: only accounts that already have all of it
-- are administrators (and they already have Editor's sections, so they stay as they are).
CREATE TEMP TABLE r17_fit AS
SELECT id, 'content' AS role, 0 AS pref, 1 AS fb, t + c + ph + d AS overlap, 4 - (t + c + ph + d) AS missing FROM r17
UNION ALL SELECT id, 'sales', 1, 2, l + s, 2 - (l + s) FROM r17
UNION ALL SELECT id, 'management', 2, 0, s + m + r, 3 - (s + m + r) FROM r17;

-- Accounts with no complete role: the role adding the least among those it
-- shares something with (then the one sharing more); sharing nothing at all,
-- the read-only one.
CREATE TEMP TABLE r17_pick AS
SELECT id, role FROM (
  SELECT id, role, ROW_NUMBER() OVER (PARTITION BY id ORDER BY overlap = 0, CASE WHEN overlap = 0 THEN fb ELSE missing END, overlap DESC, pref) AS n
  FROM r17_fit
  WHERE id NOT IN (SELECT id FROM r17_fit WHERE missing = 0)
) WHERE n = 1;

INSERT INTO roles_migration_017 (user_id, email, before, after, role, migrated_at)
SELECT x.id, x.email, x.p, trim(
    (CASE WHEN x.t OR k.role IN ('admin', 'content') THEN 'texts,' ELSE '' END) ||
    (CASE WHEN x.c OR k.role IN ('admin', 'content') THEN 'contact,' ELSE '' END) ||
    (CASE WHEN x.ph OR k.role IN ('admin', 'content') THEN 'photos,' ELSE '' END) ||
    (CASE WHEN x.d OR k.role IN ('admin', 'content') THEN 'documents,' ELSE '' END) ||
    (CASE WHEN x.si OR k.role = 'admin' THEN 'site,' ELSE '' END) ||
    (CASE WHEN x.l OR k.role IN ('admin', 'sales') THEN 'leads,' ELSE '' END) ||
    (CASE WHEN x.s OR k.role IN ('admin', 'sales', 'management') THEN 'stats,' ELSE '' END) ||
    (CASE WHEN x.m OR k.role IN ('admin', 'management') THEN 'monitor,' ELSE '' END) ||
    (CASE WHEN x.r OR k.role IN ('admin', 'management') THEN 'report,' ELSE '' END) ||
    (CASE WHEN x.su THEN 'support,' ELSE '' END) ||
    (CASE WHEN x.u OR k.role = 'admin' THEN 'users,' ELSE '' END), ','), k.role, strftime('%s', 'now')
FROM r17 x JOIN r17_pick k ON k.id = x.id;

UPDATE users SET permissions = (SELECT m.after FROM roles_migration_017 m WHERE m.user_id = users.id)
 WHERE id IN (SELECT user_id FROM roles_migration_017);

DROP TABLE r17_pick;
DROP TABLE r17_fit;
DROP TABLE r17;
