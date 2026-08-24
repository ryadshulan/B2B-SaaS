import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
