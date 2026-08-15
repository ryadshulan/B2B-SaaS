import { WorkerApplication } from './worker.js';
const worker = new WorkerApplication();
worker.start();

await new Promise<void>((resolve) => {
  const shutdown = (): void => {
    worker.stop();
    resolve();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
});
