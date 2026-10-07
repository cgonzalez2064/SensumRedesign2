// Boots an isolated Content Manager (fresh database, no real e-mail) for the browser tests.
import { startServer, createAdmin, ADMIN } from '../integration/helpers.mjs';

export const PORT = 8210;
export const EDITOR = { name: 'Elena Editora', email: 'elena.editora@example.test', password: 'Clave-Elena-2026' };
// A second administrator who is NOT the owner (the owner is ADMIN — see OWNER_EMAIL in helpers).
export const OTHER_ADMIN = { name: 'Omar Administrador', email: 'omar.admin@example.test', password: 'Clave-Omar-2026' };

export default async function globalSetup() {
  const server = await startServer({ port: PORT });
  createAdmin(server, ADMIN);
  createAdmin(server, EDITOR);
  createAdmin(server, OTHER_ADMIN);
  server.sql(`UPDATE users SET role='editor' WHERE email='${EDITOR.email}'`);
  // A few error-log entries so Monitoring shows real content (one of each severity).
  const now = Math.floor(Date.now() / 1000);
  server.sql(`INSERT INTO error_log (created_at, severity, source, event, message, location, request, ref, fingerprint, alert, details) VALUES
    (${now - 60}, 'critical', 'server', 'unhandled_exception', 'RuntimeException: publish_write_failed', 'Publisher.php:372', 'PUT /api/content/footer', 'A1B2C3', 'e2e1', 'sent', '{}'),
    (${now - 3600}, 'error', 'server', 'mail_failed', 'Exception', '', '', NULL, 'e2e2', NULL, '{"driver":"smtp"}'),
    (${now - 7200}, 'warning', 'system', 'publish_drift_detected', 'Live pages differ from the saved content', '', '', NULL, 'e2e3', NULL, '{}')`);
  server.cli(['publish']);
  process.env.E2E_BASE = server.base;
  process.env.E2E_STORAGE = server.storage();
  process.env.E2E_PUBLIC = server.public();
  return async () => { await server.stop(); };
}
