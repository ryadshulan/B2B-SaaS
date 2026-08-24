import { AccessError } from '@customer-ops/access';
import { TenancyError } from '@customer-ops/tenancy';
import { ApplicationError } from '../errors/application-error';

export function translateAccessError(error: unknown): never {
  if (error instanceof TenancyError && error.code === 'validation_error') {
    throw new ApplicationError({
      code: 'validation_error',
      httpStatus: 400,
      safeMessage: 'Invalid organization request',
    });
  }
  if (!(error instanceof AccessError)) throw error;
  const definitions = {
    validation_error: { httpStatus: 400, safeMessage: 'Invalid access request' },
    workspace_access_denied: { httpStatus: 403, safeMessage: 'Workspace access denied' },
    forbidden: { httpStatus: 403, safeMessage: 'Forbidden' },
    membership_conflict: { httpStatus: 409, safeMessage: 'Membership already exists' },
    membership_not_found: { httpStatus: 404, safeMessage: 'Membership not found' },
    member_user_unavailable: { httpStatus: 404, safeMessage: 'Member user is unavailable' },
    last_owner_required: {
      httpStatus: 409,
      safeMessage: 'Workspace must retain an active owner',
    },
  } as const;
  const definition = definitions[error.code];
  throw new ApplicationError({ code: error.code, ...definition });
}
