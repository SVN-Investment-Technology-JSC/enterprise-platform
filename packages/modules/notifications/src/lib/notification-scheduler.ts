import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { Pool, QueryResultRow } from 'pg';

export interface NotificationScheduleCandidate {
  readonly scheduleKey: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly userId: string;
  readonly scheduledFor: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CalendarReminderScheduleInput {
  readonly eventId: string;
  readonly userId: string;
  readonly title: string;
  readonly startAt: string;
  readonly timezone: string;
}

export interface ProcedureSlaScheduleInput {
  readonly instanceId: string;
  readonly stepInstanceId: string;
  readonly title: string;
  readonly dueAt: string;
  readonly recipientUserIds: readonly string[];
}

interface AdvisoryLockRow extends QueryResultRow {
  acquired: boolean;
}

export function calendarReminderSchedule(
  input: CalendarReminderScheduleInput,
): NotificationScheduleCandidate {
  const start = Date.parse(input.startAt);
  if (Number.isNaN(start)) throw new TypeError('Calendar startAt must be an ISO date.');
  if (!input.timezone.trim()) throw new TypeError('Calendar timezone is required.');
  return {
    scheduleKey: `workspace:calendar:${input.eventId}:reminder`,
    eventType: 'workspace.calendar-event.reminder',
    aggregateType: 'workspace-calendar-event',
    aggregateId: input.eventId,
    userId: input.userId,
    scheduledFor: new Date(start - 15 * 60_000).toISOString(),
    payload: {
      eventId: input.eventId,
      title: input.title,
      startAt: new Date(start).toISOString(),
      timezone: input.timezone,
      participantUserIds: [input.userId],
    },
  };
}

export function procedureSlaSchedules(
  input: ProcedureSlaScheduleInput,
): readonly NotificationScheduleCandidate[] {
  const dueAt = Date.parse(input.dueAt);
  if (Number.isNaN(dueAt)) throw new TypeError('Procedure SLA dueAt must be an ISO date.');
  return [...new Set(input.recipientUserIds)].flatMap((userId) =>
    (['warning', 'breached'] as const).map((kind) => ({
      scheduleKey: `procedure:sla:${input.instanceId}:${input.stepInstanceId}:${kind}`,
      eventType: `procedure.sla.${kind}`,
      aggregateType: 'procedure-instance',
      aggregateId: input.instanceId,
      userId,
      scheduledFor: new Date(
        kind === 'warning' ? dueAt - 60 * 60_000 : dueAt,
      ).toISOString(),
      payload: {
        instanceId: input.instanceId,
        stepInstanceId: input.stepInstanceId,
        title: input.title,
        dueAt: new Date(dueAt).toISOString(),
        assigneeUserId: userId,
      },
    })),
  );
}

export class PostgresNotificationScheduler {
  constructor(
    private readonly pool: Pool,
    private readonly nextId: () => string = randomUUID,
  ) {}

  async emitDue(
    tenantId: string,
    candidates: readonly NotificationScheduleCandidate[],
    now = new Date(),
  ): Promise<number> {
    const due = candidates
      .filter((candidate) => {
        const scheduledFor = Date.parse(candidate.scheduledFor);
        if (Number.isNaN(scheduledFor)) {
          throw new TypeError(`Invalid scheduledFor for ${candidate.scheduleKey}.`);
        }
        return scheduledFor <= now.getTime();
      })
      .sort((left, right) =>
        left.scheduledFor.localeCompare(right.scheduledFor),
      );
    if (due.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query<AdvisoryLockRow>(
        `SELECT pg_try_advisory_xact_lock(
                  hashtextextended($1::text, 0)
                ) AS acquired`,
        [`notification-scheduler:${tenantId}`],
      );
      if (!lock.rows[0]?.acquired) {
        await client.query('ROLLBACK');
        return 0;
      }

      let emitted = 0;
      for (const candidate of due) {
        validateCandidate(candidate);
        const eventId = this.nextId();
        const claimed = await client.query<{ event_id: string }>(
          `INSERT INTO notification_schema.schedule_emissions
             (schedule_key, user_id, scheduled_for, event_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (schedule_key, user_id, scheduled_for) DO NOTHING
           RETURNING event_id`,
          [
            candidate.scheduleKey,
            candidate.userId,
            candidate.scheduledFor,
            eventId,
          ],
        );
        if (!claimed.rowCount) continue;

        const event = createIntegrationEvent({
          id: eventId,
          type: candidate.eventType,
          version: 1,
          tenantId,
          source: 'notification-scheduler',
          correlationId: candidate.aggregateId,
          occurredAt: now.toISOString(),
          payload: {
            ...candidate.payload,
            scheduledFor: candidate.scheduledFor,
          },
        });
        await client.query(
          `INSERT INTO integration_schema.outbox_events
             (id, aggregate_type, aggregate_id, event_type, event_version,
              payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            event.id,
            candidate.aggregateType,
            candidate.aggregateId,
            event.type,
            event.version,
            JSON.stringify(event),
            event.occurredAt,
          ],
        );
        emitted += 1;
      }
      await client.query('COMMIT');
      return emitted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateCandidate(candidate: NotificationScheduleCandidate): void {
  for (const [name, value] of Object.entries({
    scheduleKey: candidate.scheduleKey,
    eventType: candidate.eventType,
    aggregateType: candidate.aggregateType,
    aggregateId: candidate.aggregateId,
    userId: candidate.userId,
  })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${name} is required.`);
    }
  }
}
