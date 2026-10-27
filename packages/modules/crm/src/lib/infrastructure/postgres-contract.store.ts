import {
  CONTRACT_STATUS_LABELS,
  DEFAULT_CONTRACT_EXPIRING_DAYS,
  DEFAULT_RESERVATION_HOLD_DAYS,
  type ContractDetail,
  type ContractLine,
  type ContractOrderRef,
  type ContractStatus,
  type ContractSummary,
  type ContractType,
  type CrmHistoryEntry,
  type CrmPage,
  type CrmReservationStatus,
  type PaymentTerm,
  type PaymentTermCondition,
  type PaymentTermStatus,
} from '@enterprise-platform/contracts-crm';
import type {
  ContractFilter,
  ContractLineRecord,
  ContractRecord,
  ContractStore,
  ContractTransition,
  SalesSettingsStore,
} from '../application/contract-store.port.js';
import type { CrmDataScope } from '../application/data-scope.js';
import type { ReservedStock } from '../application/fulfillment.port.js';
import { formatContractCode } from '../domain/contract.js';
import { CrmConflictError } from '../domain/crm.error.js';
import type { PaymentTermDraft } from '../domain/payment-terms.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { enqueueReservationRelease } from './integration-requests.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toDateOnly, toIso, toNumber } from './sql-helpers.js';

/** Thực thể ghi vào `audit_log`. */
export const CONTRACT_AUDIT_ENTITY = 'contract';
/** Khoá cấu hình (notification-worker đọc cùng khoá). */
export const CONTRACT_EXPIRING_SETTING_KEY = 'contract.expiring';
export const RESERVATION_HOLD_SETTING_KEY = 'reservation.holdDays';

