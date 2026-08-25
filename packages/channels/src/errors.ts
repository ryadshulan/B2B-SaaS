export type ChannelErrorCode =
  | 'validation_error'
  | 'channel_not_found'
  | 'channel_external_identity_conflict'
  | 'channel_external_identity_already_bound'
  | 'channel_external_identity_required'
  | 'channel_invalid_state'
  | 'channel_provider_not_registered';

export class ChannelError extends Error {
  constructor(readonly code: ChannelErrorCode) {
    super(code);
    this.name = 'ChannelError';
  }
}

export class ChannelExternalIdentityConflictPersistenceError extends Error {
  constructor() {
    super('Channel provider identity is already claimed');
    this.name = 'ChannelExternalIdentityConflictPersistenceError';
  }
}
