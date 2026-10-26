-- User management beyond the owner (October 2026).
--
-- must_change_password: set when someone else gives the account a password
-- (typed or generated in Usuarios); the panel then asks for a new one before
-- anything else.
-- two_factor_required: two-step sign-in required for this person even when
-- the site-wide policy (Seguridad) does not require it.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_required INTEGER NOT NULL DEFAULT 0;

-- New permission "users" (Gestión de usuarios), part of the "Administrador del
-- sitio" access type. Accounts that already had exactly that access type get it,
-- in any order: accounts from before 011 have "monitor" before "stats" (each
-- migration appended its own). Nine entries, all nine of the type.
UPDATE users SET permissions = permissions || ',users'
 WHERE length(permissions) - length(replace(permissions, ',', '')) = 8
   AND (',' || permissions || ',') LIKE '%,texts,%'
   AND (',' || permissions || ',') LIKE '%,contact,%'
   AND (',' || permissions || ',') LIKE '%,photos,%'
   AND (',' || permissions || ',') LIKE '%,documents,%'
   AND (',' || permissions || ',') LIKE '%,site,%'
   AND (',' || permissions || ',') LIKE '%,leads,%'
   AND (',' || permissions || ',') LIKE '%,stats,%'
   AND (',' || permissions || ',') LIKE '%,monitor,%'
   AND (',' || permissions || ',') LIKE '%,report,%';