const STALE = () =>
  new CrmConflictError('STALE_VERSION', 'Hợp đồng vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface HeadRow {
  id: string;
  code: string;
  type: ContractType;
  title: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  status: ContractStatus;
  valid_from: string;
  valid_to: string | null;
  value: string;
  owner_user_id: string;
  quote_id: string | null;
  quote_code: string | null;
  signed_date: string | null;
  warranty_months: number | null;
  warehouse_code: string | null;
  note: string | null;
  revision: number;
  reservation_id: string | null;
  reservation_code: string | null;
  reservation_status: CrmReservationStatus | null;
  reservation_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

const HEAD_COLUMNS = `
  k.id, k.code, k.type, k.title, k.customer_id, c.code AS customer_code, c.name AS customer_name, k.status,
  k.valid_from::text AS valid_from, k.valid_to::text AS valid_to, k.value, k.owner_user_id, k.quote_id,
  q.code AS quote_code, k.signed_date::text AS signed_date, k.warranty_months, k.warehouse_code, k.note, k.revision,
  k.reservation_id, k.reservation_code, k.reservation_status, k.reservation_expires_at, k.created_at, k.updated_at,
  ${cursorAt('k.updated_at')} AS cursor_at`;

const HEAD_FROM = `
  FROM crm_schema.contracts k
  JOIN crm_schema.customers c ON c.id = k.customer_id
  LEFT JOIN crm_schema.quotes q ON q.id = k.quote_id`;

export class PostgresContractStore implements ContractStore {
  constructor(private readonly database: CrmDatabase) {}

  async listContracts(tenantId: string, scope: CrmDataScope, filter: ContractFilter): Promise<CrmPage<ContractSummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'k.owner_user_id');
    if (filter.status) where.add(`k.status = ${where.param(filter.status)}`);
    if (filter.type) where.add(`k.type = ${where.param(filter.type)}`);
    if (filter.customerId) where.add(`k.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.ownerUserId) where.add(`k.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.expiring) {
      where.add(
        `k.status = 'ACTIVE' AND k.valid_to BETWEEN ${where.param(filter.expiring.today)}::date AND ${where.param(filter.expiring.until)}::date`,
      );
    }
    if (filter.q) {
      const tsQuery = prefixTsQuery(filter.q);
      const code = `k.code ILIKE ${where.param(prefixPattern(filter.q.toUpperCase()))}`;
      where.add(
        tsQuery
          ? `(${code} OR to_tsvector('simple'::regconfig, c.name || ' ' || k.title) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)}))`
          : code,
      );
    }
    where.after(filter.cursor, 'k.updated_at', 'k.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<HeadRow>(
      `SELECT ${HEAD_COLUMNS} ${HEAD_FROM} ${where.where()}
        ORDER BY k.updated_at DESC, k.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async getContract(tenantId: string, scope: CrmDataScope, id: string): Promise<ContractDetail | undefined> {
    const pool = await this.database.pool(tenantId);
    const where = new SqlConditions();
    where.add(`k.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'k.owner_user_id');
    const head = (await pool.query<HeadRow>(`SELECT ${HEAD_COLUMNS} ${HEAD_FROM} ${where.where()}`, where.params)).rows[0];
    if (!head) return undefined;
    const [lines, terms, orders, history] = await Promise.all([
      pool.query<LineRow>(`SELECT * FROM crm_schema.contract_lines WHERE contract_id = $1 ORDER BY line_no`, [id]),
      pool.query<TermRow>(
        `SELECT id, seq, name, percent, amount, condition, due_date::text AS due_date, due_days, status, note
           FROM crm_schema.contract_payment_terms WHERE contract_id = $1 ORDER BY seq`,
        [id],
      ),
      pool.query<{ id: string; code: string; status: string; total_amount: string; order_date: string }>(
        `SELECT id, code, status, total_amount, order_date::text AS order_date FROM crm_schema.sales_orders
          WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [id],
      ),
      readHistory(pool, CONTRACT_AUDIT_ENTITY, id),
    ]);
    return {
      ...toSummary(head),
      signedDate: toDateOnly(head.signed_date),
      warrantyMonths: head.warranty_months,
      warehouseCode: head.warehouse_code,
      note: head.note,
      revision: head.revision,
      lines: lines.rows.map(toLine),
      paymentTerms: terms.rows.map(toTerm),
      reservation:
        head.reservation_id && head.reservation_code && head.reservation_status
          ? {
              reservationId: head.reservation_id,
              reservationCode: head.reservation_code,
              status: head.reservation_status,
              expiresAt: toIso(head.reservation_expires_at),
            }
          : null,
      orders: orders.rows.map(
        (row): ContractOrderRef => ({
          id: row.id,
          code: row.code,
          status: row.status,
          totalAmount: num(row.total_amount),
          orderDate: row.order_date,
        }),
      ),
      history,
      createdAt: toIso(head.created_at) ?? '',
    };
  }

  createContract(tenantId: string, record: ContractRecord, lines: readonly ContractLineRecord[], actorId: string): Promise<string> {
    return this.database.transaction(tenantId, (client) => insertContract(client, record, lines, null, actorId));
  }

  updateContract(
    tenantId: string,
    id: string,
    revision: number,
    record: ContractRecord,
    lines: readonly ContractLineRecord[] | undefined,
    terms: readonly PaymentTermDraft[] | undefined,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      await lockContract(client, id, revision, 'DRAFT');
      await client.query(
        `UPDATE crm_schema.contracts
            SET type = $2, customer_id = $3, title = $4, signed_date = $5, valid_from = $6, valid_to = $7, value = $8,
                warranty_months = $9, warehouse_code = $10, owner_user_id = $11, note = $12, revision = revision + 1,
                updated_at = now(), updated_by = $13
          WHERE id = $1`,
        [id, ...recordValues(record), actorId],
      );
      if (lines) {
        await client.query(`DELETE FROM crm_schema.contract_lines WHERE contract_id = $1`, [id]);
        await insertLines(client, id, lines);
      }
      if (terms) await replaceTerms(client, id, terms);
    });
  }

  savePaymentTerms(tenantId: string, id: string, revision: number, terms: readonly PaymentTermDraft[], actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      await lockContract(client, id, revision, 'DRAFT');
      await replaceTerms(client, id, terms);
      await client.query(
        `UPDATE crm_schema.contracts SET revision = revision + 1, updated_at = now(), updated_by = $2 WHERE id = $1`,
        [id, actorId],
      );
    });
  }

  confirm(tenantId: string, id: string, revision: number, reservation: ReservedStock | null, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockContract(client, id, revision, 'DRAFT');
      await client.query(
        `UPDATE crm_schema.contracts
            SET status = 'ACTIVE', confirmed_at = now(), confirmed_by = $2, reservation_id = $3, reservation_code = $4,
                reservation_status = CASE WHEN $4::varchar IS NULL THEN NULL ELSE 'HELD' END, reservation_expires_at = $5,
                revision = revision + 1, updated_at = now(), updated_by = $2
          WHERE id = $1`,
        [id, actorId, reservation?.reservationId ?? null, reservation?.reservationCode ?? null, reservation?.expiresAt ?? null],
      );
      await writeAuditLog(client, {
        entityType: CONTRACT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: 'DRAFT',
        toStatus: 'ACTIVE',
        action: 'confirm',
        actorId,
        metadata: { code: locked.code, ...(reservation ? { reservationCode: reservation.reservationCode } : {}) },
      });
    });
  }

  transition(tenantId: string, id: string, revision: number, transition: ContractTransition, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockContract(client, id, revision, transition.from);
      await client.query(
        `UPDATE crm_schema.contracts
            SET status = $2, closed_at = now(), close_reason = $3, revision = revision + 1, updated_at = now(), updated_by = $4
          WHERE id = $1`,
        [id, transition.to, transition.reason, actorId],
      );
      if (transition.to === 'CANCELLED' && locked.reservationStatus === 'HELD' && locked.reservationCode) {
        await releaseContractReservation(client, id, locked.reservationCode, `Huỷ hợp đồng ${locked.code}`);
      }
      await writeAuditLog(client, {
        entityType: CONTRACT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: transition.from,
        toStatus: transition.to,
        action: transition.action,
        actorId,
        reason: transition.reason,
        metadata: { code: locked.code },
      });
    });
  }

  async reserveAttempt(tenantId: string, id: string): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ reserve_attempt: number }>(`SELECT reserve_attempt FROM crm_schema.contracts WHERE id = $1`, [id]);
    return result.rows[0]?.reserve_attempt ?? 1;
  }

  async bumpReserveAttempt(tenantId: string, id: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(`UPDATE crm_schema.contracts SET reserve_attempt = reserve_attempt + 1 WHERE id = $1`, [id]);
  }

  async hasDeliveredOrders(tenantId: string, id: string): Promise<boolean> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ delivered: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM crm_schema.sales_order_lines l
           JOIN crm_schema.sales_orders o ON o.id = l.order_id
          WHERE o.contract_id = $1 AND o.status <> 'CANCELLED' AND l.delivered_quantity > 0) AS delivered`,
      [id],
    );
    return result.rows[0]?.delivered === true;
  }

  expireDue(tenantId: string, today: string, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      const due = await client.query<{ id: string; code: string; valid_to: string }>(
        `SELECT id, code, valid_to::text AS valid_to FROM crm_schema.contracts
          WHERE status = 'ACTIVE' AND valid_to IS NOT NULL AND valid_to < $1::date
          ORDER BY valid_to, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [today, limit],
      );
      for (const row of due.rows) {
        await client.query(
          `UPDATE crm_schema.contracts SET status = 'EXPIRED', revision = revision + 1, updated_at = now() WHERE id = $1`,
          [row.id],
        );
        await writeAuditLog(client, {
          entityType: CONTRACT_AUDIT_ENTITY,
          entityId: row.id,
          fromStatus: 'ACTIVE',
          toStatus: 'EXPIRED',
          action: 'expire',
          actorId: null,
          reason: `Quá ngày kết thúc ${row.valid_to.split('-').reverse().join('/')}`,
          metadata: { code: row.code },
        });
      }
      return due.rows.length;
    });
  }
}

/** Cấu hình GĐ4 trong `crm_schema.settings`. */
export class PostgresSalesSettingsStore implements SalesSettingsStore {
  constructor(private readonly database: CrmDatabase) {}

  async reservationHoldDays(tenantId: string): Promise<number> {
    return parseDays(await this.read(tenantId, RESERVATION_HOLD_SETTING_KEY), DEFAULT_RESERVATION_HOLD_DAYS);
  }

  async contractExpiringDays(tenantId: string): Promise<number> {
    return parseDays(await this.read(tenantId, CONTRACT_EXPIRING_SETTING_KEY), DEFAULT_CONTRACT_EXPIRING_DAYS);
  }

  async save(tenantId: string, settings: { reservationHoldDays: number; contractExpiringDays: number }, actorId: string): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      for (const [key, days] of [
        [RESERVATION_HOLD_SETTING_KEY, settings.reservationHoldDays],
        [CONTRACT_EXPIRING_SETTING_KEY, settings.contractExpiringDays],
      ] as const) {
        await client.query(
          `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
                 updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify({ days }), actorId],
        );
      }
    });
  }

  private async read(tenantId: string, key: string): Promise<unknown> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [key]);
    return result.rows[0]?.value;
  }
}

