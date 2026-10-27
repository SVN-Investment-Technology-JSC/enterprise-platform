import { randomUUID } from 'node:crypto';
import {
  CRM_QUOTE_APPROVAL_DECIDED,
  CRM_QUOTE_APPROVAL_REQUESTED,
  CRM_QUOTE_EXPIRED,
  QUOTE_STATUS_LABELS,
  quoteDeepLink,
  type AppliedDiscountPolicy,
  type CrmPage,
  type CrmQuoteApprovalDecidedPayload,
  type CrmQuoteApprovalRequestedPayload,
  type CrmQuoteExpiredPayload,
  type DiscountStacking,
  type PriceSource,
  type ProcedureLinkStatus,
  type QuoteApprovalReason,
  type QuoteDetail,
  type QuoteHistoryEntry,
  type QuoteLine,
  type QuoteProcedureLink,
  type QuoteStatus,
  type QuoteSummary,
  type QuoteVersion,
  type QuoteVersionSummary,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  EditableQuote,
  NewQuoteRecord,
  QuoteFilter,
  QuoteHead,
  QuoteLineRecord,
  QuoteStore,
  QuoteSubmission,
  QuoteTransition,
  QuoteVersionRef,
  QuoteVersionWrite,
} from '../application/quote-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { formatQuoteCode, type QuoteEditPlan } from '../domain/quote.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toDateOnly, toIso, toNumber } from './sql-helpers.js';

/** Thực thể ghi vào `audit_log`; `metadata.versionNo` là phiên bản liên quan. */
export const QUOTE_AUDIT_ENTITY = 'quote';
/** Nguồn phiên Quy trình của báo giá. */
export const CRM_QUOTE_SOURCE_TYPE = 'crm_quote';

