import { describe, expect, it } from 'vitest';
import {
  isPermission,
  isWorkspaceRole,
  permissionsForRole,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from './policy';
import { PERMISSIONS, WORKSPACE_ROLES, type WorkspaceRole } from './types';

describe('workspace role permission policy', () => {
  it('defines exactly the six built-in roles and the small C06 permission catalog', () => {
    expect(WORKSPACE_ROLES).toStrictEqual([
      'owner',
      'admin',
      'supervisor',
      'agent',
      'marketing',
      'analyst',
    ]);
    expect(PERMISSIONS).toStrictEqual([
      'organization.read',
      'organization.update',
      'workspace.read',
      'workspace.update',
      'membership.read',
      'membership.manage',
      'membership.manage_owner',
    ]);
  });

  it('maps every role to its exact explicit permission set', () => {
    const expected: Record<WorkspaceRole, readonly string[]> = {
      owner: [...PERMISSIONS],
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
    };
    expect(ROLE_PERMISSIONS).toStrictEqual(expected);
    for (const role of WORKSPACE_ROLES) {
      expect(permissionsForRole(role)).toStrictEqual(expected[role]);
    }
  });

  it('fails closed for unknown roles and permissions', () => {
    expect(isWorkspaceRole('administrator')).toBe(false);
    expect(isPermission('membership.delete')).toBe(false);
    expect(permissionsForRole('administrator')).toStrictEqual([]);
    expect(roleHasPermission('administrator', 'workspace.read')).toBe(false);
    expect(roleHasPermission('owner', 'membership.delete')).toBe(false);
  });

  it('reserves owner membership management to owners', () => {
    expect(roleHasPermission('owner', 'membership.manage_owner')).toBe(true);
    for (const role of WORKSPACE_ROLES.filter((candidate) => candidate !== 'owner')) {
      expect(roleHasPermission(role, 'membership.manage_owner')).toBe(false);
    }
  });
});
