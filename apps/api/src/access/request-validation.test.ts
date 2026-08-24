import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { getWorkspaceAccessContext } from './workspace-access-request';
import { parseUpdateMembershipBody, readRequestedWorkspaceId } from './request-validation';

function requestWithRawHeaders(rawHeaders: string[]): Request {
  return { rawHeaders } as Request;
}

function expectErrorCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected operation to throw');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('workspace request validation', () => {
  it('requires exactly one canonical X-Workspace-Id value', () => {
    expectErrorCode(
      () => readRequestedWorkspaceId(requestWithRawHeaders([])),
      'workspace_context_required',
    );
    expectErrorCode(
      () => readRequestedWorkspaceId(requestWithRawHeaders(['X-Workspace-Id', 'not-a-uuid'])),
      'workspace_context_invalid',
    );
    expectErrorCode(
      () =>
        readRequestedWorkspaceId(
          requestWithRawHeaders([
            'X-Workspace-Id',
            '11111111-1111-4111-8111-111111111111',
            'x-workspace-id',
            '22222222-2222-4222-8222-222222222222',
          ]),
        ),
      'workspace_context_invalid',
    );
    expect(
      readRequestedWorkspaceId(
        requestWithRawHeaders(['X-Workspace-Id', '11111111-1111-4111-8111-111111111111']),
      ),
    ).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects empty and unknown membership update fields', () => {
    expectErrorCode(() => parseUpdateMembershipBody({}), 'validation_error');
    expectErrorCode(
      () => parseUpdateMembershipBody({ role: 'agent', userId: 'impersonated' }),
      'validation_error',
    );
  });

  it('fails closed when request context was not established by the guard', () => {
    expect(() => getWorkspaceAccessContext({} as never)).toThrowError(
      'Workspace access context was not attached by the workspace access guard',
    );
  });
});
