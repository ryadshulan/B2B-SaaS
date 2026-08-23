import type { Kysely, Transaction } from 'kysely';

export type DatabaseSchema = Record<never, never>;

export type DatabaseExecutor<Schema = DatabaseSchema> = Kysely<Schema> | Transaction<Schema>;

export interface DatabaseHealth {
  healthy: boolean;
  durationMs: number;
  postgresCode?: string;
}

export interface DatabasePoolStatistics {
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
}

export interface DatabaseRuntime<Schema = DatabaseSchema> {
  readonly executor: Kysely<Schema>;
  checkHealth(timeoutMs?: number): Promise<DatabaseHealth>;
  getPoolStatistics(): DatabasePoolStatistics;
  close(): Promise<void>;
}
