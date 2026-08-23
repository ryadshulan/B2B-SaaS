import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  loadApiConfig,
  loadApiConfigFromEnvironment,
  loadDatabaseConfig,
  loadWorkerConfig,
  loadWorkerConfigFromEnvironment,
  type EnvironmentSource,
} from './index';

const validEnvironment: EnvironmentSource = {
  NODE_ENV: 'development',
  APP_NAME: 'customer-operations-platform',
  APP_VERSION: '1.2.3',
  API_PORT: '3001',
  LOG_LEVEL: 'debug',
  DATABASE_URL: 'postgresql://customer_ops:test-password@localhost:5432/customer_ops',
  REDIS_URL: 'redis://queue-user:queue-password@localhost:6379',
};

describe('runtime configuration', () => {
  it('loads and types a valid development API configuration', () => {
    expect(loadApiConfig(validEnvironment)).toStrictEqual({
      environment: 'development',
      appName: 'customer-operations-platform',
      appVersion: '1.2.3',
      port: 3001,
      logLevel: 'debug',
      database: {
        url: 'postgresql://customer_ops:test-password@localhost:5432/customer_ops',
        maxConnections: 10,
        connectionTimeoutMs: 5000,
        idleTimeoutMs: 30000,
        statementTimeoutMs: 15000,
        idleTransactionTimeoutMs: 30000,
      },
    });
  });

  it('loads a valid production worker configuration with safe queue defaults', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'production',
        APP_NAME: 'customer-operations-platform',
        LOG_LEVEL: 'warn',
        DATABASE_URL: undefined,
        REDIS_URL: 'rediss://redis.example.test:6380',
      }),
    ).toStrictEqual({
      environment: 'production',
      appName: 'customer-operations-platform',
      logLevel: 'warn',
      queue: {
        redisUrl: 'rediss://redis.example.test:6380',
        prefix: 'customer-ops',
        workerConcurrency: 5,
        connectTimeoutMs: 5000,
        healthTimeoutMs: 2000,
        shutdownTimeoutMs: 15000,
      },
    });
  });

  it('applies safe runtime defaults', () => {
    expect(
      loadApiConfig({
        APP_NAME: 'customer-operations-platform',
        DATABASE_URL: 'postgres://localhost/customer_ops',
      }),
    ).toStrictEqual({
      environment: 'development',
      appName: 'customer-operations-platform',
      port: 3001,
      logLevel: 'info',
      database: {
        url: 'postgres://localhost/customer_ops',
        maxConnections: 10,
        connectionTimeoutMs: 5000,
        idleTimeoutMs: 30000,
        statementTimeoutMs: 15000,
        idleTransactionTimeoutMs: 30000,
      },
    });
  });

  it.each([
    ['invalid NODE_ENV', { ...validEnvironment, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['invalid API_PORT string', { ...validEnvironment, API_PORT: 'abc' }, 'API_PORT'],
    ['API_PORT below range', { ...validEnvironment, API_PORT: '0' }, 'API_PORT'],
    ['API_PORT above range', { ...validEnvironment, API_PORT: '65536' }, 'API_PORT'],
    ['invalid LOG_LEVEL', { ...validEnvironment, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    ['missing DATABASE_URL', { ...validEnvironment, DATABASE_URL: undefined }, 'DATABASE_URL'],
    [
      'invalid DATABASE_URL protocol',
      { ...validEnvironment, DATABASE_URL: 'mysql://localhost/customer_ops' },
      'DATABASE_URL',
    ],
    ['missing APP_NAME', { NODE_ENV: 'test', API_PORT: '3001' }, 'APP_NAME'],
  ])('rejects %s', (_name, environment, expectedField) => {
    expect(() => loadApiConfig(environment)).toThrowError(ConfigurationError);
    expect(() => loadApiConfig(environment)).toThrowError(expectedField);
  });

  it('loads explicit database pool settings', () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost/customer_ops',
        DB_POOL_MAX: '7',
        DB_CONNECTION_TIMEOUT_MS: '2500',
        DB_IDLE_TIMEOUT_MS: '45000',
        DB_STATEMENT_TIMEOUT_MS: '12000',
        DB_IDLE_TRANSACTION_TIMEOUT_MS: '20000',
      }),
    ).toStrictEqual({
      url: 'postgresql://localhost/customer_ops',
      maxConnections: 7,
      connectionTimeoutMs: 2500,
      idleTimeoutMs: 45000,
      statementTimeoutMs: 12000,
      idleTransactionTimeoutMs: 20000,
    });
  });

  it('loads explicit Redis and queue settings for the worker', () => {
    expect(
      loadWorkerConfig({
        APP_NAME: 'customer-operations-platform',
        REDIS_URL: 'redis://localhost:6379',
        QUEUE_PREFIX: 'customer-ops:test',
        WORKER_CONCURRENCY: '12',
        REDIS_CONNECT_TIMEOUT_MS: '2500',
        REDIS_HEALTH_TIMEOUT_MS: '750',
        WORKER_SHUTDOWN_TIMEOUT_MS: '20000',
      }),
    ).toMatchObject({
      queue: {
        redisUrl: 'redis://localhost:6379',
        prefix: 'customer-ops:test',
        workerConcurrency: 12,
        connectTimeoutMs: 2500,
        healthTimeoutMs: 750,
        shutdownTimeoutMs: 20000,
      },
    });
  });

  it.each([
    ['missing REDIS_URL', { REDIS_URL: undefined }, 'REDIS_URL'],
    ['invalid Redis protocol', { REDIS_URL: 'http://localhost:6379' }, 'REDIS_URL'],
    ['Redis URL without host', { REDIS_URL: 'redis:///queue' }, 'REDIS_URL'],
    ['zero concurrency', { WORKER_CONCURRENCY: '0' }, 'WORKER_CONCURRENCY'],
    ['oversized concurrency', { WORKER_CONCURRENCY: '101' }, 'WORKER_CONCURRENCY'],
    ['zero connect timeout', { REDIS_CONNECT_TIMEOUT_MS: '0' }, 'REDIS_CONNECT_TIMEOUT_MS'],
    ['oversized health timeout', { REDIS_HEALTH_TIMEOUT_MS: '30001' }, 'REDIS_HEALTH_TIMEOUT_MS'],
    [
      'oversized shutdown timeout',
      { WORKER_SHUTDOWN_TIMEOUT_MS: '120001' },
      'WORKER_SHUTDOWN_TIMEOUT_MS',
    ],
    ['empty prefix', { QUEUE_PREFIX: '' }, 'QUEUE_PREFIX'],
    ['unsafe prefix', { QUEUE_PREFIX: 'customer ops\nunsafe' }, 'QUEUE_PREFIX'],
    ['prefix with trailing control character', { QUEUE_PREFIX: 'customer-ops\n' }, 'QUEUE_PREFIX'],
    ['oversized prefix', { QUEUE_PREFIX: 'q'.repeat(129) }, 'QUEUE_PREFIX'],
  ])('rejects worker configuration with %s without leaking secrets', (_name, changed, field) => {
    const redisUrl = 'redis://queue-admin:do-not-leak@private.internal:6379';
    let thrown: unknown;
    try {
      loadWorkerConfig({
        APP_NAME: 'customer-operations-platform',
        REDIS_URL: redisUrl,
        ...changed,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as Error).message).toContain(field);
    expect((thrown as Error).message).not.toContain(redisUrl);
    expect((thrown as Error).message).not.toContain('do-not-leak');
  });

  it.each([
    ['DB_POOL_MAX is zero', 'DB_POOL_MAX', '0'],
    ['DB_POOL_MAX is negative', 'DB_POOL_MAX', '-1'],
    ['DB_POOL_MAX is oversized', 'DB_POOL_MAX', '101'],
    ['connection timeout is zero', 'DB_CONNECTION_TIMEOUT_MS', '0'],
    ['idle timeout is negative', 'DB_IDLE_TIMEOUT_MS', '-1'],
    ['statement timeout is oversized', 'DB_STATEMENT_TIMEOUT_MS', '300001'],
    ['idle transaction timeout is zero', 'DB_IDLE_TRANSACTION_TIMEOUT_MS', '0'],
  ])('rejects %s', (_name, field, value) => {
    const databaseUrl = 'postgresql://admin:configuration-secret@localhost/customer_ops';
    const environment = { DATABASE_URL: databaseUrl, [field]: value };

    let thrown: unknown;
    try {
      loadDatabaseConfig(environment);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as Error).message).toContain(field);
    expect((thrown as Error).message).not.toContain(databaseUrl);
    expect((thrown as Error).message).not.toContain('configuration-secret');
  });

  it('does not include unrelated environment values or secrets in validation errors', () => {
    const unrelatedSecret = 'do-not-leak-this-database-password';

    let thrown: unknown;
    try {
      loadApiConfig({
        ...validEnvironment,
        API_PORT: 'not-a-port',
        DATABASE_URL: `postgresql://admin:${unrelatedSecret}@database/internal`,
        APP_SECRET: unrelatedSecret,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as Error).message).not.toContain(unrelatedSecret);
    expect((thrown as Error).message).not.toContain('DATABASE_URL');
  });

  it('parses optional observability configuration without exposing the environment', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.test/v1/traces',
      UNUSED_VALUE: 'not-returned',
    });

    expect(config.otelExporterOtlpEndpoint).toBe('https://otel.example.test/v1/traces');
    expect(config).not.toHaveProperty('UNUSED_VALUE');
  });
});

