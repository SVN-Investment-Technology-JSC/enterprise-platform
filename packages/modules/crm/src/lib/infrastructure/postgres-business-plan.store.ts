import {
  DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS,
  type BusinessPlanCostKind,
  type BusinessPlanCostLine,
  type BusinessPlanDeviationSettings,
  type BusinessPlanFigures,
  type BusinessPlanRound,
  type BusinessPlanStatus,
} from '@enterprise-platform/contracts-crm';
import { randomUUID } from 'node:crypto';
import type {
  BusinessPlanChange,
  BusinessPlanRecord,
  BusinessPlanStore,
  NewBusinessPlanRecord,
  PlanAttachment,
  PlanLineRecord,
  PlanProcedureStart,
  PlanRoundLink,
} from '../application/business-plan-store.port.js';
import { normalizeDeviationSettings } from '../domain/business-plan.js';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { QUOTE_PROCEDURE_REVERSED_REASON } from '../domain/quote.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import type { ProcedureCompletedPayload, ProcedureReversedPayload } from './quote-procedure-links.js';
import { constraintViolation, toIso } from './sql-helpers.js';

/** Thực thể ghi vào `audit_log` cho PAKD; `metadata` có `quoteId`, `versionNo`, `round`. */
export const BUSINESS_PLAN_AUDIT_ENTITY = 'business_plan';
/** Nguồn phiên Quy trình duyệt PAKD trình riêng (`procedure_links.source_type`); `source_id` là id vòng duyệt. */
export const CRM_BUSINESS_PLAN_SOURCE_TYPE = 'crm_business_plan';
/** Khoá cấu hình so lệch PAKD trong `crm_schema.settings`. */
export const BUSINESS_PLAN_SETTING_KEY = 'business-plan.deviation';

const STALE = () =>
  new CrmConflictError('STALE_VERSION', 'Phương án kinh doanh vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface FigureColumns {
  gross_amount: string;
  revenue: string;
  goods_cost: string;
  discount_amount: string;
  extra_cost_total: string;
  total_cost: string;
  profit: string;
  margin_percent: string | null;
  discount_percent: string;
}

interface PlanRow extends FigureColumns {
  id: string;
  quote_id: string;
  quote_version_id: string;
  quote_version_no: number;
  status: BusinessPlanStatus;
  version: number;
  note: string | null;
  snapshot_at: Date | null;
  current_round_no: number | null;
  current_round_via: 'STANDALONE' | 'QUOTE' | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  decided_at: Date | null;
  decided_by: string | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const figuresOf = (row: FigureColumns): BusinessPlanFigures => ({
  grossAmount: num(row.gross_amount),
  revenue: num(row.revenue),
  goodsCost: num(row.goods_cost),
  discountAmount: num(row.discount_amount),
  extraCostTotal: num(row.extra_cost_total),
  totalCost: num(row.total_cost),
  profit: num(row.profit),
  marginPercent: row.margin_percent === null ? null : Number(row.margin_percent),
  discountPercent: num(row.discount_percent),
});

/** Giá trị của các cột số liệu, theo thứ tự `FIGURE_SET` bắt đầu từ `$first`. */
const figureValues = (figures: BusinessPlanFigures) => [
  figures.grossAmount,
  figures.revenue,
  figures.goodsCost,
  figures.discountAmount,
  figures.extraCostTotal,
  figures.totalCost,
  figures.profit,
  figures.marginPercent,
  figures.discountPercent,
];

const figureSet = (first: number) =>
  `gross_amount = $${first}, revenue = $${first + 1}, goods_cost = $${first + 2}, discount_amount = $${first + 3},
   extra_cost_total = $${first + 4}, total_cost = $${first + 5}, profit = $${first + 6},
   margin_percent = $${first + 7}, discount_percent = $${first + 8}`;

const PLAN_SELECT = `
  SELECT p.id, p.quote_id, p.quote_version_id, v.version_no AS quote_version_no, p.status, p.version, p.note,
         p.gross_amount, p.revenue, p.goods_cost, p.discount_amount, p.extra_cost_total, p.total_cost, p.profit,
         p.margin_percent, p.discount_percent, p.snapshot_at, p.current_round_no, r.via AS current_round_via,
         p.submitted_at, p.submitted_by, p.decided_at, p.decided_by, p.decision_reason, p.created_at, p.updated_at
    FROM crm_schema.business_plans p
    JOIN crm_schema.quote_versions v ON v.id = p.quote_version_id
    LEFT JOIN crm_schema.business_plan_rounds r ON r.quote_id = p.quote_id AND r.round_no = p.current_round_no`;

export class PostgresBusinessPlanStore implements BusinessPlanStore {
  constructor(private readonly database: CrmDatabase) {}