const STALE = () =>
  new CrmConflictError('STALE_VERSION', 'Báo giá vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

interface HeadRow {
  id: string;
  code: string;
  opportunity_id: string | null;
  opportunity_name: string | null;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_group_id: string | null;
  owner_user_id: string;
  status: QuoteStatus;
  current_version: number;
  valid_until: string | null;
  accepted_version: number | null;
  converted_at: Date | null;
  total_amount: string | null;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

interface VersionRow {
  id: string;
  version_no: number;
  status: QuoteStatus;
  revision: number;
  valid_until: string | null;
  price_date: string | null;
  priced_on: string | null;
  note: string | null;
  shipping_amount: string;
  shipping_vat_rate: string;
  shipping_cost: string;
  gross_amount: string;
  discount_amount: string;
  net_amount: string;
  vat_amount: string;
  total_amount: string;
  est_cost: string;
  profit: string;
  margin_percent: string | null;
  discount_percent: string;
  requires_approval: boolean;
  approval_reasons: QuoteApprovalReason[] | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  rejected_at: Date | null;
  rejected_by: string | null;
  decision_reason: string | null;
  sent_at: Date | null;
  responded_at: Date | null;
  superseded_at: Date | null;
  created_at: Date;
}

interface LineRow {
  id: string;
  line_no: number;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  material_kind: string;
  category: string | null;
  quantity: string;
  list_price: string;
  price_source: PriceSource;
  price_reference_code: string | null;
  policy_percent: string;
  discount_percent: string;
  capped_at: string | null;
  overridden: boolean;
  override_unit_price: string | null;
  override_discount_percent: string | null;
  unit_price: string;
  gross_amount: string;
  discount_amount: string;
  vat_rate: string;
  line_amount: string;
  vat_amount: string;
  line_total: string;
  est_unit_cost: string | null;
  est_cost: string;
  margin: string | null;
}

interface PolicyRow {
  line_id: string;
  policy_id: string;
  code: string;
  name: string;
  stacking: DiscountStacking;
  exclusive: boolean;
  percent: string;
}

const HEAD_COLUMNS = `
  q.id, q.code, q.opportunity_id, o.name AS opportunity_name, q.customer_id, c.code AS customer_code,
  c.name AS customer_name, c.group_id AS customer_group_id, q.owner_user_id, q.status, q.current_version,
  q.valid_until::text AS valid_until, q.accepted_version, q.converted_at, v.total_amount, q.created_at, q.updated_at,
  ${cursorAt('q.updated_at')} AS cursor_at`;

const HEAD_FROM = `
  FROM crm_schema.quotes q
  JOIN crm_schema.customers c ON c.id = q.customer_id
  LEFT JOIN crm_schema.opportunities o ON o.id = q.opportunity_id
  LEFT JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version`;

const VERSION_COLUMNS = `
  id, version_no, status, revision, valid_until::text AS valid_until, price_date::text AS price_date,
  priced_on::text AS priced_on, note, shipping_amount, shipping_vat_rate, shipping_cost, gross_amount, discount_amount,
  net_amount, vat_amount, total_amount, est_cost, profit, margin_percent, discount_percent, requires_approval,
  approval_reasons, submitted_at, submitted_by, approved_at, approved_by, rejected_at, rejected_by, decision_reason,
  sent_at, responded_at, superseded_at, created_at`;

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

export class PostgresQuoteStore implements QuoteStore {
  constructor(private readonly database: CrmDatabase) {}

  async listQuotes(tenantId: string, scope: CrmDataScope, filter: QuoteFilter): Promise<CrmPage<QuoteSummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'q.owner_user_id');
    if (filter.status) where.add(`q.status = ${where.param(filter.status)}`);
    if (filter.customerId) where.add(`q.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.opportunityId) where.add(`q.opportunity_id = ${where.param(filter.opportunityId)}::uuid`);
    if (filter.ownerUserId) where.add(`q.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.q) {
      const tsQuery = prefixTsQuery(filter.q);
      const code = `q.code ILIKE ${where.param(prefixPattern(filter.q.toUpperCase()))}`;
      where.add(
        tsQuery
          ? `(${code} OR to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)}))`
          : code,
      );
    }
    where.after(filter.cursor, 'q.updated_at', 'q.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<HeadRow>(
      `SELECT ${HEAD_COLUMNS} ${HEAD_FROM} ${where.where()}
        ORDER BY q.updated_at DESC, q.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async getQuote(tenantId: string, scope: CrmDataScope, id: string, versionNo?: number): Promise<QuoteDetail | undefined> {
    const pool = await this.database.pool(tenantId);
    const head = await readHead(pool, scope, id);
    if (!head) return undefined;
    const version = await readVersion(pool, id, versionNo ?? head.current_version);
    if (!version) return undefined;
    const [versions, link, history] = await Promise.all([
      pool.query<{ version_no: number; status: QuoteStatus; total_amount: string; created_at: Date }>(
        `SELECT version_no, status, total_amount, created_at FROM crm_schema.quote_versions
          WHERE quote_id = $1 ORDER BY version_no DESC`,
        [id],
      ),
      pool.query<{
        id: string;
        status: ProcedureLinkStatus;
        instance_id: string | null;
        instance_code: string | null;
        result: string | null;
        last_error: string | null;
        attempts: number;
      }>(
        `SELECT id, status, instance_id, instance_code, result, last_error, attempts
           FROM crm_schema.procedure_links WHERE source_type = $1 AND source_id = $2`,
        [CRM_QUOTE_SOURCE_TYPE, version.id],
      ),
      pool.query<{
        id: string;
        at: Date;
        action: string;
        from_status: string | null;
        to_status: string | null;
        actor_id: string | null;
        reason: string | null;
        version_no: string | null;
      }>(
        `SELECT id, at, action, from_status, to_status, actor_id, reason, metadata->>'versionNo' AS version_no
           FROM crm_schema.audit_log
          WHERE entity_type = $1 AND entity_id = $2
          ORDER BY at DESC, id DESC
          LIMIT 200`,
        [QUOTE_AUDIT_ENTITY, id],
      ),
    ]);
    const linkRow = link.rows[0];
    const procedure: QuoteProcedureLink | null = linkRow
      ? {
          id: linkRow.id,
          status: linkRow.status,
          instanceId: linkRow.instance_id,
          instanceCode: linkRow.instance_code,
          result: linkRow.result,
          lastError: linkRow.last_error,
          attempts: linkRow.attempts,
        }
      : null;
    return {
      ...toSummary(head),
      acceptedVersion: head.accepted_version,
      convertedAt: toIso(head.converted_at),
      createdAt: toIso(head.created_at) ?? '',
      versions: versions.rows.map(
        (row): QuoteVersionSummary => ({
          versionNo: row.version_no,
          status: row.status,
          totalAmount: num(row.total_amount),
          createdAt: toIso(row.created_at) ?? '',
        }),
      ),
      version,
      procedure,
      history: history.rows.map(
        (row): QuoteHistoryEntry => ({
          id: row.id,
          at: toIso(row.at) ?? '',
          action: row.action,
          fromStatus: row.from_status,
          toStatus: row.to_status,
          actorId: row.actor_id,
          reason: row.reason,
          versionNo: row.version_no === null ? null : Number(row.version_no),
        }),
      ),
      approvalCheck: null,
    };
  }

  async loadForEdit(tenantId: string, scope: CrmDataScope, id: string, versionNo: number): Promise<EditableQuote | undefined> {
    const pool = await this.database.pool(tenantId);
    const head = await readHead(pool, scope, id);
    if (!head) return undefined;
    const version = await readVersion(pool, id, versionNo);
    if (!version) return undefined;
    const quoteHead: QuoteHead = {
      id: head.id,
      code: head.code,
      opportunityId: head.opportunity_id,
      customerId: head.customer_id,
      customerName: head.customer_name,
      customerGroupId: head.customer_group_id,
      ownerUserId: head.owner_user_id,
      status: head.status,
      currentVersion: head.current_version,
    };
    return { head: quoteHead, version };
  }

  createQuote(tenantId: string, record: NewQuoteRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, (client) => insertQuote(client, record, actorId));
  }

  saveVersion(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    plan: QuoteEditPlan,
    write: QuoteVersionWrite,
    actorId: string,
  ): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      await lockVersion(client, quoteId, base);
      if (plan === 'IN_PLACE') {
        await client.query(
          `UPDATE crm_schema.quote_versions SET ${VERSION_WRITE_SET}, revision = revision + 1, updated_at = now(), updated_by = $20
            WHERE id = $1`,
          [base.versionId, ...versionWriteValues(write), actorId],
        );
        await client.query(`DELETE FROM crm_schema.quote_lines WHERE version_id = $1`, [base.versionId]);
        await insertLines(client, base.versionId, write.lines, actorId);
        await client.query(
          `UPDATE crm_schema.quotes SET valid_until = $2, updated_at = now(), updated_by = $3 WHERE id = $1`,
          [quoteId, write.validUntil, actorId],
        );
        return base.versionNo;
      }
      const nextNo = base.versionNo + 1;
      await client.query(
        `UPDATE crm_schema.quote_versions
            SET status = 'SUPERSEDED', superseded_at = now(), revision = revision + 1, updated_at = now(), updated_by = $2
          WHERE id = $1`,
        [base.versionId, actorId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.quote_versions (quote_id, version_no, status, created_by, updated_by)
         VALUES ($1, $2, 'DRAFT', $3, $3) RETURNING id`,
        [quoteId, nextNo, actorId],
      );
      const versionId = inserted.rows[0].id;
      await client.query(
        `UPDATE crm_schema.quote_versions SET ${VERSION_WRITE_SET} WHERE id = $1`,
        [versionId, ...versionWriteValues(write)],
      );
      await insertLines(client, versionId, write.lines, actorId);
      await client.query(
        `UPDATE crm_schema.quotes
            SET current_version = $2, status = 'DRAFT', valid_until = $3, updated_at = now(), updated_by = $4
          WHERE id = $1`,
        [quoteId, nextNo, write.validUntil, actorId],
      );
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        fromStatus: base.status,
        toStatus: 'SUPERSEDED',
        action: 'revise',
        actorId,
        reason: `Sinh phiên bản ${nextNo} để sửa`,
        metadata: { versionNo: base.versionNo, newVersionNo: nextNo },
      });
      return nextNo;
    });
  }

  submit(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    submission: QuoteSubmission,
    actorId: string,
  ): Promise<string | null> {
    return this.database.transaction(tenantId, async (client) => {
      await lockVersion(client, quoteId, base, 'DRAFT');
      const status: QuoteStatus = submission.outcome;
      await client.query(
        `UPDATE crm_schema.quote_versions
            SET status = $2::varchar, requires_approval = $3, approval_reasons = $4::jsonb, submitted_at = now(),
                submitted_by = $5,
                approved_at = CASE WHEN $2::varchar = 'APPROVED' THEN now() ELSE NULL END,
                decision_reason = CASE WHEN $2::varchar = 'APPROVED' THEN 'Không vượt ngưỡng duyệt' ELSE NULL END,
                revision = revision + 1, updated_at = now(), updated_by = $5
          WHERE id = $1`,
        [base.versionId, status, submission.outcome === 'PENDING', JSON.stringify(submission.reasons), actorId],
      );
      await client.query(
        `UPDATE crm_schema.quotes SET status = $2, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [quoteId, status, actorId],
      );
      let linkId: string | null = null;
      if (submission.procedure) {
        linkId = randomUUID();
        await client.query(
          `INSERT INTO crm_schema.procedure_links
             (id, source_type, source_id, definition_id, title, initiated_by, start_idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [linkId, CRM_QUOTE_SOURCE_TYPE, base.versionId, submission.procedure.definitionId, submission.procedure.title, actorId, `crm:${linkId}`],
        );
      }
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        fromStatus: 'DRAFT',
        toStatus: status,
        action: 'submit',
        actorId,
        reason: submission.outcome === 'APPROVED' ? 'Không vượt ngưỡng duyệt, duyệt thẳng' : null,
        metadata: {
          versionNo: base.versionNo,
          reasons: submission.reasons.map((reason) => reason.message),
          ...(linkId ? { procedureLinkId: linkId } : {}),
        },
      });
      if (submission.outcome === 'PENDING' && submission.approvalRequested) {
        const payload: CrmQuoteApprovalRequestedPayload = {
          ...submission.approvalRequested,
          mode: submission.procedure ? 'PROCEDURE' : 'DIRECT',
        };
        await writeCrmOutbox(client, tenantId, {
          type: CRM_QUOTE_APPROVAL_REQUESTED,
          aggregateType: 'crm-quote',
          aggregateId: quoteId,
          payload,
        });
      }
      return linkId;
    });
  }

  transition(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    transition: QuoteTransition,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockVersion(client, quoteId, base, transition.from);
      await applyDecision(client, tenantId, locked, transition, actorId);
      // Duyệt tay sau khi Quy trình không tạo được phiên: đóng liên kết để kết quả muộn bị bỏ qua.
      if (transition.to === 'APPROVED' || transition.to === 'REJECTED') {
        await client.query(
          `UPDATE crm_schema.procedure_links SET status = 'CLOSED', lease_until = NULL, updated_at = now()
            WHERE source_type = $1 AND source_id = $2 AND status NOT IN ('APPLIED', 'CLOSED')`,
          [CRM_QUOTE_SOURCE_TYPE, base.versionId],
        );
      }
    });
  }

  async expireDue(tenantId: string, today: string, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      const due = await client.query<{
        id: string;
        code: string;
        owner_user_id: string;
        version_id: string;
        version_no: number;
        status: QuoteStatus;
        valid_until: string;
      }>(
        `SELECT q.id, q.code, q.owner_user_id, v.id AS version_id, v.version_no, v.status, v.valid_until::text AS valid_until
           FROM crm_schema.quotes q
           JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.version_no = q.current_version
          WHERE q.status IN ('APPROVED', 'SENT') AND v.status IN ('APPROVED', 'SENT')
            AND v.valid_until IS NOT NULL AND v.valid_until < $1::date
          ORDER BY v.valid_until, q.id
          LIMIT $2
          FOR UPDATE OF q, v SKIP LOCKED`,
        [today, limit],
      );
      for (const row of due.rows) {
        await client.query(
          `UPDATE crm_schema.quote_versions SET status = 'EXPIRED', revision = revision + 1, updated_at = now() WHERE id = $1`,
          [row.version_id],
        );
        await client.query(`UPDATE crm_schema.quotes SET status = 'EXPIRED', updated_at = now() WHERE id = $1`, [row.id]);
        await writeAuditLog(client, {
          entityType: QUOTE_AUDIT_ENTITY,
          entityId: row.id,
          fromStatus: row.status,
          toStatus: 'EXPIRED',
          action: 'expire',
          actorId: null,
          reason: `Quá hạn hiệu lực ${row.valid_until.split('-').reverse().join('/')}`,
          metadata: { versionNo: row.version_no },
        });
        const payload: CrmQuoteExpiredPayload = {
          quoteId: row.id,
          quoteCode: row.code,
          versionNo: row.version_no,
          validUntil: row.valid_until,
          actorUserId: null,
          recipientUserIds: [row.owner_user_id],
          summary: `Báo giá ${row.code} đã hết hạn hiệu lực.`,
          deepLink: quoteDeepLink(row.id),
        };
        await writeCrmOutbox(client, tenantId, { type: CRM_QUOTE_EXPIRED, aggregateType: 'crm-quote', aggregateId: row.id, payload });
      }
      return due.rows.length;
    });
  }

  async reversalCheck(tenantId: string, instanceOrLinkId: string): Promise<{ allowed: boolean; reason?: string }> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ code: string; converted_at: Date | null }>(
      `SELECT q.code, q.converted_at
         FROM crm_schema.procedure_links l
         JOIN crm_schema.quote_versions v ON v.id = l.source_id
         JOIN crm_schema.quotes q ON q.id = v.quote_id
        WHERE l.source_type = $1 AND (l.instance_id = $2::uuid OR l.id = $2::uuid)
        LIMIT 1`,
      [CRM_QUOTE_SOURCE_TYPE, instanceOrLinkId],
    );
    const row = result.rows[0];
    if (row?.converted_at) {
      return { allowed: false, reason: `Báo giá ${row.code} đã chuyển thành hợp đồng, không thu hồi được kết quả duyệt.` };
    }
    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Ghi trong transaction của bên gọi
