import { describe, expect, it } from 'vitest';
import {
  parseAddTeamMemberBody,
  parseCreateTeamBody,
  parseTeamId,
  parseUpdateTeamBody,
  parseUpdateTeamMemberBody,
} from './teams-request-validation';

function expectValidationError(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected operation to throw');
  } catch (error) {
    expect(error).toMatchObject({ code: 'validation_error' });
  }
}

describe('team HTTP request validation', () => {
  it('accepts only exact create and add-member keys', () => {
    expect(parseCreateTeamBody({ name: '\u0641\u0631\u064a\u0642' })).toStrictEqual({
      name: '\u0641\u0631\u064a\u0642',
    });
    expect(
      parseAddTeamMemberBody({
        workspaceMembershipId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toStrictEqual({ workspaceMembershipId: '11111111-1111-4111-8111-111111111111' });
    expectValidationError(() => parseCreateTeamBody({ name: 'Team', workspaceId: 'override' }));
    expectValidationError(() =>
      parseAddTeamMemberBody({
        workspaceMembershipId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('requires non-empty strict team and team-membership patches', () => {
    expect(parseUpdateTeamBody({ name: 'Renamed', status: 'disabled' })).toStrictEqual({
      name: 'Renamed',
      status: 'disabled',
    });
    expect(parseUpdateTeamMemberBody({ status: 'active' })).toStrictEqual({ status: 'active' });
    expectValidationError(() => parseUpdateTeamBody({}));
    expectValidationError(() => parseUpdateTeamBody({ status: 'archived' }));
    expectValidationError(() => parseUpdateTeamMemberBody({ status: 'disabled', role: 'lead' }));
  });

  it('accepts only canonical lowercase UUID route identifiers', () => {
    expect(parseTeamId('33333333-3333-4333-8333-333333333333')).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expectValidationError(() => parseTeamId('not-a-uuid'));
    expectValidationError(() => parseTeamId('33333333-3333-4333-8333-33333333333A'));
  });
});