  async findByVersion(tenantId: string, quoteId: string, versionNo: number): Promise<BusinessPlanRecord | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PlanRow>(`${PLAN_SELECT} WHERE p.quote_id = $1 AND v.version_no = $2`, [quoteId, versionNo]);
    return result.rows[0] ? withLines(pool, result.rows[0]) : undefined;
  }

  async latestApproved(tenantId: string, quoteId: string, beforeVersionNo: number): Promise<BusinessPlanRecord | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<PlanRow>(
      `${PLAN_SELECT} WHERE p.quote_id = $1 AND p.status = 'APPROVED' AND v.version_no < $2
        ORDER BY p.decided_at DESC NULLS LAST, v.version_no DESC LIMIT 1`,
      [quoteId, beforeVersionNo],
    );
    return result.rows[0] ? withLines(pool, result.rows[0]) : undefined;
  }

  async listRounds(tenantId: string, quoteId: string): Promise<BusinessPlanRound[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<
      FigureColumns & {
        round_no: number;
        quote_version_no: number;
        via: 'STANDALONE' | 'QUOTE';
        submitted_at: Date;
        submitted_by: string;
        decided_at: Date | null;
        decided_by: string | null;
        decision: 'APPROVED' | 'REJECTED' | null;
        reason: string | null;
      }
    >(`SELECT * FROM crm_schema.business_plan_rounds WHERE quote_id = $1 ORDER BY round_no`, [quoteId]);
    return result.rows.map((row) => ({
      roundNo: row.round_no,
      quoteVersionNo: row.quote_version_no,
      via: row.via,
      submittedAt: toIso(row.submitted_at) ?? '',
      submittedBy: row.submitted_by,
      decidedAt: toIso(row.decided_at),
      decidedBy: row.decided_by,
      decision: row.decision,
      reason: row.reason,
      figures: figuresOf(row),
    }));
  }

  create(tenantId: string, record: NewBusinessPlanRecord, actorId: string): Promise<string> {
    return this.database
      .transaction(tenantId, async (client) => {
        const locked = await client.query<{ status: string; version_no: number }>(
          `SELECT v.status, v.version_no FROM crm_schema.quotes q
             JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.id = $2
            WHERE q.id = $1 FOR UPDATE OF q, v`,
          [record.quoteId, record.quoteVersionId],
        );
        const version = locked.rows[0];
        if (!version) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
        assertQuoteDraft(version.status);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO crm_schema.business_plans (quote_id, quote_version_id, note, created_by, updated_by,
             gross_amount, revenue, goods_cost, discount_amount, extra_cost_total, total_cost, profit, margin_percent, discount_percent)
           VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [record.quoteId, record.quoteVersionId, record.note, actorId, ...figureValues(record.figures)],
        );
        const id = inserted.rows[0].id;
        await insertLines(client, id, record.lines);
        await writeAuditLog(client, {
          entityType: BUSINESS_PLAN_AUDIT_ENTITY,
          entityId: id,
          toStatus: 'DRAFT',
          action: 'create',
          actorId,
          metadata: { quoteId: record.quoteId, versionNo: version.version_no, lines: record.lines.length },
        });
        return id;
      })
      .catch((error: unknown) => {
        if (constraintViolation(error, '23505', 'uq_crm_business_plans_version')) {
          throw new CrmConflictError('PLAN_EXISTS', 'Phiên bản báo giá này đã có phương án kinh doanh.');
        }
        throw error;
      });
  }

  update(tenantId: string, planId: string, expectedVersion: number, change: BusinessPlanChange, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockPlan(client, planId, expectedVersion);
      assertQuoteDraft(locked.quote_status);
      if (locked.status !== 'DRAFT' && locked.status !== 'REJECTED') {
        throw new CrmConflictError(
          'PLAN_LOCKED',
          locked.status === 'PENDING'
            ? 'Phương án kinh doanh đang chờ duyệt, chưa sửa được.'
            : 'Phương án kinh doanh đã được duyệt, không sửa được.',
        );
      }
      await client.query(
        `UPDATE crm_schema.business_plans
            SET status = 'DRAFT', note = $2, version = version + 1, ${figureSet(3)}, updated_at = now(), updated_by = $12
          WHERE id = $1`,
        [planId, change.note, ...figureValues(change.figures), actorId],
      );
      await client.query(`DELETE FROM crm_schema.business_plan_lines WHERE plan_id = $1`, [planId]);
      await insertLines(client, planId, change.lines);
      await writeAuditLog(client, {
        entityType: BUSINESS_PLAN_AUDIT_ENTITY,
        entityId: planId,
        fromStatus: locked.status,
        toStatus: 'DRAFT',
        action: 'update',
        actorId,
        metadata: { quoteId: locked.quote_id, versionNo: locked.version_no, lines: change.lines.length },
      });
    });
  }

  submit(
    tenantId: string,
    planId: string,
    expectedVersion: number,
    figures: BusinessPlanFigures,
    actorId: string,
    procedure?: PlanProcedureStart | null,
  ): Promise<string | null> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockPlan(client, planId, expectedVersion);
      assertQuoteDraft(locked.quote_status);
      if (locked.status !== 'DRAFT') {
        throw new CrmConflictError(
          locked.status === 'REJECTED' ? 'PLAN_REJECTED' : 'PLAN_LOCKED',
          locked.status === 'REJECTED'
            ? 'Phương án kinh doanh bị từ chối, vui lòng sửa lại rồi mới trình duyệt.'
            : 'Phương án kinh doanh đã được trình duyệt.',
        );
      }
      const roundId = await openRound(client, locked, figures, 'STANDALONE', actorId, procedure ? { procedure: true } : {});
      if (!procedure) return null;
      const linkId = randomUUID();
      await client.query(
        `INSERT INTO crm_schema.procedure_links (id, source_type, source_id, definition_id, title, initiated_by, start_idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [linkId, CRM_BUSINESS_PLAN_SOURCE_TYPE, roundId, procedure.definitionId, procedure.title, actorId, `crm:${linkId}`],
      );
      return linkId;
    });
  }

  async currentRoundLink(tenantId: string, planId: string): Promise<PlanRoundLink | undefined> {
    const pool = await this.database.pool(tenantId);
    const row = (
      await pool.query<{ id: string; status: string; instance_id: string | null; instance_code: string | null }>(
        `SELECT l.id, l.status, l.instance_id, l.instance_code
           FROM crm_schema.business_plans p
           JOIN crm_schema.business_plan_rounds r ON r.quote_id = p.quote_id AND r.round_no = p.current_round_no
           JOIN crm_schema.procedure_links l ON l.source_type = $2 AND l.source_id = r.id
          WHERE p.id = $1`,
        [planId, CRM_BUSINESS_PLAN_SOURCE_TYPE],
      )
    ).rows[0];
    return row ? { id: row.id, status: row.status, instanceId: row.instance_id, instanceCode: row.instance_code } : undefined;
  }

  decide(
    tenantId: string,
    planId: string,
    expectedVersion: number,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockPlan(client, planId, expectedVersion);
      if (locked.status !== 'PENDING') {
        throw new CrmConflictError('PLAN_NOT_PENDING', 'Phương án kinh doanh không ở trạng thái chờ duyệt.');
      }
      if (locked.round_via === 'QUOTE') {
        throw new CrmConflictError('PLAN_IN_QUOTE_APPROVAL', 'Phương án kinh doanh đang được duyệt cùng báo giá; vui lòng duyệt ở báo giá.');
      }
      if (locked.submitted_by === actorId) {
        throw new CrmForbiddenError('Không được tự duyệt phương án kinh doanh do mình trình.');
      }
      await closeRound(client, locked, decision, reason, actorId, 'STANDALONE');
      // Duyệt tay khi phiên Quy trình không tạo được: đóng liên kết của vòng để worker không thử lại.
      await client.query(
        `UPDATE crm_schema.procedure_links SET status = 'CLOSED', lease_until = NULL, updated_at = now()
          WHERE source_type = $1 AND status IN ('START_PENDING', 'FAILED')
            AND source_id = (SELECT id FROM crm_schema.business_plan_rounds WHERE quote_id = $2 AND round_no = $3)`,
        [CRM_BUSINESS_PLAN_SOURCE_TYPE, locked.quote_id, locked.current_round_no],
      );
    });
  }

  async deviationSettings(tenantId: string): Promise<BusinessPlanDeviationSettings> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
      BUSINESS_PLAN_SETTING_KEY,
    ]);
    if (!result.rows[0]) return DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS;
    try {
      return normalizeDeviationSettings(result.rows[0].value);
    } catch {
      // Giá trị hỏng (sửa tay trong DB): dùng mặc định thay vì chặn mọi báo giá.
      return DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS;
    }
  }

  async saveDeviationSettings(tenantId: string, settings: BusinessPlanDeviationSettings, actorId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(
      `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
                                       updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [BUSINESS_PLAN_SETTING_KEY, JSON.stringify(settings), actorId],
    );
  }
}

