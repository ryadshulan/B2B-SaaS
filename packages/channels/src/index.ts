export {
  ChannelError,
  ChannelExternalIdentityConflictPersistenceError,
  type ChannelErrorCode,
} from './errors';
export {
  ChannelProviderRegistry,
  EMPTY_CHANNEL_PROVIDER_REGISTRY,
  type ChannelProviderDescriptorInput,
} from './provider-registry';
export { createPostgresChannelRepository } from './repositories/postgres-channel-repository';
export type { ChannelRepository, ChannelUpdate } from './repositories/channel-repository';
export {
  ChannelService,
  createPostgresChannelService,
  type BindExternalIdentityInput,
  type ChannelServiceOptions,
  type CreatePendingChannelInput,
} from './channel-service';
export {
  CHANNEL_PROVIDER_CAPABILITIES,
  CHANNEL_STATUSES,
  isChannelProviderCapability,
  isChannelStatus,
  type Channel,
  type ChannelExternalRef,
  type ChannelId,
  type ChannelProviderCapability,
  type ChannelProviderDescriptor,
  type ChannelProviderKey,
  type ChannelsDatabaseSchema,
  type ChannelStatus,
} from './types';
export {
  MAX_CHANNEL_DISPLAY_NAME_LENGTH,
  MAX_CHANNEL_EXTERNAL_REF_LENGTH,
  MAX_CHANNEL_PROVIDER_KEY_LENGTH,
  MIN_CHANNEL_PROVIDER_KEY_LENGTH,
  validateChannelDisplayName,
  validateChannelExternalRef,
  validateChannelProviderKey,
} from './validation';
