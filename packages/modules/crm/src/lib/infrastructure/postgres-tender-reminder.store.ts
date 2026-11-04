import {
  CRM_TENDER_DEADLINE_DUE_SOON,
  CRM_TENDER_DEADLINE_OVERDUE,
  TENDER_DEADLINE_REMINDER_HOURS,
  tenderDeepLink,
  type CrmTenderDeadlinePayload,
} from '@enterprise-platform/contracts-crm';
import type { TenderReminderStore } from '../application/tender-reminder-store.port.js';
import type { CrmSqlClient } from './audit-log.js';
import { writeCrmOutbox } from './crm-outbox.js';
import type { CrmDatabase } from './crm.database.js';

interface DueRow {
  id: string;
  opportunity_id: string;
  package_name: string;
  inviter_name: string;
  deadline: string;
  owner_user_id: string;
  submitter_user_id: string | null;
  deadline_text: string;
}

const MILESTONES = [
  { type: CRM_TENDER_DEADLINE_DUE_SOON, milestone: 'DUE_SOON', column: 'deadline_soon_notified_for', window: 'p.submission_deadline > $1::timestamptz AND p.submission_deadline <= $1::timestamptz + make_interval(hours => $3::int)' },
  { type: CRM_TENDER_DEADLINE_OVERDUE, milestone: 'OVERDUE', column: 'deadline_overdue_notified_for', window: 'p.submission_deadline <= $1::timestamptz AND $3::int > 0' },
] as const;

/**
 * Nhắc hạn nộp thầu. Chỉ hồ sơ chưa nộp, chưa có kết quả, của cơ hội còn mở. Cột `*_notified_for` giữ hạn đã nhắc
 * nên dời hạn thì nhắc lại; `FOR UPDATE SKIP LOCKED` để nhiều worker không nhắc đôi.
 */
export class PostgresTenderReminderStore implements TenderReminderStore {
  constructor(private readonly database: CrmDatabase) {}

  notifyDeadlines(tenantId: string, now: Date, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      let total = 0;
      for (const step of MILESTONES) total += await this.notify(client, tenantId, now, limit, step);
      return total;
    });
  }

  private async notify(client: CrmSqlClient, tenantId: string, now: Date, limit: number, step: (typeof MILESTONES)[number]): Promise<number> {
    const due = await client.query<DueRow>(
      `SELECT p.id, p.opportunity_id, p.package_name, p.inviter_name, p.submission_deadline::text AS deadline,
              to_char(p.submission_deadline AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') AS deadline_text,
              o.owner_user_id, p.submitter_user_id
         FROM crm_schema.tender_profiles p
         JOIN crm_schema.opportunities o ON o.id = p.opportunity_id
         JOIN crm_schema.pipeline_stages ps ON ps.id = o.stage_id
        WHERE p.submission_deadline IS NOT NULL AND p.submitted_at IS NULL AND p.result IS NULL
          AND ps.semantic = 'OPEN'
          AND ${step.window}
          AND p.${step.column} IS DISTINCT FROM p.submission_deadline
        ORDER BY p.submission_deadline, p.id
        LIMIT $2
        FOR UPDATE OF p SKIP LOCKED`,
      [now.toISOString(), limit, TENDER_DEADLINE_REMINDER_HOURS],
    );
    for (const row of due.rows) {
      await client.query(`UPDATE crm_schema.tender_profiles SET ${step.column} = submission_deadline WHERE id = $1`, [row.id]);
      const recipients = [...new Set([row.owner_user_id, row.submitter_user_id].filter((id): id is string => !!id))];
      const payload: CrmTenderDeadlinePayload = {
        opportunityId: row.opportunity_id,
        profileId: row.id,
        packageName: row.package_name,
        inviterName: row.inviter_name,
        submissionDeadline: new Date(row.deadline).toISOString(),
        milestone: step.milestone,
        ownerUserId: row.owner_user_id,
        submitterUserId: row.submitter_user_id,
        actorUserId: null,
        recipientUserIds: recipients,
        summary:
          step.milestone === 'OVERDUE'
            ? `Gói thầu "${row.package_name}" (${row.inviter_name}) đã quá hạn nộp ${row.deadline_text} mà chưa nộp.`
            : `Gói thầu "${row.package_name}" (${row.inviter_name}) sắp đến hạn nộp lúc ${row.deadline_text}.`,
        deepLink: tenderDeepLink(row.opportunity_id),
      };
      await writeCrmOutbox(client, tenantId, { type: step.type, aggregateType: 'crm-tender', aggregateId: row.id, payload });
    }
    return due.rows.length;
  }
}
