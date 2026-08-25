import { ChannelError } from './errors';
import {
  isChannelProviderCapability,
  type ChannelProviderCapability,
  type ChannelProviderDescriptor,
  type ChannelProviderKey,
} from './types';
import { validateChannelProviderKey } from './validation';

export interface ChannelProviderDescriptorInput {
  readonly key: unknown;
  readonly capabilities: readonly unknown[];
}

function freezeDescriptor(input: ChannelProviderDescriptorInput): ChannelProviderDescriptor {
  const key = validateChannelProviderKey(input.key);
  if (!Array.isArray(input.capabilities)) throw new ChannelError('validation_error');
  const capabilities: ChannelProviderCapability[] = [];
  for (const capability of input.capabilities) {
    if (!isChannelProviderCapability(capability) || capabilities.includes(capability)) {
      throw new ChannelError('validation_error');
    }
    capabilities.push(capability);
  }
  return Object.freeze({ key, capabilities: Object.freeze(capabilities) });
}

export class ChannelProviderRegistry {
  readonly descriptors: readonly ChannelProviderDescriptor[];
  private readonly descriptorsByKey: ReadonlyMap<ChannelProviderKey, ChannelProviderDescriptor>;

  constructor(inputs: readonly ChannelProviderDescriptorInput[]) {
    const descriptors = inputs.map(freezeDescriptor);
    const descriptorsByKey = new Map<ChannelProviderKey, ChannelProviderDescriptor>();
    for (const descriptor of descriptors) {
      if (descriptorsByKey.has(descriptor.key)) throw new ChannelError('validation_error');
      descriptorsByKey.set(descriptor.key, descriptor);
    }
    this.descriptors = Object.freeze(descriptors);
    this.descriptorsByKey = descriptorsByKey;
    Object.freeze(this);
  }

  resolve(key: unknown): ChannelProviderDescriptor {
    const providerKey = validateChannelProviderKey(key);
    const descriptor = this.descriptorsByKey.get(providerKey);
    if (descriptor === undefined) throw new ChannelError('channel_provider_not_registered');
    return descriptor;
  }
}

export const EMPTY_CHANNEL_PROVIDER_REGISTRY = new ChannelProviderRegistry([]);
