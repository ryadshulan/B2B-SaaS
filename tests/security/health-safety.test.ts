import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('health endpoint safety', () => {
  it('does not inspect or return environment configuration', async () => {
    const source = await readFile('apps/api/src/health/health.controller.ts', 'utf8');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('DATABASE_URL');
  });
});
