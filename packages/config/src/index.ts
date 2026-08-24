import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z, type ZodError } from 'zod';

export type RuntimeEnvironment = 'development' | 'test' | 'production';
export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface RuntimeConfig {
  environment: RuntimeEnvironment;
  appName: string;
  appVersion?: string;
  logLevel: RuntimeLogLevel;
  otelExporterOtlpEndpoint?: string;
}

export interface DatabaseConfig {
  url: string;
  maxConnections: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  idleTransactionTimeoutMs: number;
}

export interface ApiConfig extends RuntimeConfig {
  port: number;
  database: DatabaseConfig;
}

export interface DatabaseRuntimeConfig extends RuntimeConfig {
  database: DatabaseConfig;
}

export interface QueueConfig {
  redisUrl: string;
  prefix: string;
  workerConcurrency: number;
  connectTimeoutMs: number;
  healthTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export interface WorkerConfig extends RuntimeConfig {
  queue: QueueConfig;
}

export interface ConfigurationIssue {
  field: string;
  problem: string;
}

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];

  constructor(error: ZodError) {
    const issues = error.issues.map((issue) => ({
      field: issue.path.join('.') || 'configuration',
      problem: issue.message,
    }));
    super(
      `Invalid runtime configuration: ${issues
        .map((issue) => `${issue.field}: ${issue.problem}`)
        .join('; ')}`,
    );
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

const optionalBoundedString = z
  .string()
  .trim()
  .max(256)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const baseSchemaShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().trim().min(1).max(128),
  APP_VERSION: optionalBoundedString,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalBoundedString.pipe(z.url().max(2048).optional()),
};

function positiveBoundedInteger(defaultValue: number, maximum: number) {
  return z
    .string()
    .regex(/^\d+$/, `must be an integer between 1 and ${maximum}`)
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum))
    .default(defaultValue);
}

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1, 'must be a non-empty PostgreSQL URL')
  .max(2048, 'must be at most 2048 characters')
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') ||
        url.hostname === '' ||
        url.pathname === '' ||
        url.pathname === '/'
      ) {
        context.addIssue({ code: 'custom', message: 'must be a valid PostgreSQL URL' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a valid PostgreSQL URL' });
    }
  });

const databaseSchemaShape = {
  DATABASE_URL: databaseUrlSchema,
  DB_POOL_MAX: positiveBoundedInteger(10, 100),
  DB_CONNECTION_TIMEOUT_MS: positiveBoundedInteger(5_000, 60_000),
  DB_IDLE_TIMEOUT_MS: positiveBoundedInteger(30_000, 600_000),
  DB_STATEMENT_TIMEOUT_MS: positiveBoundedInteger(15_000, 300_000),
  DB_IDLE_TRANSACTION_TIMEOUT_MS: positiveBoundedInteger(30_000, 300_000),
};

const redisUrlSchema = z
  .string()
  .trim()
  .min(1, 'must be a non-empty Redis URL')
  .max(2048, 'must be at most 2048 characters')
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if ((url.protocol !== 'redis:' && url.protocol !== 'rediss:') || url.hostname === '') {
        context.addIssue({ code: 'custom', message: 'must be a valid Redis URL' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a valid Redis URL' });
    }
  });

const queueSchemaShape = {
  REDIS_URL: redisUrlSchema,
  QUEUE_PREFIX: z
    .string()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
      'must start with an alphanumeric character and contain only letters, numbers, dot, underscore, colon, or hyphen',
    )
    .default('customer-ops'),
  WORKER_CONCURRENCY: positiveBoundedInteger(5, 100),
  REDIS_CONNECT_TIMEOUT_MS: positiveBoundedInteger(5_000, 60_000),
  REDIS_HEALTH_TIMEOUT_MS: positiveBoundedInteger(2_000, 30_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: positiveBoundedInteger(15_000, 120_000),
};

const apiSchema = z.object({
  ...baseSchemaShape,
  ...databaseSchemaShape,
  API_PORT: z
    .string()
    .regex(/^\d+$/, 'must be an integer between 1 and 65535')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65_535))
    .default(3001),
});

const workerSchema = z.object({ ...baseSchemaShape, ...queueSchemaShape });
const databaseSchema = z.object(databaseSchemaShape);
const databaseRuntimeSchema = z.object({ ...baseSchemaShape, ...databaseSchemaShape });

function parseConfig<T>(schema: z.ZodType<T>, environment: EnvironmentSource): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(result.error);
  }
  return result.data;
}