// ---------------------------------------------------------------------------
// Dùng chung với store báo giá (cùng transaction)
// ---------------------------------------------------------------------------

/**
 * Gửi duyệt báo giá kèm PAKD (P2D-04): trong transaction của báo giá, khoá PAKD đang soạn, chụp số liệu và mở
 * vòng duyệt đi cùng báo giá. PAKD đổi sau lúc service đọc (`version` lệch) thì 409.
 */
export async function attachPlanToQuoteSubmit(
  client: CrmSqlClient,
  attachment: PlanAttachment,
  actorId: string,
): Promise<void> {
  const locked = await lockPlan(client, attachment.planId, attachment.expectedVersion);
  if (locked.status !== 'DRAFT') {
    throw new CrmConflictError('PLAN_LOCKED', 'Trạng thái phương án kinh doanh đã thay đổi. Vui lòng tải lại rồi thao tác lại.');
  }
  await openRound(client, locked, attachment.figures, 'QUOTE', actorId);
}

/**
 * Kết quả duyệt báo giá (người duyệt hay Quy trình) áp lên PAKD đi cùng: duyệt thì PAKD được duyệt, từ chối hoặc
 * thu hồi thì PAKD bị từ chối. Chỉ đụng PAKD có vòng duyệt đi cùng báo giá.
 */