// ---------------------------------------------------------------------------

/**
 * Tạo báo giá cùng phiên bản 1 ở Nháp và dòng nhật ký, trong transaction của
 * bên gọi (tạo trực tiếp, hoặc khi cơ hội chuyển sang Báo giá). Trả id.
 */
export async function insertQuote(client: CrmSqlClient, record: NewQuoteRecord, actorId: string): Promise<string> {
  const sequence = await client.query<{ seq: string; year: number }>(
    `SELECT nextval('crm_schema.quote_code_seq') AS seq,
            extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS year`,
  );
  const code = formatQuoteCode(sequence.rows[0].year, Number(sequence.rows[0].seq));
  const quote = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.quotes (code, opportunity_id, customer_id, owner_user_id, valid_until, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [code, record.opportunityId, record.customerId, record.ownerUserId, record.validUntil, actorId],
  );
  const id = quote.rows[0]?.id;
  if (!id) throw new Error('crm_schema.quotes insert returned no row.');
  await client.query(
    `INSERT INTO crm_schema.quote_versions (quote_id, version_no, valid_until, note, created_by, updated_by)
     VALUES ($1, 1, $2, $3, $4, $4)`,
    [id, record.validUntil, record.note, actorId],
  );
  await writeAuditLog(client, {
    entityType: QUOTE_AUDIT_ENTITY,
    entityId: id,
    fromStatus: null,
    toStatus: 'DRAFT',
    action: 'create',
    actorId,
    metadata: { versionNo: 1, code, ...(record.opportunityId ? { opportunityId: record.opportunityId } : {}) },
  });
  return id;
}

