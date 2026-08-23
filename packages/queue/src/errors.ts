export type QueueOperation = 'health' | 'enqueue' | 'worker_start' | 'shutdown' | 'cleanup';

export class QueueOperationError extends Error {
  readonly operation: QueueOperation;
  readonly errorCode?: string;

  constructor(operation: QueueOperation, cause: unknown) {
    super(`Queue ${operation} operation failed`, { cause });
    this.name = 'QueueOperationError';
    this.operation = operation;
    const errorCode = getSafeQueueErrorCode(cause);
    if (errorCode !== undefined) {
      this.errorCode = errorCode;
    }
  }
}

export class UnknownQueueJobError extends Error {
  readonly safeJobName: string;

  constructor(jobName: string) {
    super('Queue job has no registered handler');
    this.name = 'UnknownQueueJobError';
    this.safeJobName = toSafeJobName(jobName);
  }
}

export function getSafeQueueErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,32}$/u.test(code) ? code : undefined;
}

export function toSafeJobName(jobName: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(jobName) ? jobName : '[invalid]';
}

export function toQueueOperationError(
  operation: QueueOperation,
  error: unknown,
): QueueOperationError {
  return error instanceof QueueOperationError ? error : new QueueOperationError(operation, error);
}
