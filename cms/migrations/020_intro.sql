-- «Primeros pasos» on Inicio (October 2026): remembered per account, so
-- someone who closed it doesn't see it again on another device or browser.
ALTER TABLE users ADD COLUMN intro_done_at INTEGER;
