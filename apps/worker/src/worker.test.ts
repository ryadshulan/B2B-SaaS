import { describe, expect, it } from 'vitest';
import { WorkerApplication } from './worker.js';
describe('WorkerApplication', () => {
  it('supports startup and graceful shutdown lifecycle', () => { const worker = new WorkerApplication(); worker.start(); expect(worker.isRunning()).toBe(true); worker.stop(); expect(worker.isRunning()).toBe(false); });
});
