import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'packages/channels/src/**/*.test.ts',
      'apps/api/src/channels/**/*.test.ts',
      'tests/channels/**/*.test.ts',
      'tests/e2e/channels.test.ts',
      'tests/security/channels-security.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
