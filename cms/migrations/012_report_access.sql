-- Monthly report split in two: the client version (e-mail/PDF, value of the
-- month) and the technical detail (backups, certificates, errors, to-dos).
--   report  Informe mensual (consulta): see both versions, without sending.
-- Part of the "Administrador del sitio" and "Soporte técnico" types: accounts
-- that had both "site" and "monitor" (those two types) receive it.
UPDATE users SET permissions = permissions || ',report'
 WHERE (',' || permissions || ',') LIKE '%,site,%' AND (',' || permissions || ',') LIKE '%,monitor,%'
   AND (',' || permissions || ',') NOT LIKE '%,report,%';
