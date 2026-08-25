import { ChannelError } from '@customer-ops/channels';
import { ApplicationError } from '../errors/application-error';

export function translateChannelError(error: unknown): never {
  if (!(error instanceof ChannelError)) throw error;
  const definitions = {
    validation_error: { httpStatus: 400, safeMessage: 'Invalid channel request' },
    channel_not_found: { httpStatus: 404, safeMessage: 'Channel not found' },
    channel_external_identity_conflict: {
      httpStatus: 409,
      safeMessage: 'Channel external identity is already claimed',
    },
    channel_external_identity_already_bound: {
      httpStatus: 409,
      safeMessage: 'Channel external identity is already bound',
    },
    channel_external_identity_required: {
      httpStatus: 409,
      safeMessage: 'Channel external identity is required',
    },
    channel_invalid_state: { httpStatus: 409, safeMessage: 'Channel state is invalid' },
    channel_provider_not_registered: {
      httpStatus: 400,
      safeMessage: 'Channel provider is unavailable',
    },
  } as const;
  throw new ApplicationError({ code: error.code, ...definitions[error.code] });
}
