import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import { createServer, type Server } from 'node:http';

export interface NotificationPlatformHealth {
  query(text: string): Promise<unknown>;
}

export interface NotificationConsumerHealth {
  ready(): boolean;
}

interface NotificationRabbitConsumer {
  start(handler: (event: IntegrationEventEnvelope) => Promise<void>): Promise<void>;
  close(): Promise<void>;
  isReady?(): boolean;
}

export function featureFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Feature flag must be true or false.');
}

export class NotificationConsumerRuntime implements NotificationConsumerHealth {
  private started = false;

  constructor(
    private readonly consumer: NotificationRabbitConsumer,
    private readonly enabled: boolean,
  ) {}

  async start(
    handler: (event: IntegrationEventEnvelope) => Promise<void>,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.consumer.start(handler);
    this.started = true;
  }

  ready(): boolean {
    return (
      !this.enabled ||
      (this.started && (this.consumer.isReady?.() ?? true))
    );
  }

  async close(): Promise<void> {
    if (this.enabled) await this.consumer.close();
    this.started = false;
  }
}

export class NotificationWorkerOperational {
  private readonly registry = new Registry();
  private readonly processedEvents = new Counter<'outcome'>({
    name: 'notification_worker_events_processed_total',
    help: 'Domain events completed by the notification worker.',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  private readonly failures = new Counter<'kind'>({
    name: 'notification_worker_failures_total',
    help: 'Domain event processing failures.',
    labelNames: ['kind'],
    registers: [this.registry],
  });
  private readonly queueLag = new Histogram({
    name: 'notification_worker_queue_lag_seconds',
    help: 'Seconds from domain event occurrence until worker completion.',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300],
    registers: [this.registry],
  });

  constructor(
    private readonly platform: NotificationPlatformHealth,
    private readonly consumer: NotificationConsumerHealth,
  ) {}

  live(): { readonly status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<
    | { readonly status: 'ready' }
    | { readonly status: 'not-ready'; readonly reason: string }
  > {
    try {
      await this.platform.query('SELECT 1 AS ready');
      if (!this.consumer.ready()) {
        return {
          status: 'not-ready',
          reason: 'RabbitMQ notification consumer is not ready.',
        };
      }
      return { status: 'ready' };
    } catch (error) {
      return {
        status: 'not-ready',
        reason: error instanceof Error ? error.message : 'Dependency check failed.',
      };
    }
  }

  processed(outcome: string, occurredAt: string): void {
    this.processedEvents.inc({ outcome });
    const occurredAtMs = Date.parse(occurredAt);
    if (Number.isFinite(occurredAtMs)) {
      this.queueLag.observe(Math.max(0, Date.now() - occurredAtMs) / 1_000);
    }
  }

  failed(kind: string): void {
    this.failures.inc({ kind });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

export function createNotificationOperationalServer(
  operational: NotificationWorkerOperational,
): Server {
  return createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (request.url === '/health/live') {
      json(response, 200, operational.live());
      return;
    }
    if (request.url === '/health/ready') {
      const readiness = await operational.ready();
      json(response, readiness.status === 'ready' ? 200 : 503, readiness);
      return;
    }
    if (request.url === '/metrics') {
      response.writeHead(200, { 'content-type': operational.contentType });
      response.end(await operational.metrics());
      return;
    }
    response.writeHead(404).end();
  });
}

function json(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function operationalLog(
  level: 'info' | 'error',
  event: string,
  details: Record<string, unknown> = {},
): void {
  const message = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'notification-worker',
    event,
    ...details,
  });
  if (level === 'error') console.error(message);
  else console.info(message);
}
