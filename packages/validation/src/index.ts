/** A result shape for future shared validation utilities. */
export type ValidationResult<T> = { success: true; value: T } | { success: false; errors: readonly string[] };
