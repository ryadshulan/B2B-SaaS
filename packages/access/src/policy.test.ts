import { describe, expect, it } from 'vitest';
import {
  isPermission,
  isWorkspaceRole,
  permissionsForRole,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from './policy';
import { PERMISSIONS, WORKSPACE_ROLES, type WorkspaceRole } from './types';

const EXPECTED_ROLES = ['owner', 'admin', 'supervisor', 'agent', 'marketing', 'analyst'] as const;

const EXPECTED_PERMISSIONS = [
  'organization.read',
  'organization.update',
  'workspace.read',
  'workspace.update',
  'membership.read',
  'membership.manage',
  'membership.manage_owner',
  'team.read',
  'team.manage',
  'channel.read',
  'channel.manage',
] as const;

const EXPECTED_ROLE_PERMISSIONS: Record<WorkspaceRole, readonly string[]> = {
  owner: EXPECTED_PERMISSIONS,
  admin: [
    'organization.read',
    'organization.update',
    'workspace.read',
    'workspace.update',
    'membership.read',
    'membership.manage',
    'team.read',
    'team.manage',
    'channel.read',
    'channel.manage',
  ],
  supervisor: [
    'organization.read',
    'workspace.read',
    'membership.read',
    'team.read',
    'team.manage',
    'channel.read',
  ],
  agent: ['workspace.read', 'team.read', 'channel.read'],
  marketing: ['workspace.read', 'team.read', 'channel.read'],
  analyst: ['workspace.read', 'team.read', 'channel.read'],
};

describe('workspace role permission policy', () => {
  it('defines exactly the six built-in roles and the small C06 permission catalog', () => {
    expect(WORKSPACE_ROLES).toStrictEqual(EXPECTED_ROLES);
    expect(PERMISSIONS).toStrictEqual(EXPECTED_PERMISSIONS);
  });

  it('maps every role to its exact explicit permission set', () => {
    expect(ROLE_PERMISSIONS).toStrictEqual(EXPECTED_ROLE_PERMISSIONS);
    for (const role of WORKSPACE_ROLES) {
      expect(permissionsForRole(role)).toStrictEqual(EXPECTED_ROLE_PERMISSIONS[role]);
    }
    expect(permissionsForRole('owner')).toStrictEqual(EXPECTED_PERMISSIONS);
  });

  it('freezes both catalogs, the role mapping, and every nested permission collection', () => {
    expect(Object.isFrozen(WORKSPACE_ROLES)).toBe(true);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of EXPECTED_ROLES) {
      expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('does not expose mutable shared policy through permissionsForRole', () => {
    const agentPermissions = permissionsForRole('agent') as unknown as string[];

    expect(() => agentPermissions.push('membership.manage')).toThrow(TypeError);
    expect(() => agentPermissions.splice(0, 1, 'membership.manage')).toThrow(TypeError);
    expect(() => {
      agentPermissions[0] = 'membership.manage';
    }).toThrow(TypeError);

    expect(ROLE_PERMISSIONS.agent).toStrictEqual([
      'workspace.read',
      'team.read',
      'channel.read',
    ]);
    expect(roleHasPermission('agent', 'membership.manage')).toBe(false);
  });

  it('protects role and permission recognition from runtime catalog mutation', () => {
    const mutablePermissions = PERMISSIONS as unknown as string[];
    const mutableRoles = WORKSPACE_ROLES as unknown as string[];

    expect(() => mutablePermissions.push('membership.delete')).toThrow(TypeError);
    expect(() => {
      mutablePermissions[0] = 'membership.delete';
    }).toThrow(TypeError);
    expect(() => mutableRoles.push('administrator')).toThrow(TypeError);
    expect(() => {
      mutableRoles[0] = 'administrator';
    }).toThrow(TypeError);

    expect(isPermission('membership.delete')).toBe(false);
    expect(isPermission('organization.read')).toBe(true);
    expect(isWorkspaceRole('administrator')).toBe(false);
    expect(isWorkspaceRole('owner')).toBe(true);
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

  it('grants team management only to owner, admin, and supervisor while every role can read', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleHasPermission(role, 'team.read')).toBe(true);
      expect(roleHasPermission(role, 'team.manage')).toBe(
        role === 'owner' || role === 'admin' || role === 'supervisor',
      );
    }
  });

  it('grants channel management only to owner and admin while every role can read', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleHasPermission(role, 'channel.read')).toBe(true);
      expect(roleHasPermission(role, 'channel.manage')).toBe(
        role === 'owner' || role === 'admin',
      );
    }
  });
});
