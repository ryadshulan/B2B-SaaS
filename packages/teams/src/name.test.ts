import { describe, expect, it } from 'vitest';
import { TeamError } from './errors';
import { MAX_TEAM_NAME_LENGTH, validateTeamName } from './name';

describe('team name validation', () => {
  it('supports Arabic, trims outer whitespace, preserves spelling, and normalizes NFC', () => {
    const arabic =
      '\u0641\u0631\u064a\u0642 \u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621';
    expect(validateTeamName(`  ${arabic}  `)).toBe(arabic);
    expect(validateTeamName('Cafe\u0301')).toBe('Caf\u00e9');
    expect(validateTeamName('Support')).toBe('Support');
  });

  it('rejects non-strings, empty names, and values over 120 Unicode code points', () => {
    for (const value of [undefined, null, 12, '   ']) {
      expect(() => validateTeamName(value)).toThrowError(TeamError);
    }
    expect(() => validateTeamName('\u{1f600}'.repeat(MAX_TEAM_NAME_LENGTH))).not.toThrow();
    expect(() => validateTeamName('\u{1f600}'.repeat(MAX_TEAM_NAME_LENGTH + 1))).toThrowError(
      TeamError,
    );
  });

  it('rejects ASCII and Unicode control characters before trimming', () => {
    for (const value of ['name\n', '\tname', 'team\u0000name', 'team\u0085name']) {
      expect(() => validateTeamName(value)).toThrowError(TeamError);
    }
  });
});
