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

export interface ApiConfig extends RuntimeConfig {
  port: number;
}

export type WorkerConfig = RuntimeConfig;

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

const apiSchema = z.object({
  ...baseSchemaShape,
  API_PORT: z
    .string()
    .regex(/^\d+$/, 'must be an integer between 1 and 65535')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65_535))
    .default(3001),
});

const workerSchema = z.object(baseSchemaShape);

function parseConfig<T>(schema: z.ZodType<T>, environment: EnvironmentSource): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(result.error);
  }
  return result.data;
}

function toRuntimeConfig(parsed: z.output<typeof workerSchema>): RuntimeConfig {
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

export function loadApiConfig(environment: EnvironmentSource): ApiConfig {
  const parsed = parseConfig(apiSchema, environment);
  return { ...toRuntimeConfig(parsed), port: parsed.API_PORT };
}

export function loadWorkerConfig(environment: EnvironmentSource): WorkerConfig {
  return toRuntimeConfig(parseConfig(workerSchema, environment));
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
