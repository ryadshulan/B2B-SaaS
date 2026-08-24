import type { Migration, MigrationProvider } from 'kysely';
import { c02DatabaseBaseline } from './0001_c02_database_baseline';
import { c04AuthenticationFoundation } from './0002_c04_authentication_foundation';

const migrationRegistry: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_c02_database_baseline': c02DatabaseBaseline,
  '0002_c04_authentication_foundation': c04AuthenticationFoundation,
});

export const registeredMigrationNames = Object.freeze(Object.keys(migrationRegistry).sort());

export class RegisteredMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrationRegistry });
  }
}