describe('local dotenv discovery', () => {
  const configurationKeys = [
    'NODE_ENV',
    'APP_NAME',
    'APP_VERSION',
    'API_PORT',
    'LOG_LEVEL',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'DATABASE_URL',
    'DB_POOL_MAX',
    'DB_CONNECTION_TIMEOUT_MS',
    'DB_IDLE_TIMEOUT_MS',
    'DB_STATEMENT_TIMEOUT_MS',
    'DB_IDLE_TRANSACTION_TIMEOUT_MS',
    'REDIS_URL',
    'QUEUE_PREFIX',
    'WORKER_CONCURRENCY',
    'REDIS_CONNECT_TIMEOUT_MS',
    'REDIS_HEALTH_TIMEOUT_MS',
    'WORKER_SHUTDOWN_TIMEOUT_MS',
  ] as const;
  let originalDirectory: string;
  let originalEnvironment: Record<(typeof configurationKeys)[number], string | undefined>;
  let temporaryDirectory: string;
  let repositoryDirectory: string;

  beforeEach(async () => {
    originalDirectory = process.cwd();
    originalEnvironment = Object.fromEntries(
      configurationKeys.map((key) => [key, process.env[key]]),
    ) as Record<(typeof configurationKeys)[number], string | undefined>;
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'customer-ops-config-'));
    repositoryDirectory = join(temporaryDirectory, 'parent', 'repository');
    await mkdir(join(repositoryDirectory, 'apps', 'api'), { recursive: true });
    await mkdir(join(repositoryDirectory, 'apps', 'worker'), { recursive: true });
    await writeFile(join(repositoryDirectory, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');

    for (const key of configurationKeys) {
      delete process.env[key];
    }
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    process.chdir(originalDirectory);
    for (const key of configurationKeys) {
      const originalValue = originalEnvironment[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('loads the repository root .env when launched from the repository root', async () => {
    await writeFile(
      join(repositoryDirectory, '.env'),
      'APP_NAME=root-environment\nDATABASE_URL=postgresql://localhost/root_environment\nREDIS_URL=redis://localhost:6379\n',
    );
    process.chdir(repositoryDirectory);

    expect(loadApiConfigFromEnvironment()).toMatchObject({
      environment: 'test',
      appName: 'root-environment',
    });
  });

  it.each([
    ['apps/api', loadApiConfigFromEnvironment],
    ['apps/worker', loadWorkerConfigFromEnvironment],
  ])('loads the repository root .env when launched from %s', async (relativePath, loader) => {
    await writeFile(
      join(repositoryDirectory, '.env'),
      'APP_NAME=nested-environment\nDATABASE_URL=postgresql://localhost/nested_environment\nREDIS_URL=redis://localhost:6379\n',
    );
    process.chdir(join(repositoryDirectory, relativePath));

    expect(loader()).toMatchObject({
      environment: 'test',
      appName: 'nested-environment',
    });
  });

  it('does not load an environment file when the repository contains none', () => {
    process.chdir(join(repositoryDirectory, 'apps', 'api'));

    expect(() => loadApiConfigFromEnvironment()).toThrowError(ConfigurationError);
    expect(process.env.APP_NAME).toBeUndefined();
  });

  it('does not load a parent environment file outside the repository boundary', async () => {
    await writeFile(join(temporaryDirectory, 'parent', '.env'), 'APP_NAME=external-environment\n');
    process.chdir(join(repositoryDirectory, 'apps', 'worker'));

    expect(() => loadWorkerConfigFromEnvironment()).toThrowError(ConfigurationError);
    expect(process.env.APP_NAME).toBeUndefined();
  });

  it('skips local dotenv loading in production', async () => {
    await writeFile(
      join(repositoryDirectory, '.env'),
      'APP_NAME=local-production-environment\nDATABASE_URL=postgresql://localhost/production_environment\nREDIS_URL=redis://localhost:6379\n',
    );
    process.env.NODE_ENV = 'production';
    process.chdir(repositoryDirectory);

    expect(() => loadApiConfigFromEnvironment()).toThrowError(ConfigurationError);
    expect(process.env.APP_NAME).toBeUndefined();
  });
});
