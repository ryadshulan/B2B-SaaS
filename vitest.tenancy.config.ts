import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'packages/tenancy/src/**/*.test.ts',
      'tests/tenancy/**/*.test.ts',
      'tests/security/tenancy-security.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
