import { TenancyError, type TenancyValidationField } from './errors';

export const MAX_TENANCY_NAME_LENGTH = 160;

const controlCharacter = /\p{Cc}/u;

export function validateTenancyName(value: unknown, field: TenancyValidationField): string {
  if (typeof value !== 'string' || controlCharacter.test(value)) {
    throw new TenancyError('validation_error', field);
  }

  const name = value.trim().normalize('NFC');
  const codePointLength = Array.from(name).length;
  if (codePointLength === 0 || codePointLength > MAX_TENANCY_NAME_LENGTH) {
    throw new TenancyError('validation_error', field);
  }
  return name;
}

export function validateOrganizationName(value: unknown): string {
  return validateTenancyName(value, 'organizationName');
}

export function validateWorkspaceName(value: unknown): string {
  return validateTenancyName(value, 'workspaceName');
}
