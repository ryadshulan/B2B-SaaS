import type { Kysely, Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { withTransaction } from './transaction';
import type { DatabaseRuntime } from './types';

type TestSchema = Record<never, never>;

function createRuntime(transaction: Transaction<TestSchema>): DatabaseRuntime<TestSchema> {
  const execute = vi.fn(
    async <Result>(operation: (executor: Transaction<TestSchema>) => Promise<Result>) =>
      operation(transaction),
  );
  const executor = {
    transaction: () => ({ execute }),
  } as unknown as Kysely<TestSchema>;

  return {
    executor,
    checkHealth: vi.fn(),
    getPoolStatistics: vi.fn(),
    close: vi.fn(),
  };
}

describe('withTransaction', () => {
  it('passes the transaction-scoped executor and returns the callback result', async () => {
    const transaction = { isTransaction: true } as Transaction<TestSchema>;
    const database = createRuntime(transaction);

    await expect(
      withTransaction(database, (executor) => {
        expect(executor).toBe(transaction);
        return Promise.resolve('committed-result');
      }),
    ).resolves.toBe('committed-result');
  });

  it('preserves the original callback error', async () => {
    const database = createRuntime({ isTransaction: true } as Transaction<TestSchema>);
    const originalError = new Error('transaction callback failed');

    await expect(withTransaction(database, () => Promise.reject(originalError))).rejects.toBe(
      originalError,
    );
  });
});
