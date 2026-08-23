import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApiTestHarness, type ApiTestHarness } from '../helpers/api-test-harness';

describe('application entry points', () => {
  let api: ApiTestHarness;

  beforeAll(async () => {
    api = await startApiTestHarness();
  });

  afterAll(async () => {
    await api.close();
  });

  it('keeps the web root and live API operational endpoint available', async () => {
    const [health, web] = await Promise.all([
      fetch(`${api.baseUrl}/health`),
      readFile('apps/web/app/page.tsx', 'utf8'),
    ]);

    expect(health.status).toBe(200);
    expect(await health.json()).toStrictEqual({ status: 'ok' });
    expect(web).toContain('Development environment ready');
  });

  it('exposes readiness only after successful application bootstrap', async () => {
    const readiness = await fetch(`${api.baseUrl}/ready`);

    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toStrictEqual({ status: 'ready' });
  });
});
