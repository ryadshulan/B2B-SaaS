import { ChannelError } from './errors';
import type { ChannelExternalRef, ChannelProviderKey } from './types';

export const MAX_CHANNEL_DISPLAY_NAME_LENGTH = 160;
export const MAX_CHANNEL_EXTERNAL_REF_LENGTH = 255;
export const MIN_CHANNEL_PROVIDER_KEY_LENGTH = 2;
export const MAX_CHANNEL_PROVIDER_KEY_LENGTH = 64;

const controlCharacter = /\p{Cc}/u;
const providerKeyPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/u;

export function validateChannelDisplayName(value: unknown): string {
  if (typeof value !== 'string' || controlCharacter.test(value)) {
    throw new ChannelError('validation_error');
  }
  const displayName = value.trim().normalize('NFC');
  const length = Array.from(displayName).length;
  if (length === 0 || length > MAX_CHANNEL_DISPLAY_NAME_LENGTH) {
    throw new ChannelError('validation_error');
  }
  return displayName;
}

export function validateChannelProviderKey(value: unknown): ChannelProviderKey {
  if (typeof value !== 'string') throw new ChannelError('validation_error');
  const providerKey = value.trim();
  if (
    providerKey.length < MIN_CHANNEL_PROVIDER_KEY_LENGTH ||
    providerKey.length > MAX_CHANNEL_PROVIDER_KEY_LENGTH ||
    !providerKeyPattern.test(providerKey)
  ) {
    throw new ChannelError('validation_error');
  }
  return providerKey as ChannelProviderKey;
}

export function validateChannelExternalRef(value: unknown): ChannelExternalRef {
  if (typeof value !== 'string' || controlCharacter.test(value)) {
    throw new ChannelError('validation_error');
  }
  const externalRef = value.trim();
  const length = Array.from(externalRef).length;
  if (length === 0 || length > MAX_CHANNEL_EXTERNAL_REF_LENGTH) {
    throw new ChannelError('validation_error');
  }
  return externalRef as ChannelExternalRef;
}
