import type { Migration, MigrationProvider } from 'kysely';
import { c02DatabaseBaseline } from './0001_c02_database_baseline';
import { c04AuthenticationFoundation } from './0002_c04_authentication_foundation';
import { c05OrganizationsWorkspaces } from './0003_c05_organizations_workspaces';
import { c06WorkspaceMembershipsRbac } from './0004_c06_workspace_memberships_rbac';
import { c07Teams } from './0005_c07_teams';

const migrationRegistry: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_c02_database_baseline': c02DatabaseBaseline,
  '0002_c04_authentication_foundation': c04AuthenticationFoundation,
  '0003_c05_organizations_workspaces': c05OrganizationsWorkspaces,
  '0004_c06_workspace_memberships_rbac': c06WorkspaceMembershipsRbac,
  '0005_c07_teams': c07Teams,
});

export const registeredMigrationNames = Object.freeze(Object.keys(migrationRegistry).sort());

export class RegisteredMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrationRegistry });
  }
}
