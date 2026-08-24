import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'packages/auth/src/**/*.test.ts',
      'apps/api/src/auth/**/*.test.ts',
      'tests/integration/authentication-foundation.test.ts',
      'tests/e2e/authentication.test.ts',
      'tests/security/authentication-security.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
