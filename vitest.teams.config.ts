import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'packages/teams/src/**/*.test.ts',
      'apps/api/src/teams/**/*.test.ts',
      'tests/teams/**/*.test.ts',
      'tests/e2e/teams.test.ts',
      'tests/security/teams-security.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
