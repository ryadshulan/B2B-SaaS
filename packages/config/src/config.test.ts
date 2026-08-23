import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  loadApiConfig,
  loadApiConfigFromEnvironment,
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
};

describe('runtime configuration', () => {
  it('loads and types a valid development API configuration', () => {
    expect(loadApiConfig(validEnvironment)).toStrictEqual({
      environment: 'development',
      appName: 'customer-operations-platform',
      appVersion: '1.2.3',
      port: 3001,
      logLevel: 'debug',
    });
  });

  it('loads a valid production worker configuration without infrastructure values', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'production',
        APP_NAME: 'customer-operations-platform',
        LOG_LEVEL: 'warn',
        DATABASE_URL: undefined,
        REDIS_URL: undefined,
      }),
    ).toStrictEqual({
      environment: 'production',
      appName: 'customer-operations-platform',
      logLevel: 'warn',
    });
  });

  it('applies safe runtime defaults', () => {
    expect(loadApiConfig({ APP_NAME: 'customer-operations-platform' })).toStrictEqual({
      environment: 'development',
      appName: 'customer-operations-platform',
      port: 3001,
      logLevel: 'info',
    });
  });

  it.each([
    ['invalid NODE_ENV', { ...validEnvironment, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['invalid API_PORT string', { ...validEnvironment, API_PORT: 'abc' }, 'API_PORT'],
    ['API_PORT below range', { ...validEnvironment, API_PORT: '0' }, 'API_PORT'],
    ['API_PORT above range', { ...validEnvironment, API_PORT: '65536' }, 'API_PORT'],
    ['invalid LOG_LEVEL', { ...validEnvironment, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    ['missing APP_NAME', { NODE_ENV: 'test', API_PORT: '3001' }, 'APP_NAME'],
  ])('rejects %s', (_name, environment, expectedField) => {
    expect(() => loadApiConfig(environment)).toThrowError(ConfigurationError);
    expect(() => loadApiConfig(environment)).toThrowError(expectedField);
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
    await writeFile(join(repositoryDirectory, '.env'), 'APP_NAME=root-environment\n');
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
    await writeFile(join(repositoryDirectory, '.env'), 'APP_NAME=nested-environment\n');
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
    await writeFile(join(repositoryDirectory, '.env'), 'APP_NAME=local-production-environment\n');
    process.env.NODE_ENV = 'production';
    process.chdir(repositoryDirectory);

    expect(() => loadApiConfigFromEnvironment()).toThrowError(ConfigurationError);
    expect(process.env.APP_NAME).toBeUndefined();
  });
});
