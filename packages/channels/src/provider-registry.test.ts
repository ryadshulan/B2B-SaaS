import { describe, expect, it } from 'vitest';
import { ChannelError } from './errors';
import { ChannelProviderRegistry, EMPTY_CHANNEL_PROVIDER_REGISTRY } from './provider-registry';

describe('ChannelProviderRegistry', () => {
  it('builds a code-defined provider-neutral registry and fails closed for unknown keys', () => {
    const registry = new ChannelProviderRegistry([
      { key: 'test_provider', capabilities: ['inbound', 'outbound'] },
      { key: 'mock.provider', capabilities: ['inbound'] },
    ]);
    expect(registry.resolve('test_provider')).toStrictEqual({
      key: 'test_provider',
      capabilities: ['inbound', 'outbound'],
    });
    expect(() => registry.resolve('unknown.provider')).toThrowError(
      'channel_provider_not_registered',
    );
    expect(EMPTY_CHANNEL_PROVIDER_REGISTRY.descriptors).toStrictEqual([]);
    expect(() => EMPTY_CHANNEL_PROVIDER_REGISTRY.resolve('test_provider')).toThrowError(
      ChannelError,
    );
  });

  it('rejects duplicate or invalid provider descriptors deterministically', () => {
    expect(
      () =>
        new ChannelProviderRegistry([
          { key: 'test_provider', capabilities: ['inbound'] },
          { key: 'test_provider', capabilities: ['outbound'] },
        ]),
    ).toThrowError('validation_error');
    for (const descriptors of [
      [{ key: 'Test_provider', capabilities: ['inbound'] }],
      [{ key: 'test_provider', capabilities: ['unknown'] }],
      [{ key: 'test_provider', capabilities: ['inbound', 'inbound'] }],
    ]) {
      expect(() => new ChannelProviderRegistry(descriptors)).toThrowError(ChannelError);
    }
  });

  it('freezes the registry, descriptor list, descriptors, and nested capability collections', () => {
    const registry = new ChannelProviderRegistry([
      { key: 'test_provider', capabilities: ['inbound', 'outbound'] },
    ]);
    const descriptor = registry.resolve('test_provider');
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.descriptors)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    expect(() => (descriptor.capabilities as unknown as string[]).push('unknown')).toThrow(
      TypeError,
    );
  });
});
