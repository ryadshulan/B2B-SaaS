import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  workspaceId?: string;
  actorId?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return requestContextStorage.run(Object.freeze({ ...context }), operation);
}

export function getRequestContext(): Readonly<RequestContext> | undefined {
  return requestContextStorage.getStore();
}

export function getRequestId(): string | undefined {
  return getRequestContext()?.requestId;
}

export function getCorrelationId(): string | undefined {
  return getRequestContext()?.correlationId;
}
