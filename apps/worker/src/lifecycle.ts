import type { WorkerApplication } from './worker.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface WorkerSignalSource {
  on(this: void, signal: ShutdownSignal, listener: () => void): unknown;
  off(this: void, signal: ShutdownSignal, listener: () => void): unknown;
}

type LifecycleOutcome =
  | { kind: 'started' }
  | { kind: 'startup_failed'; error: unknown }
  | { kind: 'shutdown' };

export async function runWorkerLifecycle(
  worker: WorkerApplication,
  signalSource: WorkerSignalSource = process,
): Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  let resolveShutdown: ((outcome: LifecycleOutcome) => void) | undefined;
  let rejectShutdown: ((error: unknown) => void) | undefined;
  const shutdownOutcome = new Promise<LifecycleOutcome>((resolve, reject) => {
    resolveShutdown = resolve;
    rejectShutdown = reject;
  });
  const listeners = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => {
      shutdownPromise ??= worker.stop(signal);
      void shutdownPromise.then(
        () => resolveShutdown?.({ kind: 'shutdown' }),
        (error: unknown) => rejectShutdown?.(error),
      );
    };
    return { signal, listener };
  });

  for (const { signal, listener } of listeners) {
    signalSource.on(signal, listener);
  }

  try {
    const startupOutcome: Promise<LifecycleOutcome> = worker.start().then(
      () => ({ kind: 'started' }),
      (error: unknown) => ({ kind: 'startup_failed', error }),
    );
    const firstOutcome = await Promise.race([startupOutcome, shutdownOutcome]);

    if (firstOutcome.kind === 'startup_failed') {
      throw firstOutcome.error;
    }
    if (firstOutcome.kind === 'started') {
      await shutdownOutcome;
    }
  } finally {
    for (const { signal, listener } of listeners) {
      signalSource.off(signal, listener);
    }
  }
}
