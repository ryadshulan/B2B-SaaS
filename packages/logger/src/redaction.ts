const REDACTION_CENSOR = '[REDACTED]';

const sensitiveKeys = new Set([
  'authorization',
  'cookie',
  'set_cookie',
  'password',
  'password_hash',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'api_secret',
  'app_secret',
  'database_url',
  'redis_url',
  's3_secret_key',
  'meta_access_token',
  'meta_app_secret',
  'meta_whatsapp_access_token',
  'meta_whatsapp_app_secret',
]);

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .replace(/[^A-Za-z\d]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    sensitiveKeys.has(normalized) ||
    /(?:^|_)(?:password|token|secret|authorization|cookie|api_key)(?:_|$)/u.test(normalized)
  );
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/giu, '$1[REDACTED]@')
    .replace(
      /((?:password(?:[_-]?hash)?|access[_-]?token|refresh[_-]?token|token|secret|api[_-]?(?:key|secret)|app[_-]?secret|database[_-]?url|redis[_-]?url|s3[_-]?secret[_-]?key)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1[REDACTED]',
    );
}

function redactError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    type: error.name,
    message: redactSensitiveText(error.message),
    ...(error.stack === undefined ? {} : { stack: redactSensitiveText(error.stack) }),
  };

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(error))) {
    if (key === 'name' || key === 'message' || key === 'stack' || !('value' in descriptor)) {
      continue;
    }
    serialized[key] = isSensitiveKey(key) ? REDACTION_CENSOR : redactValue(descriptor.value, seen);
  }
  return serialized;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  let redacted: unknown;
  if (value instanceof Error) {
    redacted = redactError(value, seen);
  } else if (Array.isArray(value)) {
    redacted = value.map((item) => redactValue(item, seen));
  } else if (value instanceof Date) {
    redacted = value.toISOString();
  } else {
    const output: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) {
        continue;
      }
      output[key] = isSensitiveKey(key) ? REDACTION_CENSOR : redactValue(descriptor.value, seen);
    }
    redacted = output;
  }
  seen.delete(value);
  return redacted;
}

export function redactSensitiveValues(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}
