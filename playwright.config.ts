// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const devUrl = process.env.DATABASE_URL ?? '';
const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  devUrl.replace(/\/([^/?#]+)([?#].*)?$/, '/lore_test$2');

// LORE_E2E_PORT moves the e2e server off 3737 (e2e/helpers.ts reads the same variable)
const E2E_PORT = parseInt(process.env.LORE_E2E_PORT ?? '3737', 10);

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    headless: true,
  },
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: `npx tsx e2e/start-server.ts`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      DATABASE_URL: testDbUrl,
      LORE_API_KEY: process.env.LORE_API_KEY ?? 'changeme',
      LORE_PORT: String(E2E_PORT),
      // The first admin, created by bootstrapAdmin when the test database has no users
      LORE_ADMIN_LOGIN: 'e2e-admin',
      LORE_ADMIN_PASSWORD: 'e2e-admin-password-1',
      NODE_ENV: 'test',
      // Offline: deterministic embeddings, no LLM (chat answers with search results only)
      LORE_EMBEDDING_PROVIDER: 'hash',
      LLM_API_KEY: '',
      LLM_BASE_URL: '',
    },
  },
});
