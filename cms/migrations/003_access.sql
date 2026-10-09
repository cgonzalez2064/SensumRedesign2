-- Access types: each account has a set of permissions (what it may change).
-- The owner account (OWNER_EMAIL) can always do everything, including users,
-- Monitoring and the monthly site report.
--   texts      Textos del sitio
--   contact    Datos de contacto
--   photos     Fotos (Nosotros y proyectos)
--   documents  Portafolio en PDF
--   site       Estado del sitio: actividad reciente y volver a publicar
ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT 'texts,contact,photos,documents';
UPDATE users SET permissions = 'texts,contact,photos,documents,site' WHERE role = 'admin';
