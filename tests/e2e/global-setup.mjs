// Boots an isolated Content Manager (fresh database, no real e-mail) for the browser tests.
import { startServer, createAdmin, ADMIN } from '../integration/helpers.mjs';

export const PORT = 8210;
export const EDITOR = { name: 'Elena Editora', email: 'elena.editora@example.test', password: 'Clave-Elena-2026' };
// A second administrator who is NOT the owner (the owner is ADMIN — see OWNER_EMAIL in helpers).
export const OTHER_ADMIN = { name: 'Omar Administrador', email: 'omar.admin@example.test', password: 'Clave-Omar-2026' };
// An account that may only change the website text.
export const TEXTS_ONLY = { name: 'Tere Textos', email: 'tere.textos@example.test', password: 'Clave-Tere-2026' };
// An account that sets up two-step sign-in in the browser tests.
export const TWO_STEP = { name: 'Tomás Dos Pasos', email: 'tomas.2fa@example.test', password: 'Clave-Tomas-2FA-2026' };

export default async function globalSetup() {
  const server = await startServer({ port: PORT });
  createAdmin(server, ADMIN);
  createAdmin(server, EDITOR);
  createAdmin(server, OTHER_ADMIN);
  createAdmin(server, TEXTS_ONLY);
  createAdmin(server, TWO_STEP);
  server.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TWO_STEP.email}'`);
  server.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TEXTS_ONLY.email}'`);
  server.sql(`UPDATE users SET role='editor' WHERE email='${EDITOR.email}'`);
  // A few error-log entries so Monitoring shows real content (one of each severity).
  const now = Math.floor(Date.now() / 1000);
  server.sql(`INSERT INTO error_log (created_at, severity, source, event, message, location, request, ref, fingerprint, alert, details) VALUES
    (${now - 60}, 'critical', 'server', 'unhandled_exception', 'RuntimeException: publish_write_failed', 'Publisher.php:372', 'PUT /api/content/footer', 'A1B2C3', 'e2e1', 'sent', '{}'),
    (${now - 3600}, 'error', 'server', 'mail_failed', 'Exception', '', '', NULL, 'e2e2', NULL, '{"driver":"smtp"}'),
    (${now - 7200}, 'warning', 'system', 'publish_drift_detected', 'Live pages differ from the saved content', '', '', NULL, 'e2e3', NULL, '{}')`);
  // One support ticket with a conversation, so the ticket screen has content.
  server.sql(`INSERT INTO support_reports (user_id, reporter_name, reporter_email, type, title, description, area, page, context, fingerprint, email_status, email_attempts, created_at, updated_at, status, priority, owner_unread)
    VALUES ((SELECT id FROM users WHERE email='${EDITOR.email}'), '${EDITOR.name}', '${EDITOR.email}', 'problem', 'La galería no abre en el celular', 'Toco «Ver detalles» y no pasa nada.', 'website', '/#proyectos', '{"browser":"Safari 17","device":"mobile"}', 'e2e-ticket', 'sent', 1, ${now - 7200}, ${now - 3600}, 'waiting', 'high', 0)`);
  server.sql(`INSERT INTO report_messages (report_id, user_id, author_name, author_role, kind, body, details, email_status, created_at) VALUES
    (1, (SELECT id FROM users WHERE email='${ADMIN.email}'), '${ADMIN.name}', 'support', 'event', '', '{"action":"status","from":"new","to":"waiting"}', NULL, ${now - 3700}),
    (1, (SELECT id FROM users WHERE email='${ADMIN.email}'), '${ADMIN.name}', 'support', 'message', '¿Qué modelo de celular usas?', '{}', 'sent', ${now - 3600})`);
  server.cli(['publish']);
  process.env.E2E_BASE = server.base;
  process.env.E2E_STORAGE = server.storage();
  process.env.E2E_PUBLIC = server.public();
  return async () => { await server.stop(); };
}
