import type { WorkspaceMembershipId } from '@customer-ops/access';
import {
  isTeamMembershipStatus,
  isTeamStatus,
  TeamError,
  type AddTeamMemberInput,
  type CreateTeamInput,
  type TeamId,
  type TeamMembershipId,
  type UpdateTeamInput,
  type UpdateTeamMemberInput,
} from '@customer-ops/teams';

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new TeamError('validation_error');
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new TeamError('validation_error');
  }
  return value;
}

function parseUuid(value: unknown): string {
  if (typeof value !== 'string' || !canonicalUuid.test(value)) {
    throw new TeamError('validation_error');
  }
  return value;
}

export function parseTeamId(value: unknown): TeamId {
  return parseUuid(value) as TeamId;
}

export function parseTeamMembershipId(value: unknown): TeamMembershipId {
  return parseUuid(value) as TeamMembershipId;
}

export function parseCreateTeamBody(body: unknown): CreateTeamInput {
  const value = requireExactKeys(body, ['name']);
  return { name: value['name'] };
}

export function parseUpdateTeamBody(body: unknown): UpdateTeamInput {
  const value = requireExactKeys(body, [], ['name', 'status']);
  if (Object.keys(value).length === 0) throw new TeamError('validation_error');
  if (value['status'] !== undefined && !isTeamStatus(value['status'])) {
    throw new TeamError('validation_error');
  }
  return {
    ...(Object.hasOwn(value, 'name') ? { name: value['name'] } : {}),
    ...(Object.hasOwn(value, 'status') ? { status: value['status'] } : {}),
  };
}

export function parseAddTeamMemberBody(body: unknown): AddTeamMemberInput {
  const value = requireExactKeys(body, ['workspaceMembershipId']);
  return {
    workspaceMembershipId: parseUuid(value['workspaceMembershipId']) as WorkspaceMembershipId,
  };
}

export function parseUpdateTeamMemberBody(body: unknown): UpdateTeamMemberInput {
  const value = requireExactKeys(body, ['status']);
  if (!isTeamMembershipStatus(value['status'])) throw new TeamError('validation_error');
  return { status: value['status'] };
}
