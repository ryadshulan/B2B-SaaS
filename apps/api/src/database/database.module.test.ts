import { PassThrough } from 'node:stream';
import type { DatabaseRuntime } from '@customer-ops/database';
import { createLogger } from '@customer-ops/logger';
import { describe, expect, it, vi } from 'vitest';
import { createApiApplication } from '../bootstrap';

describe('DatabaseModule lifecycle', () => {
  it('closes the injected process-wide database runtime during Nest shutdown', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const database = {
      executor: {},
      checkHealth: vi.fn().mockResolvedValue({ healthy: true, durationMs: 0 }),
      getPoolStatistics: vi.fn(),
      close,
    } as unknown as DatabaseRuntime;
    const logger = createLogger({
      service: 'database-module-test',
      environment: 'test',
      level: 'error',
      destination: new PassThrough(),
    });
    const application = await createApiApplication({ logger, database });

    await application.init();
    await application.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
