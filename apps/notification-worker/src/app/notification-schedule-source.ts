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
type DeadlineModule = 'workspace' | 'maintenance' | 'crm';
/** Đối tượng có hạn của từng phân hệ: phần giữa của loại sự kiện và tên trường id trong payload. */
const DEADLINE_SUBJECTS: Readonly<Record<DeadlineModule, { subject: string; idField: string }>> = {
  workspace: { subject: 'work-item', idField: 'workItemId' },
  maintenance: { subject: 'occurrence', idField: 'occurrenceId' },
  crm: { subject: 'activity', idField: 'activityId' },
};
/** Nhắc trước hạn mặc định của Công việc và Bảo trì. */
const DEFAULT_DUE_SOON_MINUTES = 24 * 60;
/** Nhắc hoạt động Bán hàng trước hạn mặc định, khi `crm_schema.settings` chưa có khoá `activity.reminder`. */
export const CRM_ACTIVITY_REMINDER_DEFAULT_MINUTES = 30;
interface CrmActivityRow {
  id: string; subject: string; due_at: Date; assignee_user_id: string;
  customer_id: string | null; opportunity_id: string | null;
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
      workspace: boolean; calendar: boolean; procedure: boolean; maintenance: boolean; inventory: boolean; crm: boolean;
    }>(`SELECT to_regclass('workspace_schema.work_items') IS NOT NULL AS workspace,
               to_regclass('workspace_schema.calendar_event_exceptions') IS NOT NULL AS calendar,
               to_regclass('procedure_schema.instances') IS NOT NULL AS procedure,
               to_regclass('maintenance_schema.occurrences') IS NOT NULL AS maintenance,
               to_regclass('inventory_schema.reservations') IS NOT NULL AS inventory,
               to_regclass('crm_schema.activities') IS NOT NULL AS crm`);
    const installed = tables.rows[0];
    const candidates: NotificationScheduleCandidate[] = [];
    /**
     * Hai lời nhắc cho một đối tượng có hạn: trước hạn `dueSoonMinutes` phút và đúng lúc hạn. Lịch được khử trùng
     * theo (khoá, người, thời điểm) nên dời hạn sinh lời nhắc mới theo hạn mới, lời nhắc cũ không gửi lại.
     */
    const deadlines = (
      module: DeadlineModule, row: DeadlineRow, users: readonly string[],
      dueSoonMinutes = DEFAULT_DUE_SOON_MINUTES, extra: Readonly<Record<string, unknown>> = { projectId: row.project_id },
    ) => {
      const { subject, idField } = DEADLINE_SUBJECTS[module];
      for (const userId of [...new Set(users)]) {
        for (const kind of ['due-soon', 'overdue'] as const) {
          candidates.push({
            scheduleKey: `${module}:${subject}:${row.id}:${kind}`,
            eventType: `${module}.${subject}.${kind}`, aggregateType: `${module}-${subject}`,
            aggregateId: row.id, userId,
            scheduledFor: new Date(row.due_at.getTime() - (kind === 'due-soon' ? dueSoonMinutes * 60_000 : 0)).toISOString(),
            payload: { [idField]: row.id,
              title: row.title, ...(row.code ? { code: row.code } : {}), ...extra,
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
    if (installed.crm) {
      // Cấu hình nhắc trước hạn của tenant (`crm_schema.settings`, khoá `activity.reminder`); thiếu hay hỏng thì 30 phút.
      const setting = await this.pool.query<{ value: unknown }>(
        `SELECT value FROM crm_schema.settings WHERE key = 'activity.reminder'`);
      const leadMinutes = crmReminderMinutes(setting.rows[0]?.value);
      const activities = await this.pool.query<CrmActivityRow>(
        `SELECT id, subject, due_at, assignee_user_id, customer_id, opportunity_id
           FROM crm_schema.activities
          WHERE status = 'OPEN' AND due_at IS NOT NULL
            AND due_at BETWEEN $1::timestamptz - interval '90 days'
                           AND $1::timestamptz + make_interval(mins => $2::int)`, [now, leadMinutes]);
      for (const row of activities.rows) {
        deadlines('crm', { id: row.id, title: row.subject, due_at: row.due_at }, [row.assignee_user_id], leadMinutes, {
          ...(row.customer_id ? { customerId: row.customer_id } : {}),
          ...(row.opportunity_id ? { opportunityId: row.opportunity_id } : {}),
        });
      }
    }
    return candidates;
  }
}

/** Số phút nhắc trước hạn từ giá trị cấu hình `{ leadMinutes }`; không hợp lệ thì mặc định. */
export function crmReminderMinutes(value: unknown): number {
  const minutes = Number((value as { leadMinutes?: unknown } | null | undefined)?.leadMinutes);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 7 * 24 * 60 ? minutes : CRM_ACTIVITY_REMINDER_DEFAULT_MINUTES;
}