export async function syncPlanWithQuoteDecision(
  client: CrmSqlClient,
  versionId: string,
  to: 'APPROVED' | 'REJECTED',
  reason: string | null,
  actorId: string | null,
): Promise<void> {
  const found = await client.query<{ id: string }>(`SELECT id FROM crm_schema.business_plans WHERE quote_version_id = $1`, [versionId]);
  if (!found.rows[0]) return;
  const locked = await lockPlan(client, found.rows[0].id, undefined);
  if (locked.round_via !== 'QUOTE') return;
  if (to === 'APPROVED' && locked.status === 'PENDING') {
    await closeRound(client, locked, 'APPROVED', reason, actorId, 'QUOTE');
  } else if (to === 'REJECTED' && (locked.status === 'PENDING' || locked.status === 'APPROVED')) {
    await closeRound(client, locked, 'REJECTED', reason, actorId, 'QUOTE');
  }
}

// ---------------------------------------------------------------------------
// Kết quả Quy trình của PAKD trình riêng (D3-30)
// ---------------------------------------------------------------------------

const PROCEDURE_RESULTS = new Set(['completed', 'rejected', 'cancelled']);

/** Liên kết `crm_business_plan` đã khoá và vòng duyệt của nó; rỗng khi không phải liên kết của PAKD. */
async function lockPlanLink(client: CrmSqlClient, linkId: string) {
  return (
    await client.query<{
      source_id: string;
      status: string;
      result: string | null;
      instance_id: string | null;
      instance_code: string | null;
      plan_id: string | null;
      round_no: number | null;
    }>(
      `SELECT l.source_id, l.status, l.result, l.instance_id, l.instance_code, r.plan_id, r.round_no
         FROM crm_schema.procedure_links l
         LEFT JOIN crm_schema.business_plan_rounds r ON r.id = l.source_id
        WHERE l.id = $1 AND l.source_type = $2
        FOR UPDATE OF l`,
      [linkId, CRM_BUSINESS_PLAN_SOURCE_TYPE],
    )
  ).rows[0];
}

