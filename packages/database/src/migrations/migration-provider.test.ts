import { describe, expect, it } from 'vitest';
import { RegisteredMigrationProvider, registeredMigrationNames } from './migration-provider';

describe('database migration registry', () => {
  it('uses immutable deterministic sortable migration names', async () => {
    const migrations = await new RegisteredMigrationProvider().getMigrations();

    expect(registeredMigrationNames).toStrictEqual([
      '0001_c02_database_baseline',
      '0002_c04_authentication_foundation',
      '0003_c05_organizations_workspaces',
      '0004_c06_workspace_memberships_rbac',
      '0005_c07_teams',
      '0006_c08_channels',
    ]);
    expect(Object.keys(migrations).sort()).toStrictEqual(registeredMigrationNames);
    expect(registeredMigrationNames.every((name) => /^\d{4}_[a-z0-9_]+$/u.test(name))).toBe(true);
  });

  it('provides explicit forward and backward migration functions', async () => {
    const migrations = await new RegisteredMigrationProvider().getMigrations();
    const baseline = migrations['0001_c02_database_baseline'];
    const authentication = migrations['0002_c04_authentication_foundation'];
    const tenancy = migrations['0003_c05_organizations_workspaces'];
    const access = migrations['0004_c06_workspace_memberships_rbac'];
    const teams = migrations['0005_c07_teams'];
    const channels = migrations['0006_c08_channels'];

    expect(typeof baseline?.up).toBe('function');
    expect(typeof baseline?.down).toBe('function');
    expect(typeof authentication?.up).toBe('function');
    expect(typeof authentication?.down).toBe('function');
    expect(typeof tenancy?.up).toBe('function');
    expect(typeof tenancy?.down).toBe('function');
    expect(typeof access?.up).toBe('function');
    expect(typeof access?.down).toBe('function');
    expect(typeof teams?.up).toBe('function');
    expect(typeof teams?.down).toBe('function');
    expect(typeof channels?.up).toBe('function');
    expect(typeof channels?.down).toBe('function');
  });
});