function toRuntimeConfig(parsed: z.output<typeof workerSchema>): RuntimeConfig;
function toRuntimeConfig(parsed: z.output<typeof apiSchema>): RuntimeConfig;
function toRuntimeConfig(parsed: z.output<typeof databaseRuntimeSchema>): RuntimeConfig;
function toRuntimeConfig(
  parsed: z.output<typeof workerSchema | typeof apiSchema | typeof databaseRuntimeSchema>,
): RuntimeConfig {
  return {
    environment: parsed.NODE_ENV,
    appName: parsed.APP_NAME,
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.APP_VERSION === undefined ? {} : { appVersion: parsed.APP_VERSION }),
    ...(parsed.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
      ? {}
      : { otelExporterOtlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT }),
  };
}

function toQueueConfig(parsed: z.output<typeof workerSchema>): QueueConfig {
  return {
    redisUrl: parsed.REDIS_URL,
    prefix: parsed.QUEUE_PREFIX,
    workerConcurrency: parsed.WORKER_CONCURRENCY,
    connectTimeoutMs: parsed.REDIS_CONNECT_TIMEOUT_MS,
    healthTimeoutMs: parsed.REDIS_HEALTH_TIMEOUT_MS,
    shutdownTimeoutMs: parsed.WORKER_SHUTDOWN_TIMEOUT_MS,
  };
}

function toDatabaseConfig(parsed: z.output<typeof databaseSchema>): DatabaseConfig {
  return {
    url: parsed.DATABASE_URL,
    maxConnections: parsed.DB_POOL_MAX,
    connectionTimeoutMs: parsed.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: parsed.DB_IDLE_TIMEOUT_MS,
    statementTimeoutMs: parsed.DB_STATEMENT_TIMEOUT_MS,
    idleTransactionTimeoutMs: parsed.DB_IDLE_TRANSACTION_TIMEOUT_MS,
  };
}

export function loadApiConfig(environment: EnvironmentSource): ApiConfig {
  const parsed = parseConfig(apiSchema, environment);
  return {
    ...toRuntimeConfig(parsed),
    port: parsed.API_PORT,
    database: toDatabaseConfig(parsed),
  };
}

export function loadWorkerConfig(environment: EnvironmentSource): WorkerConfig {
  const parsed = parseConfig(workerSchema, environment);
  return { ...toRuntimeConfig(parsed), queue: toQueueConfig(parsed) };
}

export function loadDatabaseConfig(environment: EnvironmentSource): DatabaseConfig {
  return toDatabaseConfig(parseConfig(databaseSchema, environment));
}

export function loadDatabaseRuntimeConfig(environment: EnvironmentSource): DatabaseRuntimeConfig {
  const parsed = parseConfig(databaseRuntimeSchema, environment);
  return { ...toRuntimeConfig(parsed), database: toDatabaseConfig(parsed) };
}

function findRepositoryRoot(startDirectory: string): string | undefined {
  let currentDirectory = resolve(startDirectory);
  const root = parse(currentDirectory).root;

  while (true) {
    if (
      existsSync(join(currentDirectory, '.git')) ||
      existsSync(join(currentDirectory, 'pnpm-workspace.yaml'))
    ) {
      return currentDirectory;
    }
    if (currentDirectory === root) {
      return undefined;
    }
    currentDirectory = dirname(currentDirectory);
  }
}

function findLocalEnvironmentFile(startDirectory: string): string | undefined {
  const repositoryRoot = findRepositoryRoot(startDirectory);
  if (repositoryRoot === undefined) {
    return undefined;
  }

  let currentDirectory = resolve(startDirectory);
  while (true) {
    const candidate = join(currentDirectory, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    if (currentDirectory === repositoryRoot) {
      return undefined;
    }
    currentDirectory = dirname(currentDirectory);
  }
}

function loadLocalEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV === 'production') {
    return;
  }

  const environmentFile = findLocalEnvironmentFile(process.cwd());
  if (environmentFile !== undefined) {
    loadDotenv({ path: environmentFile, override: false, quiet: true });
  }
}

export function loadApiConfigFromEnvironment(): ApiConfig {
  loadLocalEnvironment(process.env);
  return loadApiConfig(process.env);
}

export function loadWorkerConfigFromEnvironment(): WorkerConfig {
  loadLocalEnvironment(process.env);
  return loadWorkerConfig(process.env);
}

export function loadDatabaseConfigFromEnvironment(): DatabaseConfig {
  loadLocalEnvironment(process.env);
  return loadDatabaseConfig(process.env);
}

export function loadDatabaseRuntimeConfigFromEnvironment(): DatabaseRuntimeConfig {
  loadLocalEnvironment(process.env);
  return loadDatabaseRuntimeConfig(process.env);
}
