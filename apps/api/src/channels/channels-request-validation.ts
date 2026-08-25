import { ChannelError, type ChannelId } from '@customer-ops/channels';

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function parseChannelId(value: unknown): ChannelId {
  if (typeof value !== 'string' || !canonicalUuid.test(value)) {
    throw new ChannelError('validation_error');
  }
  return value as ChannelId;
}
