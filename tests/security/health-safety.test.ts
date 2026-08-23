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
