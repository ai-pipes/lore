import 'dotenv/config';
import { initDb, resetDb, getDb } from '../platform/db.js';
import { initEmbeddings } from '../modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';

// Must run synchronously at module load time so that getEmbeddingProvider()
// returns the provider when test files evaluate their top-level skipIf conditions.
initEmbeddings();

beforeAll(async () => {
  // Reset the singleton so initDb() always connects with the current DATABASE_URL.
  // This matters in watch mode where the config-injected TEST_DATABASE_URL must
  // take effect on every re-run.
  resetDb();
  await initDb();
}, 30_000);

afterAll(async () => {
  const db = getDb();
  // Users too: the e2e server bootstraps its admin only into a database without users.
  await db.execute(
    'TRUNCATE TABLE document_vectors, document_metadata, documents, versions, libraries, users CASCADE',
  );
});
