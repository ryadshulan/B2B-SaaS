/** Minimal envelope shape only; durable publication is not implemented in C00. */
export interface EventEnvelope<TName extends string, TPayload> { readonly id: string; readonly name: TName; readonly occurredAt: string; readonly payload: TPayload; }
