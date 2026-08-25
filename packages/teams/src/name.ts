import { TeamError } from './errors';

export const MAX_TEAM_NAME_LENGTH = 120;

const controlCharacter = /\p{Cc}/u;

export function validateTeamName(value: unknown): string {
  if (typeof value !== 'string' || controlCharacter.test(value)) {
    throw new TeamError('validation_error');
  }

  const name = value.trim().normalize('NFC');
  const codePointLength = Array.from(name).length;
  if (codePointLength === 0 || codePointLength > MAX_TEAM_NAME_LENGTH) {
    throw new TeamError('validation_error');
  }
  return name;
}
