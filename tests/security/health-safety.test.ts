import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createLogger } from '@customer-ops/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveCorrelationId } from '../../apps/api/src/runtime/request-context.middleware';
import { startApiTestHarness, type ApiTestHarness } from '../helpers/api-test-harness';

async function findTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? findTypeScriptFiles(path)
        : Promise.resolve(path.endsWith('.ts') ? [path] : []);
    }),
  );
  return files.flat();
}

describe('runtime foundation security', () => {
  let api: ApiTestHarness;

  beforeAll(async () => {
    api = await startApiTestHarness();
  });

  afterAll(async () => {
    await api.close();
  });

  it('does not inspect or return environment configuration', async () => {
    const source = await readFile('apps/api/src/health/health.controller.ts', 'utf8');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('DATABASE_URL');
  });

  it('prevents direct process.env access in API and worker source', async () => {
    const files = await Promise.all([
      findTypeScriptFiles('apps/api/src'),
      findTypeScriptFiles('apps/worker/src'),
    ]);
    const sourceFiles = files.flat();
    const contents = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')));

    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(contents.filter((source) => source.includes('process.env'))).toStrictEqual([]);
  });

  it('keeps PostgreSQL driver construction inside the database package', async () => {
    const [apiFiles, workerFiles, databaseFiles] = await Promise.all([
      findTypeScriptFiles('apps/api/src'),
      findTypeScriptFiles('apps/worker/src'),
      findTypeScriptFiles('packages/database/src'),
    ]);
    const applicationSources = await Promise.all(
      [...apiFiles, ...workerFiles].map((file) => readFile(file, 'utf8')),
    );
    const databaseSources = await Promise.all(
      databaseFiles.map(async (file) => ({ file, source: await readFile(file, 'utf8') })),
    );

    expect(applicationSources.filter((source) => /from ['"]pg['"]/u.test(source))).toStrictEqual(
      [],
    );
    expect(applicationSources.filter((source) => /new Pool\s*\(/u.test(source))).toStrictEqual([]);
    expect(
      databaseSources.filter(({ source }) => /new Pool\s*\(/u.test(source)).map(({ file }) => file),
    ).toStrictEqual([join('packages', 'database', 'src', 'pool.ts')]);
  });

  it('keeps controllers outside raw database and transaction boundaries', async () => {
    const apiFiles = await findTypeScriptFiles('apps/api/src');
    const controllerFiles = apiFiles.filter((file) => file.endsWith('.controller.ts'));
    const controllerSources = await Promise.all(
      controllerFiles.map((file) => readFile(file, 'utf8')),
    );

    expect(controllerFiles.length).toBeGreaterThan(0);
    expect(
      controllerSources.filter((source) =>
        /@customer-ops\/database|from ['"](?:pg|kysely)['"]|DATABASE_RUNTIME/u.test(source),
      ),
    ).toStrictEqual([]);
  });

  it('records enforceable tenant persistence conventions before tenant schema exists', async () => {
    const [security, databaseOperations, agentRules] = await Promise.all([
      readFile('docs/security/SECURITY.md', 'utf8'),
      readFile('docs/operations/DATABASE.md', 'utf8'),
      readFile('AGENTS.md', 'utf8'),
    ]);
    const conventions = `${security}\n${databaseOperations}\n${agentRules}`;

    expect(conventions).toContain('workspace_id');
    expect(conventions).toMatch(/explicit (?:trusted )?workspace scope/iu);
    expect(conventions).toContain('findById(id)');
    expect(conventions).toMatch(/frontend-supplied workspace ID.+not authorization/iu);
    expect(conventions).toMatch(/row-level security.+defense in depth/iu);
  });

  it('redacts nested logger secrets in actual structured output', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const logger = createLogger({
      service: 'security-test',
      environment: 'test',
      level: 'info',
      destination,
    });

    logger.info({ credentials: { api_secret: 'must-not-appear' } }, 'safe event');

    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('must-not-appear');
  });

  it('never serializes database URLs or embedded PostgreSQL credentials', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const logger = createLogger({
      service: 'database-security-test',
      environment: 'test',
      level: 'info',
      destination,
    });
    const databaseUrl =
      'postgresql://security-user:security-password@private.internal/customer_ops';

    logger.info(
      { databaseUrl, nested: { database_url: databaseUrl } },
      `databaseUrl=${databaseUrl}`,
    );

    expect(output).not.toContain(databaseUrl);
    expect(output).not.toContain('security-user');
    expect(output).not.toContain('security-password');
    expect(output).toContain('[REDACTED]');
  });

  it('returns minimal health and readiness responses without infrastructure data', async () => {
    const [health, readiness] = await Promise.all([
      fetch(`${api.baseUrl}/health`),
      fetch(`${api.baseUrl}/ready`),
    ]);
    const responses = [await health.text(), await readiness.text()];

    expect(JSON.parse(responses[0] ?? '')).toStrictEqual({ status: 'ok' });
    expect(JSON.parse(responses[1] ?? '')).toStrictEqual({ status: 'ready' });
    for (const response of responses) {
      expect(response).not.toMatch(/DATABASE_URL|REDIS_URL|password|secret|process\.env/iu);
    }
  });

  it('does not expose database failure or credential details through readiness', async () => {
    api.database.setHealthy(false);
    const response = await fetch(`${api.baseUrl}/ready`);
    const responseText = await response.text();
    api.database.setHealthy(true);

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toStrictEqual({ status: 'not_ready' });
    expect(responseText).not.toMatch(
      /postgres|database_url|username|password|credential|host|port|stack|error/iu,
    );
  });

  it('does not leak stack traces or internals in normalized errors', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/security-missing`);
    const responseText = await response.text();

    expect(response.status).toBe(404);
    expect(responseText).not.toMatch(/stack|node_modules|[A-Z]:\\|\/home\//iu);
    expect(responseText).not.toMatch(/password|secret|token/iu);
  });

  it('rejects correlation IDs with control characters or unsafe punctuation', () => {
    const maliciousValues = [
      'safe\r\nx-injected: yes',
      'safe\nnewline',
      'unsafe value',
      '<script>',
      'a'.repeat(129),
    ];

    for (const value of maliciousValues) {
      expect(resolveCorrelationId(value)).not.toBe(value);
    }
  });
});