/** Số ngày từ giá trị cấu hình `{ days }`; không hợp lệ thì mặc định. */
export function parseDays(value: unknown, fallback: number): number {
  const days = Number((value as { days?: unknown } | null | undefined)?.days);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : fallback;
}

// ---------------------------------------------------------------------------
// Ghi trong transaction của bên gọi
// ---------------------------------------------------------------------------

/** Tạo hợp đồng Nháp cùng dòng và nhật ký trong transaction của bên gọi (tạo tay, chuyển báo giá). Trả id. */
export async function insertContract(
  client: CrmSqlClient,
  record: ContractRecord,
  lines: readonly ContractLineRecord[],
  quoteId: string | null,
  actorId: string,
): Promise<string> {
  const sequence = await client.query<{ seq: string; year: number }>(
    `SELECT nextval('crm_schema.contract_code_seq') AS seq,
            extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS year`,
  );
  const code = formatContractCode(sequence.rows[0].year, Number(sequence.rows[0].seq));
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.contracts
       (code, type, customer_id, title, signed_date, valid_from, valid_to, value, warranty_months, warehouse_code,
        owner_user_id, note, quote_id, created_by, updated_by)
     VALUES ($14, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     RETURNING id`,
    [...recordValues(record), quoteId, actorId, code],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('crm_schema.contracts insert returned no row.');
  await insertLines(client, id, lines);
  await writeAuditLog(client, {
    entityType: CONTRACT_AUDIT_ENTITY,
    entityId: id,
    fromStatus: null,
    toStatus: 'DRAFT',
    action: 'create',
    actorId,
    metadata: { code, ...(quoteId ? { quoteId } : {}) },
  });
  return id;
}

/**
 * Nhả phần giữ của hợp đồng: xếp lệnh nhả sang Kho, đánh dấu hợp đồng và dòng
 * đơn đang dùng phần giữ này là Đã nhả.
 */
async function releaseContractReservation(client: CrmSqlClient, contractId: string, reservationCode: string, reason: string) {
  await enqueueReservationRelease(client, reservationCode, reason);
  await client.query(`UPDATE crm_schema.contracts SET reservation_status = 'RELEASED' WHERE id = $1`, [contractId]);
  await client.query(
    `UPDATE crm_schema.sales_order_lines
        SET reservation_status = 'RELEASED', reserved_quantity = 0, updated_at = now()
      WHERE reservation_code = $1 AND reservation_source = 'CONTRACT' AND reservation_status = 'HELD'`,
    [reservationCode],
  );
}

interface LockedContract {
  readonly code: string;
  readonly status: ContractStatus;
  readonly reservationCode: string | null;
  readonly reservationStatus: CrmReservationStatus | null;
}

/** Khoá hợp đồng rồi so trạng thái và `revision` service đã đọc. */
async function lockContract(
  client: CrmSqlClient,
  id: string,
  revision: number,
  requiredStatus: ContractStatus,
): Promise<LockedContract> {
  const result = await client.query<{
    code: string;
    status: ContractStatus;
    revision: number;
    reservation_code: string | null;
    reservation_status: CrmReservationStatus | null;
  }>(
    `SELECT code, status, revision, reservation_code, reservation_status FROM crm_schema.contracts WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw STALE();
  if (row.status !== requiredStatus) {
    throw new CrmConflictError(
      'INVALID_CONTRACT_TRANSITION',
      `Hợp đồng đang ở trạng thái "${CONTRACT_STATUS_LABELS[row.status]}", không thực hiện được thao tác này.`,
    );
  }
  if (row.revision !== revision) throw STALE();
  return { code: row.code, status: row.status, reservationCode: row.reservation_code, reservationStatus: row.reservation_status };
}

function recordValues(record: ContractRecord): unknown[] {
  return [
    record.type,
    record.customerId,
    record.title,
    record.signedDate,
    record.validFrom,
    record.validTo,
    record.value,
    record.warrantyMonths,
    record.warehouseCode,
    record.ownerUserId,
    record.note,
  ];
}

async function insertLines(client: CrmSqlClient, contractId: string, lines: readonly ContractLineRecord[]) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO crm_schema.contract_lines
         (id, contract_id, line_no, material_id, material_code, material_name, unit, material_kind, quantity, unit_price,
          vat_rate, discount_percent, line_amount, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        line.id,
        contractId,
        line.lineNo,
        line.materialId,
        line.materialCode.slice(0, 100),
        line.materialName.slice(0, 300),
        line.unit,
        line.materialKind.slice(0, 16),
        line.quantity,
        line.unitPrice,
        line.vatRate,
        line.discountPercent,
        line.lineAmount,
        line.note,
      ],
    );
  }
}

