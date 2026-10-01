import { ServiceUnavailableException } from '@nestjs/common';

export function featureFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Feature flag must be true or false.');
}

export class RealtimeMutationPolicy {
  constructor(private readonly enabled: boolean) {}

  assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        status: 'read-only',
        reason: 'Realtime notification mutations are temporarily disabled.',
      });
    }
  }
}

export function operationalLog(
  level: 'info' | 'error',
  event: string,
  details: Record<string, unknown> = {},
): void {
  const message = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'realtime-api',
    event,
    ...details,
  });
  if (level === 'error') console.error(message);
  else console.info(message);
}
