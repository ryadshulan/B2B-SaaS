import { PERMISSIONS, WORKSPACE_ROLES, type Permission, type WorkspaceRole } from './types';

const NO_PERMISSIONS: readonly Permission[] = Object.freeze([]);

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly Permission[]>> =
  Object.freeze({
    owner: PERMISSIONS,
    admin: Object.freeze([
      'organization.read',
      'organization.update',
      'workspace.read',
      'workspace.update',
      'membership.read',
      'membership.manage',
      'team.read',
      'team.manage',
    ] as const),
    supervisor: Object.freeze([
      'organization.read',
      'workspace.read',
      'membership.read',
      'team.read',
      'team.manage',
    ] as const),
    agent: Object.freeze(['workspace.read', 'team.read'] as const),
    marketing: Object.freeze(['workspace.read', 'team.read'] as const),
    analyst: Object.freeze(['workspace.read', 'team.read'] as const),
  });

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRole(role: unknown): readonly Permission[] {
  return isWorkspaceRole(role) ? ROLE_PERMISSIONS[role] : NO_PERMISSIONS;
}

export function roleHasPermission(role: unknown, permission: unknown): boolean {
  return (
    isWorkspaceRole(role) && isPermission(permission) && ROLE_PERMISSIONS[role].includes(permission)
  );
}