interface LockedVersion {
  readonly quoteId: string;
  readonly code: string;
  readonly ownerUserId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly status: QuoteStatus;
  readonly submittedBy: string | null;
}

/**
 * Khoá báo giá và phiên bản rồi so với bản service đã đọc: phải là phiên bản
 * hiện tại, cùng trạng thái, cùng `revision` (và đúng `requiredStatus` nếu có).
 */
async function lockVersion(
  client: CrmSqlClient,
  quoteId: string,
  base: QuoteVersionRef,
  requiredStatus?: QuoteStatus,
): Promise<LockedVersion> {
  const result = await client.query<{
    code: string;
    owner_user_id: string;
    current_version: number;
    id: string;
    version_no: number;
    status: QuoteStatus;
    revision: number;
    submitted_by: string | null;
  }>(
    `SELECT q.code, q.owner_user_id, q.current_version, v.id, v.version_no, v.status, v.revision, v.submitted_by
       FROM crm_schema.quotes q
       JOIN crm_schema.quote_versions v ON v.quote_id = q.id AND v.id = $2
      WHERE q.id = $1
      FOR UPDATE OF q, v`,
    [quoteId, base.versionId],
  );
  const row = result.rows[0];
  if (!row) throw STALE();
  if (row.current_version !== row.version_no) {
    throw new CrmConflictError('QUOTE_VERSION_READ_ONLY', 'Phiên bản cũ chỉ đọc.');
  }
  if (requiredStatus && row.status !== requiredStatus) {
    throw new CrmConflictError(
      requiredStatus === 'DRAFT' ? 'QUOTE_ALREADY_SUBMITTED' : 'INVALID_QUOTE_TRANSITION',
      requiredStatus === 'DRAFT'
        ? 'Phiên bản này đã được gửi duyệt.'
        : `Báo giá đang ở trạng thái "${QUOTE_STATUS_LABELS[row.status]}", không thực hiện được thao tác này.`,
    );
  }
  if (row.status !== base.status || row.revision !== base.revision) throw STALE();
  return {
    quoteId,
    code: row.code,
    ownerUserId: row.owner_user_id,
    versionId: row.id,
    versionNo: row.version_no,
    status: row.status,
    submittedBy: row.submitted_by,
  };
}

