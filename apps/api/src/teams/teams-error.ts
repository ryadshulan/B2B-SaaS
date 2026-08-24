import { TeamError } from '@customer-ops/teams';
import { ApplicationError } from '../errors/application-error';

export function translateTeamError(error: unknown): never {
  if (!(error instanceof TeamError)) throw error;
  const definitions = {
    validation_error: { httpStatus: 400, safeMessage: 'Invalid team request' },
    team_not_found: { httpStatus: 404, safeMessage: 'Team not found' },
    team_name_conflict: { httpStatus: 409, safeMessage: 'Team name already exists' },
    team_disabled: { httpStatus: 409, safeMessage: 'Team is disabled' },
    team_member_unavailable: { httpStatus: 404, safeMessage: 'Team member is unavailable' },
    team_membership_not_found: { httpStatus: 404, safeMessage: 'Team membership not found' },
    team_membership_conflict: { httpStatus: 409, safeMessage: 'Team membership already exists' },
  } as const;
  throw new ApplicationError({ code: error.code, ...definitions[error.code] });
}
