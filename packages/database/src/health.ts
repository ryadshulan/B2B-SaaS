import type { StructuredLogger } from '@customer-ops/logger';
import { sql } from 'kysely';
import { getSafePostgresCode } from './errors';
import type { DatabaseExecutor, DatabaseHealth } from './types';

export const DEFAULT_DATABASE_HEALTH_TIMEOUT_MS = 2_000;

interface HealthCheckOptions {
  timeoutMs: number;
  logger?: StructuredLogger;
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 1000) / 1000;
}

export async function runBoundedHealthCheck(
  query: () => Promise<unknown>,
  options: HealthCheckOptions,
): Promise<DatabaseHealth> {
  const startedAt = process.hrtime.bigint();
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      query(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              Object.assign(new Error('Database health check timed out'), { code: 'TIMEOUT' }),
            ),
          options.timeoutMs,
        );
      }),
    ]);
    return { healthy: true, durationMs: elapsedMilliseconds(startedAt) };
  } catch (error) {
    const postgresCode = getSafePostgresCode(error);
    const result: DatabaseHealth = {
      healthy: false,
      durationMs: elapsedMilliseconds(startedAt),
      ...(postgresCode === undefined ? {} : { postgresCode }),
    };
    options.logger?.warn(
      {
        event: 'database.health.failed',
        duration_ms: result.durationMs,
        ...(postgresCode === undefined ? {} : { postgres_code: postgresCode }),
      },
      'PostgreSQL readiness check failed',
    );
    return result;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function checkDatabaseHealth<Schema>(
  executor: DatabaseExecutor<Schema>,
  timeoutMs = DEFAULT_DATABASE_HEALTH_TIMEOUT_MS,
  logger?: StructuredLogger,
): Promise<DatabaseHealth> {
  return runBoundedHealthCheck(() => sql`select 1`.execute(executor), {
    timeoutMs,
    ...(logger === undefined ? {} : { logger }),
  });
}