/**
 * Áp kết quả `procedure.instance.completed` (sourceType `crm_business_plan`) lên vòng duyệt PAKD trình riêng: hoàn
 * tất thì Đã duyệt; từ chối hoặc huỷ thì Bị từ chối kèm lý do của Quy trình. Nhận trùng hoặc đến muộn (liên kết đã
 * áp, đã đóng; PAKD không còn chờ ở đúng vòng này; phiên khác) thì bỏ qua.
 */
export async function applyBusinessPlanProcedureResult(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureCompletedPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_BUSINESS_PLAN_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const status = payload.status ?? '';
  if (!PROCEDURE_RESULTS.has(status)) return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const link = await lockPlanLink(client, linkId);
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
    const close = async () => {
      await client.query(`UPDATE crm_schema.procedure_links SET status = 'CLOSED', updated_at = now() WHERE id = $1`, [linkId]);
      return 'ignored' as const;
    };
    if (!link.plan_id) return close();
    const plan = await lockPlan(client, link.plan_id, undefined);
    if (plan.status !== 'PENDING' || plan.round_via !== 'STANDALONE' || plan.current_round_no !== link.round_no) return close();
    await closeRound(client, plan, approve ? 'APPROVED' : 'REJECTED', reason, isUuid(payload.actorId) ? payload.actorId : null, 'STANDALONE', {
      action: approve ? 'approve-procedure' : 'reject-procedure',
      metadata: { procedureLinkId: linkId, instanceId: payload.instanceId ?? link.instance_id, instanceCode: code, result: status },
    });
    await client.query(
      `UPDATE crm_schema.procedure_links SET status = 'APPLIED', last_error = NULL, updated_at = now() WHERE id = $1`,
      [linkId],
    );
    return 'applied';
  });
}

/**
 * Quy trình thu hồi phiên đã duyệt PAKD (`procedure.instance.reversed`, sourceType `crm_business_plan`): PAKD vẫn
 * Đã duyệt theo đúng vòng này thì về Bị từ chối với lý do "Quy trình đã thu hồi" (sửa lại rồi trình lại). Nhận lặp
 * hoặc PAKD đã đổi thì bỏ qua.
 */
