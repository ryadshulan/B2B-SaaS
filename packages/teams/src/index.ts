export {
  DuplicateTeamMembershipPersistenceError,
  TeamError,
  TeamNameConflictPersistenceError,
  type TeamErrorCode,
} from './errors';
export { MAX_TEAM_NAME_LENGTH, validateTeamName } from './name';
export { createPostgresTeamRepository } from './repositories/postgres-team-repository';
export type { TeamRepository, TeamUpdate } from './repositories/team-repository';
export {
  createPostgresTeamService,
  TeamService,
  type AddTeamMemberInput,
  type CreateTeamInput,
  type TeamServiceOptions,
  type TeamTransactionRunner,
  type UpdateTeamInput,
  type UpdateTeamMemberInput,
} from './team-service';
export {
  isTeamMembershipStatus,
  isTeamStatus,
  type EligibleWorkspaceMember,
  type Team,
  type TeamId,
  type TeamMember,
  type TeamMembership,
  type TeamMembershipId,
  type TeamMembershipStatus,
  type TeamsDatabaseSchema,
  type TeamStatus,
} from './types';
