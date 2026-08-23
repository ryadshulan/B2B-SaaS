import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApiTestHarness, type ApiTestHarness } from '../helpers/api-test-harness';

describe('API runtime integration', () => {
  let api: ApiTestHarness;

  beforeAll(async () => {
    api = await startApiTestHarness();
  });

  beforeEach(() => {
    api.records.length = 0;
  });

  afterAll(async () => {
    await api.close();
  });

  it('serves minimal unversioned liveness and readiness contracts', async () => {
    const [health, readiness] = await Promise.all([
      fetch(`${api.baseUrl}/health`),
      fetch(`${api.baseUrl}/ready`),
    ]);

    expect(health.status).toBe(200);
    expect(await health.json()).toStrictEqual({ status: 'ok' });
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toStrictEqual({ status: 'ready' });
  });

  it('propagates correlation IDs and writes correlated completion logs', async () => {
    const response = await fetch(`${api.baseUrl}/health`, {
      headers: { 'x-correlation-id': 'integration-correlation' },
    });
    await response.text();
    const completion = api.records.find((record) => record.event === 'http.request.completed');

    expect(response.headers.get('x-correlation-id')).toBe('integration-correlation');
    expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    expect(completion).toMatchObject({
      path: '/health',
      request_id: response.headers.get('x-request-id'),
      correlation_id: 'integration-correlation',
    });
  });

  it('normalizes framework 404s through the global error contract', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        request_id: response.headers.get('x-request-id'),
      },
    });
  });

  it('keeps operational routes outside the versioned API namespace', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/health`);

    expect(response.status).toBe(404);
  });
});
