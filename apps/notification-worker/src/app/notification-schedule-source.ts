import type { Pool } from 'pg';
import {
  calendarReminderSchedule,
  procedureSlaSchedules,
  resolveProcedureAssigneeUserIds,
  type NotificationScheduleCandidate,
} from '@enterprise-platform/module-notifications';
import { expandOccurrences, parseRecurrenceRule } from '@enterprise-platform/module-workspace';

interface DeadlineRow {
  id: string; title: string; due_at: Date; project_id?: string; assignee_user_id?: string;
  assignee_id?: string; created_by?: string; code?: string | null;
}
/** The workspace query filters `assignee_user_id IS NOT NULL`, so rows from it always carry the assignee. */
type AssignedDeadlineRow = DeadlineRow & { assignee_user_id: string };
interface CalendarRow {
  id: string; series_id: string; project_id?: string; title: string; start_at: Date; end_at: Date;
  timezone: string; recurrence_rule: string | null; recurrence_until: Date | null;
  recurrence_count: number | null; participant_user_ids: string[];
}
interface ProcedureSnapshot {
  id: string; title: string; currentStepId?: string;
  steps: { id: string; slaDueAt?: string; currentRoleStage?: string;
    assignments: { subjectType: string; subjectId: string; role: string }[];
    resolutions?: { resolvedTo: { subjectType: string; subjectId: string } }[] }[];
}

