import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadDatabaseConfigFromEnvironment } from '@customer-ops/config';
import { createDatabase, type DatabaseRuntime } from '@customer-ops/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type MigrationCommand = 'latest' | 'down' | 'status';

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runMigrationCli(
  command: MigrationCommand,
  databaseUrl: string,
  additionalEnvironment: NodeJS.ProcessEnv = {},
): Promise<ProcessResult> {
  const cliPath = resolve('packages/database/dist/migration-cli.js');
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, [cliPath, command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_NAME: 'customer-operations-platform',
        LOG_LEVEL: 'info',
        DATABASE_URL: databaseUrl,
        ...additionalEnvironment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectProcess);
    child.once('close', (exitCode) => {
      resolveProcess({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

function expectNoCredentials(result: ProcessResult, databaseUrl: string): void {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const url = new URL(databaseUrl);

  expect(combinedOutput).not.toContain(databaseUrl);
  if (url.username !== '') {
    expect(combinedOutput).not.toContain(decodeURIComponent(url.username));
  }
  if (url.password !== '') {
    expect(combinedOutput).not.toContain(decodeURIComponent(url.password));
  }
}

describe('built migration CLI output contract', () => {
  let cliDatabaseUrl: string;
  let adminDatabase: DatabaseRuntime;
  const schema = `c04_cli_${randomUUID().replaceAll('-', '')}`;

  function assertOwnedSchema(): void {
    if (!/^c04_cli_[0-9a-f]{32}$/u.test(schema)) {
      throw new Error('Refusing to clean a schema not owned by the migration CLI test');
    }
  }

  beforeAll(async () => {
    const config = loadDatabaseConfigFromEnvironment();
    adminDatabase = createDatabase({ config: { ...config, maxConnections: 1 } });
    assertOwnedSchema();
    await adminDatabase.executor.schema.createSchema(schema).execute();
    const url = new URL(config.url);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    cliDatabaseUrl = url.toString();
    const setup = await runMigrationCli('latest', cliDatabaseUrl);
    if (setup.exitCode !== 0) {
      throw new Error('Could not prepare the baseline migration for the CLI test');
    }
  });

  afterAll(async () => {
    assertOwnedSchema();
    await adminDatabase.executor.schema.dropSchema(schema).cascade().execute();
    await adminDatabase.close();
  });

  it('emits exactly one parseable status document on stdout and logs to stderr', async () => {
    const result = await runMigrationCli('status', cliDatabaseUrl);
    expect(result.exitCode, result.stderr).toBe(0);
    const parsedStatus = JSON.parse(result.stdout) as unknown;

    expect(parsedStatus).toMatchObject([
      { name: '0001_c02_database_baseline', status: 'applied' },
      { name: '0002_c04_authentication_foundation', status: 'applied' },
      { name: '0003_c05_organizations_workspaces', status: 'applied' },
      { name: '0004_c06_workspace_memberships_rbac', status: 'applied' },
      { name: '0005_c07_teams', status: 'applied' },
      { name: '0006_c08_channels', status: 'applied' },
    ]);
    expect(result.stdout).not.toContain('database.pool.created');
    expect(result.stdout).not.toContain('database.pool.closed');
    expect(result.stderr).toContain('database.pool.created');
    expect(result.stderr).toContain('database.pool.closed');
    expectNoCredentials(result, cliDatabaseUrl);
  });

  it('keeps latest and down operational logs off stdout', async () => {
    const latest = await runMigrationCli('latest', cliDatabaseUrl);
    expect(latest.exitCode, latest.stderr).toBe(0);
    expect(latest.stdout).toBe('');
    expect(latest.stderr).toContain('database.migration.started');
    expect(latest.stderr).toContain('database.migration.completed');
    expectNoCredentials(latest, cliDatabaseUrl);

    const down = await runMigrationCli('down', cliDatabaseUrl);
    try {
      expect(down.exitCode).toBe(0);
      expect(down.stdout).toBe('');
      expect(down.stderr).toContain('database.migration.started');
      expect(down.stderr).toContain('database.migration.completed');
      expectNoCredentials(down, cliDatabaseUrl);
    } finally {
      const restore = await runMigrationCli('latest', cliDatabaseUrl);
      expect(restore.exitCode).toBe(0);
      expect(restore.stdout).toBe('');
      expectNoCredentials(restore, cliDatabaseUrl);
    }
  });

  it('keeps secret-safe failure logs on stderr and exits non-zero', async () => {
    const unavailableUrl = new URL(cliDatabaseUrl);
    unavailableUrl.hostname = '127.0.0.1';
    unavailableUrl.port = '1';
    unavailableUrl.username = 'cli-failure-user';
    unavailableUrl.password = 'cli-failure-password';
    const serializedUnavailableUrl = unavailableUrl.toString();

    const result = await runMigrationCli('status', serializedUnavailableUrl, {
      DB_CONNECTION_TIMEOUT_MS: '100',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('database.migration.failed');
    expectNoCredentials(result, serializedUnavailableUrl);
  });
});
