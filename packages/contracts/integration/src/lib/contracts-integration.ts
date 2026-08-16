export interface IntegrationEventEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly source: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly payload: TPayload;
}

export interface OutboxRecord<TPayload = unknown> {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly event: IntegrationEventEnvelope<TPayload>;
  readonly attempts: number;
  readonly createdAt: string;
}

export function createIntegrationEvent<TPayload>(input: {
  id: string;
  type: string;
  version?: number;
  tenantId: string;
  source: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
  occurredAt?: string;
}): IntegrationEventEnvelope<TPayload> {
  return {
    ...input,
    version: input.version ?? 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}
