// Boots an isolated Content Manager (fresh database, no real e-mail) for the browser tests.
import { startServer, createAdmin, ADMIN } from '../integration/helpers.mjs';

export const PORT = 8210;
export const EDITOR = { name: 'Elena Editora', email: 'elena.editora@example.test', password: 'Clave-Elena-2026' };

export default async function globalSetup() {
  const server = await startServer({ port: PORT });
  createAdmin(server, ADMIN);
  createAdmin(server, EDITOR);
  server.sql(`UPDATE users SET role='editor' WHERE email='${EDITOR.email}'`);
  server.cli(['publish']);
  process.env.E2E_BASE = server.base;
  process.env.E2E_STORAGE = server.storage();
  process.env.E2E_PUBLIC = server.public();
  return async () => { await server.stop(); };
}
