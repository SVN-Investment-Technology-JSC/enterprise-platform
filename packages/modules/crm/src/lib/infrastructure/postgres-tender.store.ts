import { randomUUID } from 'node:crypto';
import {
  CRM_TENDER_PLAN_APPROVAL_DECIDED,
  CRM_TENDER_PLAN_APPROVAL_REQUESTED,
  tenderDeepLink,
  type CrmTenderPlanApprovalDecidedPayload,
  type CrmTenderPlanApprovalRequestedPayload,
  type TenderPartner,
  type TenderPlanRound,
  type TenderPlanStatus,
  type TenderRequiredField,
  type TenderResult,
  type TenderSubmissionMethod,
} from '@enterprise-platform/contracts-crm';
import type { StageChangeTransaction } from '../application/sales-store.port.js';
import type {
  DecideTenderPlanInput,
  SubmitTenderPlanInput,
  TenderProfileRecord,
  TenderRoundLink,
  TenderStore,
  WriteTenderResultInput,
} from '../application/tender-store.port.js';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import type { TenderProfileFields, TenderProfilePatch } from '../domain/tender.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import type { ProcedureCompletedPayload } from './quote-procedure-links.js';
import { constraintViolation, toIso, toNumber } from './sql-helpers.js';

/** Loại thực thể trong `audit_log` của hồ sơ thầu. */
export const TENDER_AUDIT_ENTITY = 'crm_tender_profile';
/** Nguồn của phiên Quy trình duyệt phương án chào thầu (`procedure_links.source_type`). */
export const CRM_TENDER_PLAN_SOURCE_TYPE = 'crm_tender_plan';

