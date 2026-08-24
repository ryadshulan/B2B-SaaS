export type TeamErrorCode =
  | 'validation_error'
  | 'team_not_found'
  | 'team_name_conflict'
  | 'team_disabled'
  | 'team_member_unavailable'
  | 'team_membership_not_found'
  | 'team_membership_conflict';

export class TeamError extends Error {
  constructor(readonly code: TeamErrorCode) {
    super(code);
    this.name = 'TeamError';
  }
}

export class TeamNameConflictPersistenceError extends Error {
  constructor() {
    super('Duplicate workspace team name');
    this.name = 'TeamNameConflictPersistenceError';
  }
}

export class DuplicateTeamMembershipPersistenceError extends Error {
  constructor() {
    super('Duplicate team membership');
    this.name = 'DuplicateTeamMembershipPersistenceError';
  }
}
