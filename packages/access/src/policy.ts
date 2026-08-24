import { PERMISSIONS, WORKSPACE_ROLES, type Permission, type WorkspaceRole } from './types';

const allPermissions: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly Permission[]>> =
  Object.freeze({
    owner: allPermissions,
    admin: [
      'organization.read',
      'organization.update',
      'workspace.read',
      'workspace.update',
      'membership.read',
      'membership.manage',
    ],
    supervisor: ['organization.read', 'workspace.read', 'membership.read'],
    agent: ['workspace.read'],
    marketing: ['workspace.read'],
    analyst: ['workspace.read'],
  });

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRole(role: unknown): readonly Permission[] {
  return isWorkspaceRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function roleHasPermission(role: unknown, permission: unknown): boolean {
  return (
    isWorkspaceRole(role) && isPermission(permission) && ROLE_PERMISSIONS[role].includes(permission)
  );
}
