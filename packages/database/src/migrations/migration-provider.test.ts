import { describe, expect, it } from 'vitest';
import { RegisteredMigrationProvider, registeredMigrationNames } from './migration-provider';

describe('database migration registry', () => {
  it('uses immutable deterministic sortable migration names', async () => {
    const migrations = await new RegisteredMigrationProvider().getMigrations();

    expect(registeredMigrationNames).toStrictEqual(['0001_c02_database_baseline']);
    expect(Object.keys(migrations).sort()).toStrictEqual(registeredMigrationNames);
    expect(registeredMigrationNames.every((name) => /^\d{4}_[a-z0-9_]+$/u.test(name))).toBe(true);
  });

  it('provides explicit forward and backward migration functions', async () => {
    const migrations = await new RegisteredMigrationProvider().getMigrations();
    const baseline = migrations['0001_c02_database_baseline'];

    expect(typeof baseline?.up).toBe('function');
    expect(typeof baseline?.down).toBe('function');
  });
});
