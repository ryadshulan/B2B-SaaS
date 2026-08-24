export type AccessErrorCode =
  | 'validation_error'
  | 'workspace_access_denied'
  | 'forbidden'
  | 'membership_conflict'
  | 'membership_not_found'
  | 'member_user_unavailable'
  | 'last_owner_required';

export class AccessError extends Error {
  constructor(readonly code: AccessErrorCode) {
    super(code);
    this.name = 'AccessError';
  }
}

export class DuplicateMembershipPersistenceError extends Error {
  constructor() {
    super('Duplicate workspace membership');
    this.name = 'DuplicateMembershipPersistenceError';
  }
}
