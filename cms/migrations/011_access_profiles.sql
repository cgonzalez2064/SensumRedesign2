-- Access profiles reviewed:
--   stats    Estadísticas de visitas (now its own access; leads keep seeing them)
--   support  Gestión de solicitudes de soporte (manage everyone's tickets)
--   monitor  is now presented as "Salud del sitio"
-- Accounts that already saw the statistics (leads access) keep them.
UPDATE users SET permissions = permissions || ',stats'
 WHERE (',' || permissions || ',') LIKE '%,leads,%' AND (',' || permissions || ',') NOT LIKE '%,stats,%';
