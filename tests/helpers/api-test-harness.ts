import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { createLogger } from '@customer-ops/logger';
import { createApiApplication } from '../../apps/api/src/bootstrap';

export interface ApiTestHarness {
  baseUrl: string;
  records: Array<Record<string, unknown>>;
  close(): Promise<void>;
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
  const application = await createApiApplication({ logger });
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
    close: async () => application.close(),
  };
}