/**
 * Áp một lần chuyển (đã kiểm theo máy trạng thái) lên phiên bản đã khoá: đổi
 * trạng thái, mốc thời gian, nhật ký; duyệt hoặc từ chối thì báo người gửi.
 * Dùng chung cho thao tác của người dùng và kết quả Quy trình.
 */
export async function applyDecision(
  client: CrmSqlClient,
  tenantId: string,
  locked: LockedVersion,
  transition: QuoteTransition,
  actorId: string | null,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const to = transition.to;
  await client.query(
    `UPDATE crm_schema.quote_versions
        SET status = $2::varchar,
            approved_at = CASE WHEN $2::varchar = 'APPROVED' THEN now() ELSE approved_at END,
            approved_by = CASE WHEN $2::varchar = 'APPROVED' THEN $3::uuid ELSE approved_by END,
            rejected_at = CASE WHEN $2::varchar = 'REJECTED' THEN now() ELSE rejected_at END,
            rejected_by = CASE WHEN $2::varchar = 'REJECTED' THEN $3::uuid ELSE rejected_by END,
            decision_reason = CASE WHEN $2::varchar IN ('APPROVED', 'REJECTED', 'DECLINED') THEN $4::varchar ELSE decision_reason END,
            sent_at = CASE WHEN $2::varchar = 'SENT' THEN now() ELSE sent_at END,
            responded_at = CASE WHEN $2::varchar IN ('ACCEPTED', 'DECLINED') THEN now() ELSE responded_at END,
            revision = revision + 1, updated_at = now(), updated_by = $3::uuid
      WHERE id = $1`,
    [locked.versionId, to, actorId, transition.reason],
  );
  await client.query(
    `UPDATE crm_schema.quotes
        SET status = $2::varchar,
            accepted_version = CASE WHEN $2::varchar = 'ACCEPTED' THEN $4::int ELSE accepted_version END,
            updated_at = now(), updated_by = $3::uuid
      WHERE id = $1`,
    [locked.quoteId, to, actorId, locked.versionNo],
  );
  await writeAuditLog(client, {
    entityType: QUOTE_AUDIT_ENTITY,
    entityId: locked.quoteId,
    fromStatus: transition.from,
    toStatus: to,
    action: transition.action,
    actorId,
    reason: transition.reason,
    metadata: { versionNo: locked.versionNo, ...metadata },
  });
  if ((to === 'APPROVED' || to === 'REJECTED') && locked.submittedBy) {
    const approved = to === 'APPROVED';
    const payload: CrmQuoteApprovalDecidedPayload = {
      quoteId: locked.quoteId,
      quoteCode: locked.code,
      versionNo: locked.versionNo,
      status: to,
      reason: transition.reason,
      actorUserId: actorId,
      recipientUserIds: [locked.submittedBy],
      summary: approved
        ? `Báo giá ${locked.code} (phiên bản ${locked.versionNo}) đã được duyệt.`
        : `Báo giá ${locked.code} (phiên bản ${locked.versionNo}) bị từ chối duyệt${transition.reason ? `: ${transition.reason}` : '.'}`.slice(0, 500),
      deepLink: quoteDeepLink(locked.quoteId),
    };
    await writeCrmOutbox(client, tenantId, {
      type: CRM_QUOTE_APPROVAL_DECIDED,
      aggregateType: 'crm-quote',
      aggregateId: locked.quoteId,
      payload,
    });
  }
}