export class PostgresNotificationScheduleSource {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly timezone = 'Asia/Ho_Chi_Minh',
    /** Sơ đồ tổ chức của tenant, để giải bước giao cho đơn vị/chức danh thành người nhận SLA. */
    private readonly organization?: () => Promise<unknown>,
  ) {}
  async candidates(now: Date): Promise<readonly NotificationScheduleCandidate[]> {
    const tables = await this.pool.query<{
      workspace: boolean; calendar: boolean; procedure: boolean; maintenance: boolean; inventory: boolean;
    }>(`SELECT to_regclass('workspace_schema.work_items') IS NOT NULL AS workspace,
               to_regclass('workspace_schema.calendar_event_exceptions') IS NOT NULL AS calendar,
               to_regclass('procedure_schema.instances') IS NOT NULL AS procedure,
               to_regclass('maintenance_schema.occurrences') IS NOT NULL AS maintenance,
               to_regclass('inventory_schema.reservations') IS NOT NULL AS inventory`);
    const installed = tables.rows[0];
    const candidates: NotificationScheduleCandidate[] = [];
    const deadlines = (module: 'workspace' | 'maintenance', row: DeadlineRow, users: readonly string[]) => {
      for (const userId of [...new Set(users)]) {
        for (const kind of ['due-soon', 'overdue'] as const) {
          const subject = module === 'workspace' ? 'work-item' : 'occurrence';
          candidates.push({
            scheduleKey: `${module}:${subject}:${row.id}:${kind}`,
            eventType: `${module}.${subject}.${kind}`, aggregateType: `${module}-${subject}`,
            aggregateId: row.id, userId,
            scheduledFor: new Date(row.due_at.getTime() - (kind === 'due-soon' ? 24 * 60 * 60_000 : 0)).toISOString(),
            payload: { [module === 'workspace' ? 'workItemId' : 'occurrenceId']: row.id,
              title: row.title, ...(row.code ? { code: row.code } : {}), projectId: row.project_id,
              dueAt: row.due_at.toISOString(), assigneeUserId: userId },
          });
        }
      }
    };
    if (installed.workspace) {
      const rows = await this.pool.query<AssignedDeadlineRow>(
        `SELECT id, title, project_id, assignee_user_id,
                ((planned_end + 1)::timestamp AT TIME ZONE $2) AS due_at
           FROM workspace_schema.work_items
          WHERE status NOT IN ('done','cancelled') AND assignee_user_id IS NOT NULL
            AND planned_end BETWEEN ($1::timestamptz AT TIME ZONE $2)::date - 90
                                AND ($1::timestamptz AT TIME ZONE $2)::date + 1`, [now, this.timezone]);
      for (const row of rows.rows) deadlines('workspace', row, [row.assignee_user_id]);
    }
    if (installed.calendar) {
      const events = await this.pool.query<CalendarRow>(
        `SELECT event.*, ARRAY(SELECT participant.user_id::text
                   FROM workspace_schema.calendar_event_participants participant
                  WHERE participant.event_id = event.id AND response_status <> 'declined') AS participant_user_ids
           FROM workspace_schema.calendar_events event
          WHERE event.status = 'scheduled' AND event.start_at <= $1::timestamptz + interval '15 minutes'
            AND (event.end_at >= $1 OR event.recurrence_until >= $1 OR event.recurrence_count IS NOT NULL)`, [now]);
      const exceptions = await this.pool.query<{ series_id: string; occurrence_date: string }>(
        `SELECT series_id, occurrence_date::text FROM workspace_schema.calendar_event_exceptions
          WHERE occurrence_date BETWEEN $1::date - 2 AND $1::date + 2`, [now]);
      const excluded = new Set(exceptions.rows.map((row) => `${row.series_id}:${row.occurrence_date}`));
      for (const event of events.rows) {
        const occurrences = expandOccurrences({ startAt: event.start_at, endAt: event.end_at,
          timezone: event.timezone, rule: event.recurrence_rule ? parseRecurrenceRule(event.recurrence_rule, Boolean(event.recurrence_until || event.recurrence_count)) : undefined,
          until: event.recurrence_until, count: event.recurrence_count }, now, new Date(now.getTime() + 15 * 60_000));
        for (const occurrence of occurrences) {
          if (occurrence.startAt < now || excluded.has(`${event.series_id}:${occurrence.occurrenceDate}`)) continue;
          for (const userId of event.participant_user_ids) {
            candidates.push(calendarReminderSchedule({ eventId: event.id, projectId: event.project_id, userId, title: event.title,
              startAt: occurrence.startAt.toISOString(), timezone: event.timezone }));
          }
        }
      }
    }
    if (installed.procedure) {
      let organizationOnce: Promise<unknown> | undefined;
      const instances = await this.pool.query<{ snapshot: ProcedureSnapshot }>(
        `SELECT snapshot FROM procedure_schema.instances WHERE status = 'running'`);
      for (const { snapshot } of instances.rows) {
        const step = snapshot.steps.find((item) => item.id === snapshot.currentStepId);
        if (!step?.slaDueAt) continue;
        const current = step.assignments.filter((item) => !step.currentRoleStage || item.role === step.currentRoleStage);
        const orgAssignments = current.filter((item) => item.subjectType !== 'user' && item.role !== 'S');
        // Chỉ tải sơ đồ tổ chức khi có bước thật sự giao cho đơn vị/chức danh.
        let organizational: string[] = [];
        if (orgAssignments.length > 0 && this.organization) {
          try {
            organizational = resolveProcedureAssigneeUserIds(orgAssignments, await (organizationOnce ??= this.organization()));
          } catch {
            // Tenant Core chập chờn: bỏ qua người nhận theo đơn vị ở lần quét này, lần sau thử lại. Không được
            // làm hỏng nhắc hạn của các module khác; phát nhắc là idempotent theo khoá lịch. Lời hứa lỗi được giữ
            // trong lần quét này nên không gọi lại Tenant Core cho từng hồ sơ.
          }
        }
        const users = [...new Set([
          ...current.filter((item) => item.subjectType === 'user').map((item) => item.subjectId),
          ...(step.resolutions ?? []).filter((item) => item.resolvedTo.subjectType === 'user').map((item) => item.resolvedTo.subjectId),
          ...organizational,
        ])];
        candidates.push(...procedureSlaSchedules({ instanceId: snapshot.id, stepInstanceId: step.id,
          title: snapshot.title, dueAt: step.slaDueAt, recipientUserIds: users }));
      }
    }
    if (installed.maintenance) {
      const occurrences = await this.pool.query<DeadlineRow>(
        `SELECT occurrence.id, occurrence.code, COALESCE(occurrence.title, schedule.title, 'Bảo trì') AS title,
                occurrence.due_at, occurrence.assignee_id, occurrence.created_by
           FROM maintenance_schema.occurrences occurrence
           LEFT JOIN maintenance_schema.schedules schedule ON schedule.id = occurrence.schedule_id
          WHERE occurrence.status NOT IN ('completed','failed','blocked')
            AND occurrence.due_at BETWEEN $1::timestamptz - interval '90 days' AND $1::timestamptz + interval '1 day'`, [now]);
      for (const row of occurrences.rows) deadlines('maintenance', row, [row.assignee_id, row.created_by].filter((id): id is string => Boolean(id)));
    }
    if (installed.inventory) {
      const reservations = await this.pool.query<{ id: string; reservation_code: string; expires_at: Date; created_by: string }>(
        `SELECT id, reservation_code, expires_at, created_by FROM inventory_schema.reservations
          WHERE status IN ('PENDING','RESERVED','PARTIALLY_ISSUED')
            AND expires_at BETWEEN $1::timestamptz AND $1::timestamptz + interval '1 day'`, [now]);
      for (const row of reservations.rows) candidates.push({
        scheduleKey: `inventory:reservation:${row.id}:expiring`, eventType: 'inventory.reservation.expiring',
        aggregateType: 'inventory-reservation', aggregateId: row.id, userId: row.created_by,
        scheduledFor: new Date(row.expires_at.getTime() - 24 * 60 * 60_000).toISOString(),
        payload: { sourceId: row.id, sourceType: 'inventory_reservation', summary: `Giữ chỗ ${row.reservation_code} sắp hết hạn.` },
      });
    }
    return candidates;
  }
}
