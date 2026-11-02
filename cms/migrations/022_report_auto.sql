-- The monthly report can go out on its own (Informe mensual → Envío automático, the
-- owner's choice): reports sent that way are marked, so the history says «automático».
ALTER TABLE site_reports ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
