import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      'tests/database/migration-cli.test.ts',
      'tests/integration/database-foundation.test.ts',
    ],
  },
});
