import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('application entry points', () => {
  it('keeps the API health route and web root available', async () => {
    const [health, web] = await Promise.all([readFile('apps/api/src/health/health.controller.ts', 'utf8'), readFile('apps/web/app/page.tsx', 'utf8')]);
    expect(health).toContain("@Controller('health')");
    expect(web).toContain('Development environment ready');
  });
});
