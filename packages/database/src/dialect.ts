import {
  DialectAdapterBase,
  PostgresDialect,
  sql,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
} from 'kysely';
import type { Pool } from 'pg';

export const MIGRATION_ADVISORY_LOCK_ID = BigInt('42102020009');

class BoundedPostgresAdapter extends DialectAdapterBase {
  constructor(private readonly lockTimeoutMs: number) {
    super();
  }

  override get supportsTransactionalDdl(): boolean {
    return true;
  }

  override get supportsReturning(): boolean {
    return true;
  }

  override async acquireMigrationLock(database: Kysely<unknown>): Promise<void> {
    await sql`select set_config('lock_timeout', ${`${this.lockTimeoutMs}ms`}, true)`.execute(
      database,
    );
    await sql`select pg_advisory_xact_lock(${MIGRATION_ADVISORY_LOCK_ID})`.execute(database);
  }

  override releaseMigrationLock(): Promise<void> {
    return Promise.resolve();
  }
}

export class BoundedMigrationPostgresDialect implements Dialect {
  private readonly dialect: PostgresDialect;

  constructor(
    pool: Pool,
    private readonly lockTimeoutMs: number,
  ) {
    this.dialect = new PostgresDialect({ pool });
  }

  createDriver(): Driver {
    return this.dialect.createDriver();
  }

  createQueryCompiler(): QueryCompiler {
    return this.dialect.createQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new BoundedPostgresAdapter(this.lockTimeoutMs);
  }

  createIntrospector(database: Kysely<unknown>): DatabaseIntrospector {
    return this.dialect.createIntrospector(database);
  }
}
