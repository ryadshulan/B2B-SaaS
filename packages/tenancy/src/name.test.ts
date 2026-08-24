import { describe, expect, it } from 'vitest';
import { TenancyError } from './errors';
import { MAX_TENANCY_NAME_LENGTH, validateOrganizationName, validateWorkspaceName } from './name';

describe('tenancy name validation', () => {
  it('accepts Arabic names, trims only outer whitespace, and normalizes to NFC', () => {
    const arabicOrganization =
      '\u0634\u0631\u0643\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621';
    const arabicWorkspace =
      '\u0645\u0628\u064a\u0639\u0627\u062a \u0627\u0644\u0631\u064a\u0627\u0636';
    expect(validateOrganizationName(`  ${arabicOrganization}  `)).toBe(arabicOrganization);
    expect(validateWorkspaceName(`  ${arabicWorkspace}  `)).toBe(arabicWorkspace);
    expect(validateOrganizationName('Cafe\u0301')).toBe('Caf\u00e9');
  });

  it('rejects empty, non-string, and overlong names by Unicode code point length', () => {
    expect(() => validateOrganizationName('   ')).toThrowError(TenancyError);
    expect(() => validateWorkspaceName(undefined)).toThrowError(TenancyError);
    expect(() =>
      validateOrganizationName('\u{1f600}'.repeat(MAX_TENANCY_NAME_LENGTH)),
    ).not.toThrow();
    expect(() =>
      validateWorkspaceName('\u{1f600}'.repeat(MAX_TENANCY_NAME_LENGTH + 1)),
    ).toThrowError(TenancyError);
  });

  it('rejects control characters even when they occur in outer whitespace', () => {
    for (const value of ['name\n', 'work\u0000space', '\tname']) {
      expect(() => validateOrganizationName(value)).toThrowError(TenancyError);
    }
  });
});
