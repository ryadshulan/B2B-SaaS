import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('repository package boundaries', () => {
  it('provides every C00 shared package public entry point', async () => {
    const packages = [
      'ui',
      'database',
      'contracts',
      'auth',
      'config',
      'logger',
      'validation',
      'events',
      'testing',
    ];
    await expect(
      Promise.all(packages.map((name) => access(`packages/${name}/src/index.ts`))),
    ).resolves.toHaveLength(packages.length);
  });
});