export async function applyBusinessPlanProcedureReversed(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureReversedPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_BUSINESS_PLAN_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const link = await lockPlanLink(client, linkId);
    if (!link || link.result !== 'completed') return 'ignored';
    if (link.instance_id && payload.instanceId && link.instance_id !== payload.instanceId) return 'ignored';
    const detail = payload.reason?.trim();
    const reason = `${QUOTE_PROCEDURE_REVERSED_REASON}${detail ? `: ${detail}` : ''}`.slice(0, 2000);
    await client.query(
      `UPDATE crm_schema.procedure_links SET result = 'reversed', result_reason = $2, updated_at = now() WHERE id = $1`,
      [linkId, reason],
    );
    if (!link.plan_id) return 'ignored';
    const plan = await lockPlan(client, link.plan_id, undefined);
    if (plan.status !== 'APPROVED' || plan.current_round_no !== link.round_no) return 'ignored';
    const actor = isUuid(payload.reversedBy) ? payload.reversedBy : isUuid(payload.actorUserId) ? payload.actorUserId : null;
    await closeRound(client, plan, 'REJECTED', reason, actor, 'STANDALONE', {
      action: 'procedure-reversed',
      metadata: { procedureLinkId: linkId, instanceId: payload.instanceId ?? link.instance_id, instanceCode: payload.instanceCode ?? link.instance_code },
    });
    return 'applied';
  });
}

// ---------------------------------------------------------------------------

interface LockedPlan {
  id: string;
  quote_id: string;
  version_no: number;
  quote_status: string;
  status: BusinessPlanStatus;
  version: number;
  submitted_by: string | null;
  current_round_no: number | null;
  round_via: 'STANDALONE' | 'QUOTE' | null;
}

async function lockPlan(client: CrmSqlClient, planId: string, expectedVersion: number | undefined): Promise<LockedPlan> {
  const result = await client.query<LockedPlan>(
    `SELECT p.id, p.quote_id, v.version_no, v.status AS quote_status, p.status, p.version, p.submitted_by,
            p.current_round_no, r.via AS round_via
       FROM crm_schema.business_plans p
       JOIN crm_schema.quotes q ON q.id = p.quote_id
       JOIN crm_schema.quote_versions v ON v.id = p.quote_version_id
       LEFT JOIN crm_schema.business_plan_rounds r ON r.quote_id = p.quote_id AND r.round_no = p.current_round_no
      WHERE p.id = $1
      FOR UPDATE OF q, v, p`,
    [planId],
  );
  const row = result.rows[0];
  if (!row) throw new CrmNotFoundError('Không tìm thấy phương án kinh doanh.');
  if (expectedVersion !== undefined && row.version !== expectedVersion) throw STALE();
  return row;
}

function assertQuoteDraft(status: string): void {
  if (status !== 'DRAFT') {
    throw new CrmConflictError(
      'QUOTE_NOT_DRAFT',
      'Chỉ lập, sửa và trình phương án kinh doanh khi phiên bản báo giá còn ở Nháp. Hãy sửa báo giá để tạo phiên bản mới rồi chép phương án sang.',
    );
  }
}

