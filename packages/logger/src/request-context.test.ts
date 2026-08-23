import { describe, expect, it } from 'vitest';
import {
  getCorrelationId,
  getRequestContext,
  getRequestId,
  runWithRequestContext,
} from './request-context';

describe('asynchronous request context', () => {
  it('survives normal await chains', async () => {
    await runWithRequestContext(
      { requestId: 'request-await', correlationId: 'correlation-await' },
      async () => {
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(getRequestId()).toBe('request-await');
        expect(getCorrelationId()).toBe('correlation-await');
      },
    );
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates concurrent asynchronous operations', async () => {
    const operation = (requestId: string, delay: number): Promise<string | undefined> =>
      runWithRequestContext({ requestId, correlationId: `correlation-${requestId}` }, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        return getRequestId();
      });

    await expect(
      Promise.all([operation('first', 10), operation('second', 1)]),
    ).resolves.toStrictEqual(['first', 'second']);
  });
});
