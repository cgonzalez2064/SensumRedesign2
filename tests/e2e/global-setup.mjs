// Boots an isolated Content Manager (fresh database, no real e-mail) for the browser tests.
import { startServer, createAdmin, ADMIN } from '../integration/helpers.mjs';

export const PORT = 8210;
export const EDITOR = { name: 'Elena Editora', email: 'elena.editora@example.test', password: 'Clave-Elena-2026' };
// A second administrator who is NOT the owner (the owner is ADMIN — see OWNER_EMAIL in helpers).
export const OTHER_ADMIN = { name: 'Omar Administrador', email: 'omar.admin@example.test', password: 'Clave-Omar-2026' };
// An account that may only change the website text.
export const TEXTS_ONLY = { name: 'Tere Textos', email: 'tere.textos@example.test', password: 'Clave-Tere-2026' };
// An account that only sees Prospectos and Estadísticas (sales).
export const SALES = { name: 'Vera Ventas', email: 'vera.ventas@example.test', password: 'Clave-Vera-Ventas-2026' };
// "Gerencia (consulta)": basic statistics and Salud del sitio, nothing to edit.
export const MANAGER = { name: 'Gael Gerente', email: 'gael.gerente@example.test', password: 'Clave-Gael-Gerente-2026' };
// "Soporte técnico": manages everyone's support requests.
export const SUPPORT = { name: 'Iris Soporte', email: 'iris.soporte@example.test', password: 'Clave-Iris-Soporte-2026' };
// An account that sets up two-step sign-in in the browser tests.
export const TWO_STEP = { name: 'Tomás Dos Pasos', email: 'tomas.2fa@example.test', password: 'Clave-Tomas-2FA-2026' };

export default async function globalSetup() {
  const server = await startServer({ port: PORT });
  createAdmin(server, ADMIN);
  createAdmin(server, EDITOR);
  createAdmin(server, OTHER_ADMIN);
  createAdmin(server, TEXTS_ONLY);
  createAdmin(server, TWO_STEP);
  createAdmin(server, SALES);
  createAdmin(server, MANAGER);
  createAdmin(server, SUPPORT);
  server.sql(`UPDATE users SET role='editor', permissions='leads,stats' WHERE email='${SALES.email}'`);
  server.sql(`UPDATE users SET role='editor', permissions='stats,monitor' WHERE email='${MANAGER.email}'`);
  server.sql(`UPDATE users SET role='editor', permissions='site,monitor,report,support' WHERE email='${SUPPORT.email}'`);
  server.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TWO_STEP.email}'`);
  server.sql(`UPDATE users SET role='editor', permissions='texts' WHERE email='${TEXTS_ONLY.email}'`);
  // Everything an editor can change, but not other people's accounts.
  server.sql(`UPDATE users SET role='editor', permissions='texts,contact,photos,documents,site,leads,stats,monitor,report' WHERE email='${EDITOR.email}'`);
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
  // Contact-form messages (Prospectos) and 30 days of visit statistics.
  server.sql(`INSERT INTO leads (name, email, phone, service, message, lang, status, amount, notified, unread, created_at, updated_at, contacted_at) VALUES
    ('Lucía Méndez', 'lucia.mendez@example.test', '5555-1234', 'Remodelaciones', 'Quisiera una cotización para remodelar la cocina y el baño de mi casa en zona 15.', 'es', 'new', NULL, 1, 1, ${now - 1800}, ${now - 1800}, NULL),
    ('Robert Smith', 'robert.smith@example.test', '+1 305 555 0100', 'Diseño arquitectónico', 'We are planning a small office building and need architectural design.', 'en', 'contacted', NULL, 0, 0, ${now - 3 * 86400}, ${now - 2 * 86400}, ${now - 2 * 86400}),
    ('Constructora Ejemplo, S.A.', 'compras@example.test', '2222-3333', 'Obra civil', 'Necesitamos fundición de losa para una bodega de 400 m².', 'es', 'won', 185000, 1, 0, ${now - 9 * 86400}, ${now - 5 * 86400}, ${now - 8 * 86400})`);
  server.sql(`INSERT INTO lead_notes (lead_id, user_id, author, kind, body, details, created_at) VALUES
    (2, NULL, 'Vera Ventas', 'event', '', '{"action":"status","from":"new","to":"contacted"}', ${now - 2 * 86400}),
    (2, NULL, 'Vera Ventas', 'note', 'Llamada el martes: enviar propuesta en inglés.', '{}', ${now - 2 * 86400 + 60})`);
  const days = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date((now - i * 86400) * 1000); const day = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const v = 20 + ((i * 7) % 23);
    days.push(`('${day}', 'visitor', '', ${v})`, `('${day}', 'view', 'home', ${v * 2 + 3})`, `('${day}', 'source', 'google', ${Math.round(v * 0.5)})`, `('${day}', 'source', 'direct', ${Math.round(v * 0.3)})`,
      `('${day}', 'source', 'facebook', ${Math.round(v * 0.2)})`, `('${day}', 'device', 'mobile', ${Math.round(v * 0.7)})`, `('${day}', 'device', 'desktop', ${Math.round(v * 0.3)})`,
      `('${day}', 'lang', 'es', ${v - 2})`, `('${day}', 'lang', 'en', 2)`, `('${day}', 'click', 'whatsapp', ${i % 4})`, `('${day}', 'click', 'phone', ${i % 2})`);
  }
  server.sql(`INSERT INTO analytics_daily (day, metric, dim, count) VALUES ${days.join(', ')}`);
  // 30 days of scheduled checks (every 2 hours) with response times; one day with a failed check.
  const runs = [];
  for (let i = 0; i < 30 * 12; i++) {
    const ts = now - i * 7200;
    const failed = i === 50;
    runs.push(`(${ts}, ${failed ? 0 : 1}, '${failed ? 'database' : ''}', ${failed ? 'NULL' : 180 + ((i * 37) % 160)}, ${failed ? 'NULL' : 200})`);
  }
  server.sql(`INSERT INTO monitor_runs (created_at, ok, failed, response_ms, http_status) VALUES ${runs.join(', ')}`);
  server.sql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('monitor_last_run', '${now}', ${now})`);
  // These accounts have used the panel before: no first-sign-in welcome (it has its own test).
  server.sql("UPDATE users SET onboarded_at = strftime('%s','now')");
  server.cli(['publish']);
  process.env.E2E_BASE = server.base;
  process.env.E2E_STORAGE = server.storage();
  process.env.E2E_PUBLIC = server.public();
  return async () => { await server.stop(); };
}