const stale = () =>
  new CrmConflictError('STALE_VERSION', 'Hồ sơ thầu vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

interface ProfileRow {
  id: string;
  opportunity_id: string;
  package_name: string;
  inviter_name: string;
  package_code: string | null;
  submission_deadline: Date | null;
  submission_method: TenderSubmissionMethod | null;
  submitter_user_id: string | null;
  submitted_at: Date | null;
  has_joint_venture: boolean;
  scenario: string | null;
  plan_status: TenderPlanStatus;
  plan_round_no: number;
  plan_submitted_at: Date | null;
  plan_submitted_by: string | null;
  plan_decided_at: Date | null;
  plan_decided_by: string | null;
  plan_decision_reason: string | null;
  result: TenderResult | null;
  winning_price: string | null;
  winner_name: string | null;
  lost_reason: string | null;
  result_recorded_at: Date | null;
  result_recorded_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface RoundRow {
  id: string;
  round_no: number;
  via: 'DIRECT' | 'PROCEDURE';
  has_joint_venture: boolean;
  scenario: string | null;
  partner_count: number;
  submitted_at: Date;
  submitted_by: string;
  decided_at: Date | null;
  decided_by: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  reason: string | null;
  instance_code: string | null;
}

/** Cột của hồ sơ thầu theo khoá của `TenderProfilePatch` (khoá lạ không bao giờ vào câu SQL). */
const PATCH_COLUMNS: Readonly<Record<keyof TenderProfilePatch, string>> = {
  packageName: 'package_name',
  inviterName: 'inviter_name',
  packageCode: 'package_code',
  submissionDeadline: 'submission_deadline',
  submissionMethod: 'submission_method',
  submitterUserId: 'submitter_user_id',
  hasJointVenture: 'has_joint_venture',
  scenario: 'scenario',
  submittedAt: 'submitted_at',
};

/**
 * Hồ sơ thầu (GĐ E) trong `crm_schema.tender_profiles`, `tender_partners`, `tender_plan_rounds`. Mọi thay đổi
 * ghi `audit_log` (entity `crm_tender_profile`) cùng transaction; mọi lần sửa tăng `version` (khoá lạc quan).
 */
export class PostgresTenderStore implements TenderStore {
  constructor(private readonly database: CrmDatabase) {}

  async findByOpportunity(tenantId: string, opportunityId: string): Promise<TenderProfileRecord | undefined> {
    const pool = await this.database.pool(tenantId);
    const profile = (
      await pool.query<ProfileRow>(`SELECT * FROM crm_schema.tender_profiles WHERE opportunity_id = $1::uuid`, [opportunityId])
    ).rows[0];
    if (!profile) return undefined;
    const [partners, rounds] = await Promise.all([
      pool.query<{ id: string; name: string; scope: string | null }>(
        `SELECT id, name, scope FROM crm_schema.tender_partners WHERE profile_id = $1 ORDER BY sort_order, created_at, id`,
        [profile.id],
      ),
      pool.query<RoundRow>(
        `SELECT r.id, r.round_no, r.via, r.has_joint_venture, r.scenario, r.partner_count, r.submitted_at, r.submitted_by,
                r.decided_at, r.decided_by, r.decision, r.reason, l.instance_code
           FROM crm_schema.tender_plan_rounds r
           LEFT JOIN crm_schema.procedure_links l ON l.source_type = $2 AND l.source_id = r.id
          WHERE r.profile_id = $1
          ORDER BY r.round_no`,
        [profile.id, CRM_TENDER_PLAN_SOURCE_TYPE],
      ),
    ]);
    return toRecord(
      profile,
      partners.rows.map((row): TenderPartner => ({ id: row.id, name: row.name, scope: row.scope })),
      rounds.rows.map(toRound),
    );
  }

  create(tenantId: string, opportunityId: string, fields: TenderProfileFields, actorId: string): Promise<string> {
    return this.database
      .transaction(tenantId, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.tender_profiles
             (opportunity_id, package_name, inviter_name, package_code, submission_deadline, submission_method,
              submitter_user_id, has_joint_venture, scenario, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING id`,
          [
            opportunityId,
            fields.packageName,
            fields.inviterName,
            fields.packageCode,
            fields.submissionDeadline,
            fields.submissionMethod,
            fields.submitterUserId,
            fields.hasJointVenture,
            fields.scenario,
            actorId,
          ],
        );
        const id = inserted.rows[0].id;
        await writeAuditLog(client, {
          entityType: TENDER_AUDIT_ENTITY,
          entityId: id,
          toStatus: 'DRAFT',
          action: 'create',
          actorId,
          metadata: { opportunityId, packageName: fields.packageName },
        });
        return id;
      })
      .catch((error: unknown) => {
        if (constraintViolation(error, '23505', 'uq_crm_tender_profiles_opportunity')) {
          throw new CrmConflictError('TENDER_PROFILE_EXISTS', 'Cơ hội này đã có hồ sơ thầu (mỗi cơ hội chỉ có một hồ sơ).');
        }
        throw error;
      });
  }

  update(
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    patch: TenderProfilePatch,
    actorId: string,
    resetApproval: boolean,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [profileId, expectedVersion, actorId];
      for (const key of Object.keys(patch) as (keyof TenderProfilePatch)[]) {
        const column = PATCH_COLUMNS[key];
        if (!column || patch[key] === undefined) continue;
        values.push(patch[key]);
        sets.push(`${column} = $${values.length}`);
      }
      const row = await touchProfile(client, profileId, expectedVersion, actorId, resetApproval, sets, values);
      await writeAuditLog(client, {
        entityType: TENDER_AUDIT_ENTITY,
        entityId: profileId,
        fromStatus: row.previous_status,
        toStatus: row.plan_status,
        action: resetApproval ? 'update-reset-approval' : 'update',
        actorId,
        metadata: { fields: Object.keys(patch) },
      });
    });
  }

  addPartner(
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    partner: { readonly name: string; readonly scope: string | null },
    actorId: string,
    resetApproval: boolean,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const row = await touchProfile(client, profileId, expectedVersion, actorId, resetApproval);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.tender_partners (profile_id, name, scope, sort_order, created_by, updated_by)
         VALUES ($1, $2, $3, COALESCE((SELECT max(sort_order) + 1 FROM crm_schema.tender_partners WHERE profile_id = $1), 0), $4, $4)
         RETURNING id`,
        [profileId, partner.name, partner.scope, actorId],
      );
      await writeAuditLog(client, {
        entityType: TENDER_AUDIT_ENTITY,
        entityId: profileId,
        fromStatus: row.previous_status,
        toStatus: row.plan_status,
        action: 'partner-add',
        actorId,
        metadata: { partnerId: inserted.rows[0].id, name: partner.name },
      });
    });
  }

  updatePartner(
    tenantId: string,
    profileId: string,
    partnerId: string,
    expectedVersion: number,
    partner: { readonly name: string; readonly scope: string | null },
    actorId: string,
    resetApproval: boolean,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const row = await touchProfile(client, profileId, expectedVersion, actorId, resetApproval);
      const updated = await client.query(
        `UPDATE crm_schema.tender_partners SET name = $3, scope = $4, updated_at = now(), updated_by = $5
          WHERE id = $2 AND profile_id = $1`,
        [profileId, partnerId, partner.name, partner.scope, actorId],
      );
      if (!updated.rowCount) throw new CrmNotFoundError('Không tìm thấy đối tác liên danh.');
      await writeAuditLog(client, {
        entityType: TENDER_AUDIT_ENTITY,
        entityId: profileId,
        fromStatus: row.previous_status,
        toStatus: row.plan_status,
        action: 'partner-update',
        actorId,
        metadata: { partnerId, name: partner.name },
      });
    });
  }

  removePartner(
    tenantId: string,
    profileId: string,
    partnerId: string,
    expectedVersion: number,
    actorId: string,
    resetApproval: boolean,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const row = await touchProfile(client, profileId, expectedVersion, actorId, resetApproval);
      const removed = await client.query<{ name: string }>(
        `DELETE FROM crm_schema.tender_partners WHERE id = $2 AND profile_id = $1 RETURNING name`,
        [profileId, partnerId],
      );
      if (!removed.rows[0]) throw new CrmNotFoundError('Không tìm thấy đối tác liên danh.');
      await writeAuditLog(client, {
        entityType: TENDER_AUDIT_ENTITY,
        entityId: profileId,
        fromStatus: row.previous_status,
        toStatus: row.plan_status,
        action: 'partner-remove',
        actorId,
        metadata: { partnerId, name: removed.rows[0].name },
      });
    });
  }

  submitPlan(tenantId: string, input: SubmitTenderPlanInput): Promise<{ linkId: string | null }> {
    return this.database.transaction(tenantId, async (client) => {
      const profile = await lockProfile(client, input.profileId);
      if (profile.version !== input.expectedVersion) throw stale();
      if (profile.plan_status === 'PENDING' || profile.plan_status === 'APPROVED') {
        throw new CrmConflictError('PLAN_NOT_SUBMITTABLE', 'Phương án chào thầu đang chờ duyệt hoặc đã được duyệt.');
      }
      const partnerCount = Number(
        (await client.query<{ n: string }>(`SELECT count(*) AS n FROM crm_schema.tender_partners WHERE profile_id = $1`, [profile.id])).rows[0].n,
      );
      const roundNo = profile.plan_round_no + 1;
      const via = input.procedure ? 'PROCEDURE' : 'DIRECT';
      const round = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.tender_plan_rounds
           (profile_id, round_no, via, has_joint_venture, scenario, partner_count, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [profile.id, roundNo, via, profile.has_joint_venture, profile.scenario, partnerCount, input.actorId],
      );
      await client.query(
        `UPDATE crm_schema.tender_profiles
            SET plan_status = 'PENDING', plan_round_no = $2, plan_submitted_at = now(), plan_submitted_by = $3,
                plan_decided_at = NULL, plan_decided_by = NULL, plan_decision_reason = NULL,
                version = version + 1, updated_at = now(), updated_by = $3
          WHERE id = $1`,
        [profile.id, roundNo, input.actorId],
      );
      let linkId: string | null = null;
      if (input.procedure) {
        linkId = randomUUID();
        await client.query(
          `INSERT INTO crm_schema.procedure_links (id, source_type, source_id, definition_id, title, initiated_by, start_idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [linkId, CRM_TENDER_PLAN_SOURCE_TYPE, round.rows[0].id, input.procedure.definitionId, input.procedure.title, input.actorId, `crm:${linkId}`],
        );
      }
      await writeAuditLog(client, {
        entityType: TENDER_AUDIT_ENTITY,
        entityId: profile.id,
        fromStatus: profile.plan_status,
        toStatus: 'PENDING',
        action: 'plan-submit',
        actorId: input.actorId,
        metadata: { roundNo, via, hasJointVenture: profile.has_joint_venture, partnerCount, procedureLinkId: linkId },
      });
      const payload: CrmTenderPlanApprovalRequestedPayload = {
        opportunityId: profile.opportunity_id,
        profileId: profile.id,
        packageName: profile.package_name,
        roundNo,
        hasJointVenture: profile.has_joint_venture,
        requesterUserId: input.actorId,
        actorUserId: input.actorId,
        recipientUserIds: input.recipientUserIds,
        mode: via,
        summary: `Phương án chào thầu "${profile.package_name}" cần duyệt (vòng ${roundNo}).`.slice(0, 500),
        deepLink: tenderDeepLink(profile.opportunity_id),
      };
      await writeCrmOutbox(client, tenantId, {
        type: CRM_TENDER_PLAN_APPROVAL_REQUESTED,
        aggregateType: 'crm-tender',
        aggregateId: profile.id,
        payload,
      });
      return { linkId };
    });
  }

  decidePlan(tenantId: string, input: DecideTenderPlanInput): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const outcome = await applyPlanDecision(client, tenantId, {
        profileId: input.profileId,
        expectedVersion: input.expectedVersion,
        decision: input.decision,
        reason: input.reason,
        actorId: input.actorId,
        action: input.decision === 'APPROVED' ? 'plan-approve' : 'plan-reject',
      });
      if (outcome === 'ignored') throw new CrmConflictError('PLAN_NOT_PENDING', 'Phương án chào thầu không ở trạng thái chờ duyệt.');
      // Duyệt tay khi phiên Quy trình không tạo được: đóng liên kết để worker không thử lại.
      await client.query(
        `UPDATE crm_schema.procedure_links SET status = 'CLOSED', lease_until = NULL, updated_at = now()
          WHERE source_type = $1 AND source_id IN (SELECT id FROM crm_schema.tender_plan_rounds WHERE profile_id = $2)
            AND status IN ('START_PENDING', 'FAILED')`,
        [CRM_TENDER_PLAN_SOURCE_TYPE, input.profileId],
      );
    });
  }

  async currentRoundLink(tenantId: string, profileId: string): Promise<TenderRoundLink | undefined> {
    const pool = await this.database.pool(tenantId);
    const row = (
      await pool.query<{ status: string; instance_id: string | null }>(
        `SELECT l.status, l.instance_id
           FROM crm_schema.tender_profiles p
           JOIN crm_schema.tender_plan_rounds r ON r.profile_id = p.id AND r.round_no = p.plan_round_no
           JOIN crm_schema.procedure_links l ON l.source_type = $2 AND l.source_id = r.id
          WHERE p.id = $1`,
        [profileId, CRM_TENDER_PLAN_SOURCE_TYPE],
      )
    ).rows[0];
    return row ? { status: row.status, instanceId: row.instance_id } : undefined;
  }

  async writeResult(client: StageChangeTransaction, _tenantId: string, input: WriteTenderResultInput): Promise<void> {
    const sql = client as unknown as CrmSqlClient;
    const row = (
      await sql.query<{ opportunity_id: string }>(
        `UPDATE crm_schema.tender_profiles
            SET result = $3, winning_price = $4, winner_name = $5, lost_reason = $6,
                result_recorded_at = now(), result_recorded_by = $7, version = version + 1,
                updated_at = now(), updated_by = $7
          WHERE id = $1 AND version = $2
          RETURNING opportunity_id`,
        [input.profileId, input.expectedVersion, input.result, input.winningPrice, input.winnerName, input.lostReason, input.actorId],
      )
    ).rows[0];
    if (!row) throw stale();
    if (input.result === 'WON' && input.winningPrice !== null) {
      // Giá trị cơ hội đã thắng là giá trúng thầu (báo cáo, dashboard tính theo giá trị cơ hội).
      await sql.query(`UPDATE crm_schema.opportunities SET expected_value = $2 WHERE id = $1`, [row.opportunity_id, input.winningPrice]);
    }
    await writeAuditLog(sql, {
      entityType: TENDER_AUDIT_ENTITY,
      entityId: input.profileId,
      toStatus: input.result,
      action: 'record-result',
      actorId: input.actorId,
      reason: input.lostReason,
      metadata: { opportunityId: row.opportunity_id, winningPrice: input.winningPrice, winnerName: input.winnerName },
    });
  }

  async requirementState(
    tenantId: string,
    opportunityId: string,
  ): Promise<{ readonly planApproved: boolean; readonly fields: Readonly<Partial<Record<TenderRequiredField, unknown>>> } | null> {
    const pool = await this.database.pool(tenantId);
    const row = (
      await pool.query<ProfileRow>(`SELECT * FROM crm_schema.tender_profiles WHERE opportunity_id = $1::uuid`, [opportunityId])
    ).rows[0];
    if (!row) return null;
    return {
      planApproved: row.plan_status === 'APPROVED',
      fields: {
        packageName: row.package_name,
        inviterName: row.inviter_name,
        packageCode: row.package_code,
        submissionDeadline: row.submission_deadline,
        submissionMethod: row.submission_method,
        submitterUserId: row.submitter_user_id,
        scenario: row.scenario,
        winningPrice: row.winning_price === null ? null : Number(row.winning_price),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Dùng chung
// ---------------------------------------------------------------------------

async function lockProfile(client: CrmSqlClient, profileId: string): Promise<ProfileRow> {
  const row = (
    await client.query<ProfileRow>(`SELECT * FROM crm_schema.tender_profiles WHERE id = $1 FOR UPDATE`, [profileId])
  ).rows[0];
  if (!row) throw new CrmNotFoundError('Không tìm thấy hồ sơ thầu.');
  return row;
}

/**
 * Tăng `version` (và đưa phương án về Đang soạn khi `resetApproval`) nếu `version` khớp; có thể kèm các cột sửa
 * (`sets` đánh số tham số từ `$4`, `values` = [id, version, actor, ...]). Trả trạng thái phương án trước và sau.
 */
async function touchProfile(
  client: CrmSqlClient,
  profileId: string,
  expectedVersion: number,
  actorId: string,
  resetApproval: boolean,
  sets: string[] = [],
  values: unknown[] = [profileId, expectedVersion, actorId],
): Promise<{ previous_status: TenderPlanStatus; plan_status: TenderPlanStatus }> {
  const assignments = [
    ...sets,
    ...(resetApproval ? [`plan_status = 'DRAFT'`, `plan_decided_at = NULL`, `plan_decided_by = NULL`, `plan_decision_reason = NULL`] : []),
    'version = version + 1',
    'updated_at = now()',
    'updated_by = $3',
  ];
  const row = (
    await client.query<{ previous_status: TenderPlanStatus; plan_status: TenderPlanStatus }>(
      `UPDATE crm_schema.tender_profiles p SET ${assignments.join(', ')}
         FROM (SELECT id, plan_status AS previous_status FROM crm_schema.tender_profiles WHERE id = $1 FOR UPDATE) old
        WHERE p.id = old.id AND p.version = $2
        RETURNING old.previous_status, p.plan_status`,
      values,
    )
  ).rows[0];
  if (!row) throw stale();
  return row;
}

interface PlanDecision {
  readonly profileId: string;
  /** Rỗng (kết quả từ Quy trình): không so phiên bản mà so vòng. */
  readonly expectedVersion: number | null;
  readonly expectedRoundId?: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string | null;
  readonly actorId: string | null;
  readonly action: string;
}

/** Ghi quyết định cho vòng duyệt hiện tại (trong transaction của bên gọi); không còn chờ duyệt thì bỏ qua. */
async function applyPlanDecision(client: CrmSqlClient, tenantId: string, decision: PlanDecision): Promise<'applied' | 'ignored'> {
  const profile = await lockProfile(client, decision.profileId);
  if (decision.expectedVersion !== null && profile.version !== decision.expectedVersion) throw stale();
  if (profile.plan_status !== 'PENDING') return 'ignored';
  const round = (
    await client.query<{ id: string; round_no: number; decision: string | null; submitted_by: string }>(
      `SELECT id, round_no, decision, submitted_by FROM crm_schema.tender_plan_rounds
        WHERE profile_id = $1 AND round_no = $2 FOR UPDATE`,
      [profile.id, profile.plan_round_no],
    )
  ).rows[0];
  if (!round || round.decision !== null) return 'ignored';
  if (decision.expectedRoundId && decision.expectedRoundId !== round.id) return 'ignored';
  await client.query(
    `UPDATE crm_schema.tender_plan_rounds SET decision = $2, decided_at = now(), decided_by = $3, reason = $4 WHERE id = $1`,
    [round.id, decision.decision, decision.actorId, decision.reason],
  );
  await client.query(
    `UPDATE crm_schema.tender_profiles
        SET plan_status = $2, plan_decided_at = now(), plan_decided_by = $3, plan_decision_reason = $4,
            version = version + 1, updated_at = now(), updated_by = COALESCE($3, updated_by)
      WHERE id = $1`,
    [profile.id, decision.decision, decision.actorId, decision.reason],
  );
  await writeAuditLog(client, {
    entityType: TENDER_AUDIT_ENTITY,
    entityId: profile.id,
    fromStatus: 'PENDING',
    toStatus: decision.decision,
    action: decision.action,
    actorId: decision.actorId,
    reason: decision.reason,
    metadata: { roundNo: round.round_no },
  });
  const verb = decision.decision === 'APPROVED' ? 'đã được duyệt' : 'bị trả về sửa';
  const payload: CrmTenderPlanApprovalDecidedPayload = {
    opportunityId: profile.opportunity_id,
    profileId: profile.id,
    packageName: profile.package_name,
    roundNo: round.round_no,
    status: decision.decision,
    reason: decision.reason,
    actorUserId: decision.actorId,
    recipientUserIds: [round.submitted_by].filter((userId) => userId !== decision.actorId),
    summary: `Phương án chào thầu "${profile.package_name}" ${verb}${decision.reason ? `: ${decision.reason}` : '.'}`.slice(0, 500),
    deepLink: tenderDeepLink(profile.opportunity_id),
  };
  await writeCrmOutbox(client, tenantId, {
    type: CRM_TENDER_PLAN_APPROVAL_DECIDED,
    aggregateType: 'crm-tender',
    aggregateId: profile.id,
    payload,
  });
  return 'applied';
}

/**
 * Áp kết quả `procedure.instance.completed` (sourceType `crm_tender_plan`): hoàn tất thì phương án Đã duyệt; từ
 * chối hoặc huỷ thì trả về sửa kèm lý do. Nhận trùng hoặc đến muộn (liên kết đã áp, đã đóng; vòng không còn chờ
 * duyệt; phiên khác) thì bỏ qua.
 */
export async function applyTenderPlanProcedureResult(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureCompletedPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_TENDER_PLAN_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const status = payload.status;
  if (status !== 'completed' && status !== 'rejected' && status !== 'cancelled') return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const link = (
      await client.query<{ source_id: string; status: string; instance_id: string | null; instance_code: string | null }>(
        `SELECT source_id, status, instance_id, instance_code FROM crm_schema.procedure_links
          WHERE id = $1 AND source_type = $2 FOR UPDATE`,
        [linkId, CRM_TENDER_PLAN_SOURCE_TYPE],
      )
    ).rows[0];
    if (!link || link.status === 'APPLIED' || link.status === 'CLOSED') return 'ignored';
    if (link.instance_id && payload.instanceId && link.instance_id !== payload.instanceId) return 'ignored';
    const approve = status === 'completed';
    const code = payload.instanceCode ?? link.instance_code;
    const reason = approve
      ? `Theo quy trình ${code ?? ''}`.trim()
      : (payload.reason?.trim() || payload.comment?.trim() || (status === 'rejected' ? 'Quy trình từ chối duyệt.' : 'Hồ sơ Quy trình đã bị huỷ.')).slice(0, 2000);
    await client.query(
      `UPDATE crm_schema.procedure_links
          SET result = $2, result_reason = $3, instance_id = COALESCE(instance_id, $4::uuid),
              instance_code = COALESCE(instance_code, $5), lease_until = NULL, lease_token = NULL, last_error = NULL, updated_at = now()
        WHERE id = $1`,
      [linkId, status, approve ? null : reason, isUuid(payload.instanceId) ? payload.instanceId : null, payload.instanceCode ?? null],
    );
    const round = (
      await client.query<{ profile_id: string }>(`SELECT profile_id FROM crm_schema.tender_plan_rounds WHERE id = $1`, [link.source_id])
    ).rows[0];
    if (!round) {
      await client.query(`UPDATE crm_schema.procedure_links SET status = 'CLOSED', updated_at = now() WHERE id = $1`, [linkId]);
      return 'ignored';
    }
    const outcome = await applyPlanDecision(client, tenantId, {
      profileId: round.profile_id,
      expectedVersion: null,
      expectedRoundId: link.source_id,
      decision: approve ? 'APPROVED' : 'REJECTED',
      reason,
      actorId: isUuid(payload.actorId) ? payload.actorId : null,
      action: approve ? 'plan-approve-procedure' : 'plan-reject-procedure',
    });
    await client.query(`UPDATE crm_schema.procedure_links SET status = $2, updated_at = now() WHERE id = $1`, [
      linkId,
      outcome === 'applied' ? 'APPLIED' : 'CLOSED',
    ]);
    return outcome;
  });
}

function toRound(row: RoundRow): TenderPlanRound {
  return {
    id: row.id,
    roundNo: row.round_no,
    via: row.via,
    hasJointVenture: row.has_joint_venture,
    scenario: row.scenario,
    partnerCount: row.partner_count,
    submittedAt: toIso(row.submitted_at) ?? '',
    submittedBy: row.submitted_by,
    decidedAt: toIso(row.decided_at),
    decidedBy: row.decided_by,
    decision: row.decision,
    reason: row.reason,
    procedureInstanceCode: row.instance_code,
  };
}

function toRecord(row: ProfileRow, partners: readonly TenderPartner[], rounds: readonly TenderPlanRound[]): TenderProfileRecord {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    packageName: row.package_name,
    inviterName: row.inviter_name,
    packageCode: row.package_code,
    submissionDeadline: toIso(row.submission_deadline),
    submissionMethod: row.submission_method,
    submitterUserId: row.submitter_user_id,
    submittedAt: toIso(row.submitted_at),
    hasJointVenture: row.has_joint_venture,
    scenario: row.scenario,
    planStatus: row.plan_status,
    planRoundNo: row.plan_round_no,
    planSubmittedAt: toIso(row.plan_submitted_at),
    planSubmittedBy: row.plan_submitted_by,
    planDecidedAt: toIso(row.plan_decided_at),
    planDecidedBy: row.plan_decided_by,
    planDecisionReason: row.plan_decision_reason,
    result: row.result,
    winningPrice: toNumber(row.winning_price),
    winnerName: row.winner_name,
    lostReason: row.lost_reason,
    resultRecordedAt: toIso(row.result_recorded_at),
    resultRecordedBy: row.result_recorded_by,
    version: row.version,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
    partners,
    rounds,
  };
}
