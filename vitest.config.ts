import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/integration/**', '**/e2e/**'],
    testTimeout: 10_000,
  },
});
