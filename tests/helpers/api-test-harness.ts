import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import type { DatabaseRuntime } from '@customer-ops/database';
import { createLogger } from '@customer-ops/logger';
import { createApiApplication } from '../../apps/api/src/bootstrap';

export interface ApiTestHarness {
  baseUrl: string;
  records: Array<Record<string, unknown>>;
  database: {
    setHealthy(healthy: boolean): void;
    closeCalls(): number;
  };
  close(): Promise<void>;
}

function createTestDatabase(): {
  runtime: DatabaseRuntime;
  control: ApiTestHarness['database'];
} {
  let healthy = true;
  let closed = false;
  let closeCallCount = 0;
  const runtime = {
    executor: {},
    checkHealth: () => Promise.resolve({ healthy, durationMs: 0 }),
    getPoolStatistics: () => ({
      totalConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
    }),
    close: () => {
      if (!closed) {
        closed = true;
        closeCallCount += 1;
      }
      return Promise.resolve();
    },
  } as unknown as DatabaseRuntime;

  return {
    runtime,
    control: {
      setHealthy: (value) => {
        healthy = value;
      },
      closeCalls: () => closeCallCount,
    },
  };
}

export async function startApiTestHarness(): Promise<ApiTestHarness> {
  const destination = new PassThrough();
  const records: Array<Record<string, unknown>> = [];
  destination.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      if (line !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const logger = createLogger({
    service: 'integration-test-api',
    environment: 'test',
    level: 'debug',
    destination,
  });
  const database = createTestDatabase();
  const application = await createApiApplication({ logger, database: database.runtime });
  await application.listen(0, '127.0.0.1');
  const address = (
    application.getHttpServer() as { address(): AddressInfo | string | null }
  ).address();
  if (address === null || typeof address === 'string') {
    await application.close();
    throw new Error('Test API did not expose a TCP address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    records,
    database: database.control,
    close: async () => application.close(),
  };
}
