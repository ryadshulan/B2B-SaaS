export type TenancyErrorCode =
  | 'validation_error'
  | 'organization_not_found'
  | 'workspace_not_found';

export type TenancyValidationField = 'organizationName' | 'workspaceName';

export class TenancyError extends Error {
  constructor(
    readonly code: TenancyErrorCode,
    readonly field?: TenancyValidationField,
  ) {
    super(code);
    this.name = 'TenancyError';
  }
}
