import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';

// Load .env so we can derive the test DB URL at config time
dotenvConfig();

const devUrl = process.env.DATABASE_URL ?? '';
// TEST_DATABASE_URL overrides explicitly; otherwise append _test to the db name
const testUrl =
  process.env.TEST_DATABASE_URL ??
  devUrl.replace(/\/([^/?#]+)([?#].*)?$/, '/lore_test$2');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['src/__tests__/global-setup.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/*/domain/**', 'src/modules/*/application/**'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
    fileParallelism: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/__tests__/quality/**', 'e2e/**', 'test/architecture/fixtures/**'],
    env: {
      // Override DATABASE_URL for all test workers — dev DB is never touched
      DATABASE_URL: testUrl,
      // Tests are fully offline: deterministic hash embeddings, no LLM endpoint.
      // Suites that exercise LLM paths inject fake LanguageModels.
      LORE_EMBEDDING_PROVIDER: process.env.TEST_EMBEDDING_PROVIDER ?? 'hash',
      LLM_API_KEY: '',
      LLM_BASE_URL: '',
      LORE_API_KEY: process.env.LORE_API_KEY || 'changeme',
    },
  },
});