async function insertLines(client: CrmSqlClient, planId: string, lines: readonly PlanLineRecord[]): Promise<void> {
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO crm_schema.business_plan_lines (plan_id, line_no, kind, description, amount) VALUES ($1, $2, $3, $4, $5)`,
      [planId, index + 1, line.kind, line.description, line.amount],
    );
  }
}

/** Đang soạn -> chờ duyệt: chụp số liệu, mở vòng mới (số vòng tăng dần trong cả báo giá). */
async function openRound(
  client: CrmSqlClient,
  plan: LockedPlan,
  figures: BusinessPlanFigures,
  via: 'STANDALONE' | 'QUOTE',
  actorId: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const next = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX(round_no), 0) + 1 AS n FROM crm_schema.business_plan_rounds WHERE quote_id = $1`,
    [plan.quote_id],
  );
  const roundNo = Number(next.rows[0].n);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.business_plan_rounds
       (plan_id, quote_id, round_no, quote_version_no, via, submitted_by,
        gross_amount, revenue, goods_cost, discount_amount, extra_cost_total, total_cost, profit, margin_percent, discount_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [plan.id, plan.quote_id, roundNo, plan.version_no, via, actorId, ...figureValues(figures)],
  );
  await client.query(
    `UPDATE crm_schema.business_plans
        SET status = 'PENDING', version = version + 1, ${figureSet(2)}, snapshot_at = now(), current_round_no = $11,
            submitted_at = now(), submitted_by = $12, decided_at = NULL, decided_by = NULL, decision_reason = NULL,
            updated_at = now(), updated_by = $12
      WHERE id = $1`,
    [plan.id, ...figureValues(figures), roundNo, actorId],
  );
  await writeAuditLog(client, {
    entityType: BUSINESS_PLAN_AUDIT_ENTITY,
    entityId: plan.id,
    fromStatus: plan.status,
    toStatus: 'PENDING',
    action: 'submit',
    actorId,
    metadata: { quoteId: plan.quote_id, versionNo: plan.version_no, round: roundNo, via, ...metadata },
  });
  return inserted.rows[0].id;
}

async function closeRound(
  client: CrmSqlClient,
  plan: LockedPlan,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
  actorId: string | null,
  via: 'STANDALONE' | 'QUOTE',
  audit: { readonly action?: string; readonly metadata?: Readonly<Record<string, unknown>> } = {},
): Promise<void> {
  await client.query(
    `UPDATE crm_schema.business_plan_rounds
        SET decided_at = now(), decided_by = $3, decision = $4, reason = $5
      WHERE quote_id = $1 AND round_no = $2`,
    [plan.quote_id, plan.current_round_no, actorId, decision, reason],
  );
  await client.query(
    `UPDATE crm_schema.business_plans
        SET status = $2, version = version + 1, decided_at = now(), decided_by = $3, decision_reason = $4,
            updated_at = now(), updated_by = COALESCE($3, updated_by)
      WHERE id = $1`,
    [plan.id, decision, actorId, reason],
  );
  await writeAuditLog(client, {
    entityType: BUSINESS_PLAN_AUDIT_ENTITY,
    entityId: plan.id,
    fromStatus: plan.status,
    toStatus: decision,
    action: audit.action ?? (decision === 'APPROVED' ? 'approve' : 'reject'),
    actorId,
    reason,
    metadata: { quoteId: plan.quote_id, versionNo: plan.version_no, round: plan.current_round_no, via, ...audit.metadata },
  });
}

async function withLines(pool: { query: CrmSqlClient['query'] }, row: PlanRow): Promise<BusinessPlanRecord> {
  const lines = await pool.query<{ id: string; line_no: number; kind: BusinessPlanCostKind; description: string | null; amount: string }>(
    `SELECT id, line_no, kind, description, amount FROM crm_schema.business_plan_lines WHERE plan_id = $1 ORDER BY line_no`,
    [row.id],
  );
  return {
    id: row.id,
    quoteId: row.quote_id,
    quoteVersionId: row.quote_version_id,
    quoteVersionNo: row.quote_version_no,
    status: row.status,
    version: row.version,
    note: row.note,
    figures: figuresOf(row),
    snapshotAt: toIso(row.snapshot_at),
    lines: lines.rows.map(
      (line): BusinessPlanCostLine => ({
        id: line.id,
        lineNo: line.line_no,
        kind: line.kind,
        description: line.description,
        amount: num(line.amount),
      }),
    ),
    currentRoundNo: row.current_round_no,
    currentRoundVia: row.current_round_via,
    submittedAt: toIso(row.submitted_at),
    submittedBy: row.submitted_by,
    decidedAt: toIso(row.decided_at),
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}
