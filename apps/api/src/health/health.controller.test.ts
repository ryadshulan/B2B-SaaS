import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
describe('HealthController', () => {
  it('returns only a safe status', () => { expect(new HealthController().getHealth()).toStrictEqual({ status: 'ok' }); });
});