/** Khoá phiên bản theo id (kết quả Quy trình), không so `revision`. */
export async function lockVersionById(client: CrmSqlClient, versionId: string): Promise<LockedVersion | undefined> {
  const result = await client.query<{
    quote_id: string;
    code: string;
    owner_user_id: string;
    current_version: number;
    version_no: number;
    status: QuoteStatus;
    submitted_by: string | null;
  }>(
    `SELECT q.id AS quote_id, q.code, q.owner_user_id, q.current_version, v.version_no, v.status, v.submitted_by
       FROM crm_schema.quote_versions v
       JOIN crm_schema.quotes q ON q.id = v.quote_id
      WHERE v.id = $1
      FOR UPDATE OF q, v`,
    [versionId],
  );
  const row = result.rows[0];
  if (!row || row.current_version !== row.version_no) return undefined;
  return {
    quoteId: row.quote_id,
    code: row.code,
    ownerUserId: row.owner_user_id,
    versionId,
    versionNo: row.version_no,
    status: row.status,
    submittedBy: row.submitted_by,
  };
}

/** Tạo nháp báo giá cho cơ hội nếu cơ hội chưa có báo giá còn hiệu lực (OPP-05). Trả id khi tạo mới. */
export async function ensureDraftQuoteForOpportunity(
  client: CrmSqlClient,
  opportunityId: string,
  validUntil: string,
  actorId: string,
): Promise<string | null> {
  const existing = await client.query(
    `SELECT 1 FROM crm_schema.quotes WHERE opportunity_id = $1 AND status NOT IN ('DECLINED', 'EXPIRED') LIMIT 1`,
    [opportunityId],
  );
  if (existing.rows.length) return null;
  const opportunity = await client.query<{ customer_id: string; owner_user_id: string }>(
    `SELECT customer_id, owner_user_id FROM crm_schema.opportunities WHERE id = $1`,
    [opportunityId],
  );
  const row = opportunity.rows[0];
  if (!row) return null;
  return insertQuote(
    client,
    { opportunityId, customerId: row.customer_id, ownerUserId: row.owner_user_id, validUntil, note: null },
    actorId,
  );
}

