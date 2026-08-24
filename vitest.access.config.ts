import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'packages/access/src/**/*.test.ts',
      'apps/api/src/access/**/*.test.ts',
      'tests/access/**/*.test.ts',
      'tests/e2e/access.test.ts',
      'tests/security/access-security.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
