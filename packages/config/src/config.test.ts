import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  loadApiConfig,
  loadWorkerConfig,
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
