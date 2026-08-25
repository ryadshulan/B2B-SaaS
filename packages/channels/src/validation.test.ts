import { describe, expect, it } from 'vitest';
import { ChannelError } from './errors';
import {
  MAX_CHANNEL_DISPLAY_NAME_LENGTH,
  MAX_CHANNEL_EXTERNAL_REF_LENGTH,
  validateChannelDisplayName,
  validateChannelExternalRef,
  validateChannelProviderKey,
} from './validation';

describe('channel validation', () => {
  it('supports Arabic display names, trims outer whitespace, preserves spelling, and normalizes NFC', () => {
    const arabic =
      '\u0642\u0646\u0627\u0629 \u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621';
    expect(validateChannelDisplayName(`  ${arabic}  `)).toBe(arabic);
    expect(validateChannelDisplayName('Cafe\u0301')).toBe('Caf\u00e9');
    expect(validateChannelDisplayName('Customer Support')).toBe('Customer Support');
  });

  it('rejects invalid display-name types, emptiness, controls, and overlong code-point input', () => {
    for (const value of [undefined, null, 12, '   ', 'name\n', '\tname', 'a\u0000b', 'a\u0085b']) {
      expect(() => validateChannelDisplayName(value)).toThrowError(ChannelError);
    }
    expect(() =>
      validateChannelDisplayName('\u{1f600}'.repeat(MAX_CHANNEL_DISPLAY_NAME_LENGTH)),
    ).not.toThrow();
    expect(() =>
      validateChannelDisplayName('\u{1f600}'.repeat(MAX_CHANNEL_DISPLAY_NAME_LENGTH + 1)),
    ).toThrowError(ChannelError);
  });

  it('accepts exactly the provider-key grammar and trims without lowercasing', () => {
    for (const value of ['provider', 'provider.v1', 'test_provider', 'provider-cloud']) {
      expect(validateChannelProviderKey(`  ${value}  `)).toBe(value);
    }
    for (const value of [
      undefined,
      null,
      '',
      'a',
      'Provider',
      'provider key',
      '_provider',
      '.provider',
      'مزود',
      'a'.repeat(65),
    ]) {
      expect(() => validateChannelProviderKey(value)).toThrowError(ChannelError);
    }
  });

  it('trims external references but preserves case and Unicode semantics without normalization', () => {
    expect(validateChannelExternalRef('  Account-AbC-123  ')).toBe('Account-AbC-123');
    expect(validateChannelExternalRef('Cafe\u0301')).toBe('Cafe\u0301');
    expect(validateChannelExternalRef('\u0645\u0639\u0631\u0641-ABC')).toBe(
      '\u0645\u0639\u0631\u0641-ABC',
    );
  });

  it('rejects invalid external-reference types, emptiness, controls, and overlong values', () => {
    for (const value of [undefined, null, 12, '', '   ', 'ref\n', 'a\u0000b', 'a\u0085b']) {
      expect(() => validateChannelExternalRef(value)).toThrowError(ChannelError);
    }
    expect(() =>
      validateChannelExternalRef('\u{1f600}'.repeat(MAX_CHANNEL_EXTERNAL_REF_LENGTH)),
    ).not.toThrow();
    expect(() =>
      validateChannelExternalRef('\u{1f600}'.repeat(MAX_CHANNEL_EXTERNAL_REF_LENGTH + 1)),
    ).toThrowError(ChannelError);
  });
});
