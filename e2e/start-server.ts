import 'dotenv/config';
import { initDb } from '../src/platform/db.js';
import { initEmbeddings } from '../src/modules/catalog/index.js';
import { bootstrapAdmin, createPgIdentity } from '../src/modules/identity/index.js';
import { buildServer } from '../src/platform/http/server.js';
import ensureTestDatabase from './global-setup.js';

const port = parseInt(process.env.LORE_PORT ?? '3737', 10);

async function main() {
  // Playwright starts the web server before globalSetup runs, so create the test database here too.
  await ensureTestDatabase();
  await initDb();
  initEmbeddings();
  const app = await buildServer();
  await bootstrapAdmin(
    createPgIdentity({ adminKey: process.env.LORE_API_KEY }),
    { login: process.env.LORE_ADMIN_LOGIN, password: process.env.LORE_ADMIN_PASSWORD },
    { info: (m) => console.log(m), warn: (m) => console.warn(m) },
  );
  await app.listen({ port, host: '127.0.0.1' });
  // Signal readiness (Playwright watches stdout)
  console.log(`E2E server ready on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