const VERSION_WRITE_SET = `
  valid_until = $2, price_date = $3, priced_on = $4, note = $5, shipping_amount = $6, shipping_vat_rate = $7,
  shipping_cost = $8, gross_amount = $9, discount_amount = $10, net_amount = $11, vat_amount = $12, total_amount = $13,
  est_cost = $14, profit = $15, margin_percent = $16, discount_percent = $17, requires_approval = $18,
  approval_reasons = $19::jsonb`;

function versionWriteValues(write: QuoteVersionWrite): unknown[] {
  const totals = write.totals;
  return [
    write.validUntil,
    write.priceDate,
    write.pricedOn,
    write.note,
    write.shipping.amount,
    write.shipping.vatRate,
    write.shipping.cost,
    totals.grossAmount,
    totals.discountAmount,
    totals.netAmount,
    totals.vatAmount,
    totals.totalAmount,
    totals.estCost,
    totals.profit,
    totals.marginPercent,
    totals.discountPercent,
    false,
    '[]',
  ];
}

async function insertLines(client: CrmSqlClient, versionId: string, lines: readonly QuoteLineRecord[], actorId: string) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO crm_schema.quote_lines
         (id, version_id, line_no, material_id, material_code, material_name, unit, material_kind, category, quantity,
          list_price, price_source, price_reference_id, price_reference_code, policy_percent, discount_percent, capped_at,
          overridden, override_unit_price, override_discount_percent, unit_price, gross_amount, discount_amount, vat_rate,
          line_amount, vat_amount, line_total, est_unit_cost, est_cost, margin, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
               $24, $25, $26, $27, $28, $29, $30, $31)`,
      [
        line.id,
        versionId,
        line.lineNo,
        line.materialId,
        line.materialCode.slice(0, 100),
        line.materialName.slice(0, 300),
        line.unit,
        line.materialKind.slice(0, 16),
        line.category?.slice(0, 300) ?? null,
        line.quantity,
        line.listPrice,
        line.priceSource,
        line.priceReferenceId,
        line.priceReferenceCode,
        line.policyPercent,
        line.discountPercent,
        line.cappedAt,
        line.overridden,
        line.overrideUnitPrice,
        line.overrideDiscountPercent,
        line.unitPrice,
        line.grossAmount,
        line.discountAmount,
        line.vatRate,
        line.lineAmount,
        line.vatAmount,
        line.lineTotal,
        line.estUnitCost,
        line.estCost,
        line.margin,
        actorId,
      ],
    );
    for (const policy of line.appliedPolicies) {
      await client.query(
        `INSERT INTO crm_schema.quote_line_policies (line_id, policy_id, code, name, stacking, exclusive, percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [line.id, policy.policyId, policy.code, policy.name, policy.stacking, policy.exclusive, policy.percent],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

async function readHead(client: CrmSqlClient, scope: CrmDataScope, id: string): Promise<HeadRow | undefined> {
  const where = new SqlConditions();
  where.add(`q.id = ${where.param(id)}::uuid`);
  where.scope(scope, 'q.owner_user_id');
  const result = await client.query<HeadRow>(`SELECT ${HEAD_COLUMNS} ${HEAD_FROM} ${where.where()}`, where.params);
  return result.rows[0];
}

async function readVersion(client: CrmSqlClient, quoteId: string, versionNo: number): Promise<QuoteVersion | undefined> {
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM crm_schema.quote_versions WHERE quote_id = $1 AND version_no = $2`,
    [quoteId, versionNo],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const lines = await client.query<LineRow>(
    `SELECT * FROM crm_schema.quote_lines WHERE version_id = $1 ORDER BY line_no`,
    [row.id],
  );
  const policies = await client.query<PolicyRow>(
    `SELECT p.line_id, p.policy_id, p.code, p.name, p.stacking, p.exclusive, p.percent
       FROM crm_schema.quote_line_policies p
       JOIN crm_schema.quote_lines l ON l.id = p.line_id
      WHERE l.version_id = $1
      ORDER BY p.code`,
    [row.id],
  );
  const byLine = new Map<string, AppliedDiscountPolicy[]>();
  for (const policy of policies.rows) {
    byLine.set(policy.line_id, [
      ...(byLine.get(policy.line_id) ?? []),
      {
        policyId: policy.policy_id,
        code: policy.code,
        name: policy.name,
        stacking: policy.stacking,
        exclusive: policy.exclusive,
        percent: num(policy.percent),
      },
    ]);
  }
  return toVersion(row, lines.rows.map((line) => toLine(line, byLine.get(line.id) ?? [])));
}

function toSummary(row: HeadRow): QuoteSummary {
  return {
    id: row.id,
    code: row.code,
    opportunityId: row.opportunity_id,
    opportunityName: row.opportunity_name,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    ownerUserId: row.owner_user_id,
    status: row.status,
    currentVersion: row.current_version,
    validUntil: toDateOnly(row.valid_until),
    totalAmount: num(row.total_amount),
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toVersion(row: VersionRow, lines: QuoteLine[]): QuoteVersion {
  return {
    id: row.id,
    versionNo: row.version_no,
    status: row.status,
    revision: row.revision,
    validUntil: toDateOnly(row.valid_until),
    priceDate: toDateOnly(row.price_date),
    pricedOn: toDateOnly(row.priced_on),
    note: row.note,
    shipping: { amount: num(row.shipping_amount), vatRate: num(row.shipping_vat_rate), cost: num(row.shipping_cost) },
    totals: {
      grossAmount: num(row.gross_amount),
      discountAmount: num(row.discount_amount),
      netAmount: num(row.net_amount),
      shippingAmount: num(row.shipping_amount),
      vatAmount: num(row.vat_amount),
      totalAmount: num(row.total_amount),
      estCost: num(row.est_cost),
      profit: num(row.profit),
      marginPercent: toNumber(row.margin_percent),
      discountPercent: num(row.discount_percent),
    },
    requiresApproval: row.requires_approval,
    approvalReasons: row.approval_reasons ?? [],
    submittedAt: toIso(row.submitted_at),
    submittedBy: row.submitted_by,
    approvedAt: toIso(row.approved_at),
    approvedBy: row.approved_by,
    rejectedAt: toIso(row.rejected_at),
    rejectedBy: row.rejected_by,
    decisionReason: row.decision_reason,
    sentAt: toIso(row.sent_at),
    respondedAt: toIso(row.responded_at),
    supersededAt: toIso(row.superseded_at),
    createdAt: toIso(row.created_at) ?? '',
    lines,
  };
}

function toLine(row: LineRow, policies: AppliedDiscountPolicy[]): QuoteLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    materialKind: row.material_kind,
    category: row.category,
    quantity: num(row.quantity),
    listPrice: num(row.list_price),
    priceSource: row.price_source,
    priceReferenceCode: row.price_reference_code,
    appliedPolicies: policies,
    policyPercent: num(row.policy_percent),
    discountPercent: num(row.discount_percent),
    cappedAt: toNumber(row.capped_at),
    overridden: row.overridden,
    overrideUnitPrice: toNumber(row.override_unit_price),
    overrideDiscountPercent: toNumber(row.override_discount_percent),
    unitPrice: num(row.unit_price),
    grossAmount: num(row.gross_amount),
    discountAmount: num(row.discount_amount),
    vatRate: num(row.vat_rate),
    lineAmount: num(row.line_amount),
    vatAmount: num(row.vat_amount),
    lineTotal: num(row.line_total),
    estUnitCost: toNumber(row.est_unit_cost),
    estCost: num(row.est_cost),
    margin: toNumber(row.margin),
    availableStock: null,
  };
}