async function replaceTerms(client: CrmSqlClient, contractId: string, terms: readonly PaymentTermDraft[]) {
  await client.query(`DELETE FROM crm_schema.contract_payment_terms WHERE contract_id = $1`, [contractId]);
  for (const term of terms) {
    await client.query(
      `INSERT INTO crm_schema.contract_payment_terms
         (contract_id, seq, name, percent, amount, condition, due_date, due_days, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [contractId, term.seq, term.name, term.percent, term.amount, term.condition, term.dueDate, term.dueDays, term.note],
    );
  }
}

/** Nhật ký chuyển trạng thái của một thực thể, mới nhất trước. */
export async function readHistory(client: CrmSqlClient, entityType: string, id: string): Promise<CrmHistoryEntry[]> {
  const result = await client.query<{
    id: string;
    at: Date;
    action: string;
    from_status: string | null;
    to_status: string | null;
    actor_id: string | null;
    reason: string | null;
  }>(
    `SELECT id, at, action, from_status, to_status, actor_id, reason FROM crm_schema.audit_log
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY at DESC, id DESC
      LIMIT 200`,
    [entityType, id],
  );
  return result.rows.map((row) => ({
    id: row.id,
    at: toIso(row.at) ?? '',
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    reason: row.reason,
  }));
}

interface LineRow {
  id: string;
  line_no: number;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  material_kind: string;
  quantity: string | null;
  unit_price: string;
  vat_rate: string;
  discount_percent: string;
  line_amount: string | null;
  note: string | null;
}

interface TermRow {
  id: string;
  seq: number;
  name: string;
  percent: string | null;
  amount: string;
  condition: PaymentTermCondition;
  due_date: string | null;
  due_days: number | null;
  status: PaymentTermStatus;
  note: string | null;
}

function toSummary(row: HeadRow): ContractSummary {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    title: row.title,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    status: row.status,
    validFrom: toDateOnly(row.valid_from) ?? '',
    validTo: toDateOnly(row.valid_to),
    value: num(row.value),
    ownerUserId: row.owner_user_id,
    quoteId: row.quote_id,
    quoteCode: row.quote_code,
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toLine(row: LineRow): ContractLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    materialKind: row.material_kind,
    quantity: toNumber(row.quantity),
    unitPrice: num(row.unit_price),
    vatRate: num(row.vat_rate),
    discountPercent: num(row.discount_percent),
    lineAmount: toNumber(row.line_amount),
    note: row.note,
  };
}

function toTerm(row: TermRow): PaymentTerm {
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    percent: toNumber(row.percent),
    amount: num(row.amount),
    condition: row.condition,
    dueDate: toDateOnly(row.due_date),
    dueDays: row.due_days,
    status: row.status,
    note: row.note,
  };
}
