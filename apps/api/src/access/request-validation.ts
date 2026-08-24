import {
  AccessError,
  isWorkspaceRole,
  type WorkspaceMembershipStatus,
  type WorkspaceRole,
} from '@customer-ops/access';
import { AuthError, canonicalizeEmail } from '@customer-ops/auth';
import type { WorkspaceId } from '@customer-ops/tenancy';
import type { Request } from 'express';
import { ApplicationError } from '../errors/application-error';

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new AccessError('validation_error');
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new AccessError('validation_error');
  }
  return value;
}

export function parseCanonicalUuid(value: unknown): string {
  if (typeof value !== 'string' || !canonicalUuid.test(value)) {
    throw new AccessError('validation_error');
  }
  return value;
}

export function readRequestedWorkspaceId(request: Request): WorkspaceId {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'x-workspace-id') {
      const value = request.rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  if (values.length === 0) {
    throw new ApplicationError({
      code: 'workspace_context_required',
      httpStatus: 400,
      safeMessage: 'Workspace context is required',
    });
  }
  if (values.length !== 1 || !canonicalUuid.test(values[0] ?? '')) {
    throw new ApplicationError({
      code: 'workspace_context_invalid',
      httpStatus: 400,
      safeMessage: 'Workspace context is invalid',
    });
  }
  return values[0] as WorkspaceId;
}

export function parseOrganizationBootstrapBody(body: unknown): {
  organizationName: unknown;
  workspaceName: unknown;
} {
  const value = requireExactKeys(body, ['organizationName', 'workspaceName']);
  return {
    organizationName: value['organizationName'],
    workspaceName: value['workspaceName'],
  };
}

export function parseAddMembershipBody(body: unknown): {
  emailNormalized: string;
  role: WorkspaceRole;
} {
  const value = requireExactKeys(body, ['email', 'role']);
  if (!isWorkspaceRole(value['role'])) throw new AccessError('validation_error');
  try {
    return {
      emailNormalized: canonicalizeEmail(value['email']).normalized,
      role: value['role'],
    };
  } catch (error) {
    if (error instanceof AuthError) throw new AccessError('validation_error');
    throw error;
  }
}

export function parseUpdateMembershipBody(body: unknown): {
  role?: WorkspaceRole;
  status?: WorkspaceMembershipStatus;
} {
  const value = requireExactKeys(body, [], ['role', 'status']);
  if (Object.keys(value).length === 0) throw new AccessError('validation_error');
  if (value['role'] !== undefined && !isWorkspaceRole(value['role'])) {
    throw new AccessError('validation_error');
  }
  if (
    value['status'] !== undefined &&
    value['status'] !== 'active' &&
    value['status'] !== 'disabled'
  ) {
    throw new AccessError('validation_error');
  }
  return {
    ...(value['role'] === undefined ? {} : { role: value['role'] }),
    ...(value['status'] === undefined ? {} : { status: value['status'] }),
  };
}
