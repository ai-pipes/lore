import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 60000,
    fileParallelism: false,
    include: ['src/__tests__/quality/**/*.test.ts'],
  },
});
