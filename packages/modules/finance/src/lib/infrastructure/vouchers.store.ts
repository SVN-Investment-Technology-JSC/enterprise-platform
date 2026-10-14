import {
  FINANCE_VOUCHER_STATUSES,
  financeIncludedTax,
  formatFinanceVoucherCode,
  type FinanceVoucherAttachment,
  type FinanceVoucherEvent,
  type FinanceVoucherEventAction,
  type FinanceVoucherInvoice,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherListQuery,
  type FinanceVoucherRelated,
  type FinanceVoucherStatus,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { approvableKinds, canReadAll, type FinanceActor } from '../domain/finance.access.js';
import { conflict, invalid, notFound } from '../domain/finance.error.js';
import { isValidDate, type NormalizedVoucher } from '../domain/voucher.rules.js';
import { dateOnly, iso, num, optStr, type Db } from './finance.database.js';

export type Row = QueryResultRow & Record<string, unknown>;

export const VOUCHER_SELECT = `
  SELECT v.*, r.name AS reason_name, a.name AS account_name, d.name AS dest_account_name,
         g.name AS group_name, c.name AS cost_center_name
    FROM finance_schema.vouchers v
    LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id
    LEFT JOIN finance_schema.accounts a ON a.id = v.account_id
    LEFT JOIN finance_schema.accounts d ON d.id = v.dest_account_id
    LEFT JOIN finance_schema.counterparty_groups g ON g.id = v.counterparty_group_id
    LEFT JOIN finance_schema.cost_centers c ON c.id = v.cost_center_id`;

export function mapSummary(row: Row): FinanceVoucherSummary {
  return {
    id: String(row.id),
    kind: row.kind as FinanceVoucherKind,
    code: String(row.code),
    voucherDate: dateOnly(row.voucher_date),
    postingDate: dateOnly(row.posting_date),
    content: String(row.content),
    reasonId: optStr(row.reason_id),
    reasonName: optStr(row.reason_name),
    accountId: optStr(row.account_id),
    accountName: optStr(row.account_name),
    destAccountId: optStr(row.dest_account_id),
    destAccountName: optStr(row.dest_account_name),
    counterpartyGroupName: optStr(row.group_name),
    counterpartyName: optStr(row.counterparty_name),
    totalAmount: num(row.total_amount),
    status: row.status as FinanceVoucherStatus,
    createdBy: String(row.created_by),
    createdByName: optStr(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    approvalMode: row.approval_mode as FinanceVoucherSummary['approvalMode'],
  };
}

/** Cấp mã phiếu kế tiếp, tăng nguyên tử trong cùng giao dịch tạo phiếu. */
async function allocateCode(db: Db, tenantId: string, kind: FinanceVoucherKind, voucherDate: string): Promise<string> {
  const row = (
    await db.query(
      `INSERT INTO finance_schema.counters (tenant_id, kind, last_value) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET last_value = finance_schema.counters.last_value + 1
       RETURNING last_value`,
      [tenantId, kind],
    )
  ).rows[0] as Row;
  return formatFinanceVoucherCode(kind, num(row.last_value), voucherDate);
}

/** Mã phiếu kế tiếp dự kiến, để form hiện trước khi lưu (không giữ chỗ). */
export async function peekNextCode(db: Db, tenantId: string, kind: FinanceVoucherKind, voucherDate: string): Promise<string> {
  const row = (await db.query(`SELECT last_value FROM finance_schema.counters WHERE tenant_id=$1 AND kind=$2`, [tenantId, kind])).rows[0] as Row | undefined;
  return formatFinanceVoucherCode(kind, num(row?.last_value) + 1, voucherDate);
}

/** Mọi id tham chiếu phải thuộc tenant: khoá ngoại không kiểm tenant_id. */
async function assertReferences(db: Db, tenantId: string, v: NormalizedVoucher): Promise<void> {
  const checks: [string, string | null, string][] = [
    ['accounts', v.accountId, 'Tài khoản'],
    ['accounts', v.destAccountId, 'Tài khoản đích'],
    ['reasons', v.reasonId, 'Lý do'],
    ['counterparty_groups', v.counterpartyGroupId, 'Đối tượng'],
    ['cost_centers', v.costCenterId, 'Đơn vị hạch toán'],
  ];
  for (const [table, id, label] of checks) {
    if (!id) continue;
    const found = await db.query(`SELECT 1 FROM finance_schema.${table} WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    if (!found.rows.length) throw invalid(`${label} không tồn tại.`);
  }
  for (const related of v.related) {
    if (related.kind !== 'VOUCHER' || !related.voucherId) continue;
    const found = await db.query(`SELECT 1 FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, related.voucherId]);
    if (!found.rows.length) throw invalid('Phiếu liên quan không tồn tại.');
  }
}

async function replaceChildren(db: Db, tenantId: string, voucherId: string, v: NormalizedVoucher): Promise<void> {
  await db.query(`DELETE FROM finance_schema.voucher_lines WHERE voucher_id=$1`, [voucherId]);
  await db.query(`DELETE FROM finance_schema.voucher_invoices WHERE voucher_id=$1`, [voucherId]);
  await db.query(`DELETE FROM finance_schema.voucher_related WHERE voucher_id=$1`, [voucherId]);
  for (const line of v.lines)
    await db.query(
      `INSERT INTO finance_schema.voucher_lines (tenant_id, voucher_id, line_no, description, quantity, unit_amount, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, voucherId, line.lineNo, line.description, line.quantity, line.unitAmount, line.total],
    );
  for (const invoice of v.invoices)
    await db.query(
      `INSERT INTO finance_schema.voucher_invoices (tenant_id, voucher_id, invoice_no, invoice_date, tax_code, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, voucherId, invoice.invoiceNo, invoice.invoiceDate, invoice.taxCode, invoice.amount],
    );
  for (const related of v.related) {
    if (related.voucherId === voucherId) throw invalid('Phiếu không thể liên quan tới chính nó.');
    await db.query(
      `INSERT INTO finance_schema.voucher_related (tenant_id, voucher_id, kind, related_voucher_id, label) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, voucherId, related.kind, related.voucherId, related.label],
    );
  }
}

export async function addEvent(
  db: Db,
  tenantId: string,
  voucherId: string,
  action: FinanceVoucherEventAction,
  actor: Pick<FinanceActor, 'userId' | 'displayName'> | null,
  note?: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO finance_schema.voucher_events (tenant_id, voucher_id, action, actor_id, actor_name, note) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, voucherId, action, actor?.userId ?? null, actor?.displayName ?? null, note?.trim() || null],
  );
}

export async function createVoucher(db: Db, tenantId: string, actor: FinanceActor, v: NormalizedVoucher): Promise<string> {
  await assertReferences(db, tenantId, v);
  const code = await allocateCode(db, tenantId, v.kind, v.voucherDate);
  const row = (
    await db.query(
      `INSERT INTO finance_schema.vouchers
         (tenant_id, kind, code, voucher_date, posting_date, content, reason_id, account_id, dest_account_id, counterparty_group_id,
          counterparty_name, counterparty_account_no, counterparty_bank, cost_center_id, tax_included, tax_rate, total_amount, note,
          created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        tenantId, v.kind, code, v.voucherDate, v.postingDate, v.content, v.reasonId, v.accountId, v.destAccountId, v.counterpartyGroupId,
        v.counterpartyName, v.counterpartyAccountNo, v.counterpartyBank, v.costCenterId, v.taxIncluded, v.taxRate, v.totalAmount, v.note,
        actor.userId, actor.displayName,
      ],
    )
  ).rows[0] as Row;
  const id = String(row.id);
  await replaceChildren(db, tenantId, id, v);
  await addEvent(db, tenantId, id, 'CREATED', actor);
  return id;
}

/** Sửa phiếu: chỉ chủ phiếu, chỉ khi còn nháp hoặc bị từ chối. Sửa phiếu bị từ chối đưa nó về nháp để gửi lại. */
export async function updateVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  id: string,
  v: NormalizedVoucher,
  revision: number | undefined,
): Promise<void> {
  const current = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  if (!current || current.created_by !== actor.userId) throw notFound('phiếu');
  if (current.kind !== v.kind) throw invalid('Không đổi được loại phiếu.');
  if (current.status !== 'DRAFT' && current.status !== 'REJECTED')
    throw conflict('FINANCE_VOUCHER_LOCKED', 'Chỉ sửa được phiếu ở trạng thái nháp hoặc bị từ chối.');
  if (revision !== undefined && revision !== num(current.revision))
    throw conflict('FINANCE_REVISION_CONFLICT', 'Phiếu đã được thay đổi bởi lần lưu khác; tải lại trước khi sửa.');
  await assertReferences(db, tenantId, v);
  await db.query(
    `UPDATE finance_schema.vouchers SET voucher_date=$3, posting_date=$4, content=$5, reason_id=$6, account_id=$7, dest_account_id=$8,
            counterparty_group_id=$9, counterparty_name=$10, counterparty_account_no=$11, counterparty_bank=$12, cost_center_id=$13,
            tax_included=$14, tax_rate=$15, total_amount=$16, note=$17, status='DRAFT', revision=revision+1,
            submitted_at=NULL, submitted_by=NULL, decided_at=NULL, decided_by=NULL, decided_by_name=NULL, decision_note=NULL, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [
      tenantId, id, v.voucherDate, v.postingDate, v.content, v.reasonId, v.accountId, v.destAccountId, v.counterpartyGroupId,
      v.counterpartyName, v.counterpartyAccountNo, v.counterpartyBank, v.costCenterId, v.taxIncluded, v.taxRate, v.totalAmount, v.note,
    ],
  );
  await replaceChildren(db, tenantId, id, v);
  await addEvent(db, tenantId, id, 'UPDATED', actor, current.status === 'REJECTED' ? 'Sửa phiếu bị từ chối' : null);
}

export async function deleteDraft(db: Db, tenantId: string, actor: FinanceActor, id: string): Promise<void> {
  const current = (await db.query(`SELECT created_by, status FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  if (!current || current.created_by !== actor.userId) throw notFound('phiếu');
  if (current.status !== 'DRAFT') throw conflict('FINANCE_VOUCHER_LOCKED', 'Chỉ xoá được phiếu nháp; phiếu đã gửi duyệt thì huỷ.');
  await db.query(`DELETE FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
}

export interface VoucherRecord {
  row: Row;
  lines: Row[];
  invoices: Row[];
  related: Row[];
  attachments: Row[];
  events: Row[];
}

export async function loadVoucherRecord(db: Db, tenantId: string, id: string): Promise<VoucherRecord> {
  const row = (await db.query(`${VOUCHER_SELECT} WHERE v.tenant_id = $1 AND v.id = $2`, [tenantId, id])).rows[0] as Row | undefined;
  if (!row) throw notFound('phiếu');
  const [lines, invoices, related, attachments, events] = await Promise.all([
    db.query(`SELECT * FROM finance_schema.voucher_lines WHERE voucher_id=$1 ORDER BY line_no`, [id]),
    db.query(`SELECT * FROM finance_schema.voucher_invoices WHERE voucher_id=$1 ORDER BY invoice_no`, [id]),
    db.query(
      `SELECT rel.*, t.code AS target_code FROM finance_schema.voucher_related rel
         LEFT JOIN finance_schema.vouchers t ON t.id = rel.related_voucher_id WHERE rel.voucher_id=$1 ORDER BY rel.label`,
      [id],
    ),
    db.query(`SELECT * FROM finance_schema.voucher_attachments WHERE voucher_id=$1 AND deleted_at IS NULL AND status='READY' ORDER BY uploaded_at`, [id]),
    db.query(`SELECT * FROM finance_schema.voucher_events WHERE voucher_id=$1 ORDER BY created_at, id`, [id]),
  ]);
  return {
    row,
    lines: lines.rows as Row[],
    invoices: invoices.rows as Row[],
    related: related.rows as Row[],
    attachments: attachments.rows as Row[],
    events: events.rows as Row[],
  };
}

export const mapLine = (row: Row) => ({
  id: String(row.id),
  lineNo: num(row.line_no),
  description: String(row.description),
  quantity: num(row.quantity),
  unitAmount: num(row.unit_amount),
  total: num(row.total),
});
export const mapInvoice = (row: Row): FinanceVoucherInvoice => ({
  id: String(row.id),
  invoiceNo: String(row.invoice_no),
  invoiceDate: row.invoice_date ? dateOnly(row.invoice_date) : null,
  taxCode: optStr(row.tax_code),
  amount: num(row.amount),
});
export const mapRelated = (row: Row): FinanceVoucherRelated => ({
  id: String(row.id),
  kind: row.kind as FinanceVoucherRelated['kind'],
  voucherId: optStr(row.related_voucher_id),
  label: String(row.label),
});
export const mapAttachment = (row: Row): FinanceVoucherAttachment => ({
  id: String(row.id),
  fileName: String(row.file_name),
  contentType: String(row.content_type),
  sizeBytes: num(row.size_bytes),
  uploadedBy: optStr(row.uploaded_by),
  uploadedByName: optStr(row.uploaded_by_name),
  uploadedAt: iso(row.uploaded_at),
});
export const mapEvent = (row: Row): FinanceVoucherEvent => ({
  id: String(row.id),
  action: row.action as FinanceVoucherEventAction,
  actorId: optStr(row.actor_id),
  actorName: optStr(row.actor_name),
  note: optStr(row.note),
  createdAt: iso(row.created_at),
});

export function taxAmountOf(row: Row): number {
  return row.tax_included ? financeIncludedTax(num(row.total_amount), num(row.tax_rate)) : 0;
}

/** Người xem có được thấy phiếu này không: chủ phiếu, người đọc toàn bộ, hoặc người duyệt loại phiếu đó. */
export function canViewVoucher(actor: FinanceActor, row: Row): boolean {
  return (
    canReadAll(actor) ||
    row.created_by === actor.userId ||
    approvableKinds(actor).includes(row.kind as FinanceVoucherKind)
  );
}

const PAGE_SIZES = [10, 20, 50, 100];

export async function listVouchers(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  query: FinanceVoucherListQuery,
  allowSelfApproval: boolean,
): Promise<FinanceVoucherList> {
  const params: unknown[] = [tenantId, query.kind];
  const where: string[] = ['v.tenant_id = $1', 'v.kind = $2'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  // Phạm vi xem: người đọc toàn bộ hoặc duyệt loại này thấy hết; còn lại chỉ phiếu của mình.
  if (!canReadAll(actor) && !approvableKinds(actor).includes(query.kind)) add('v.created_by = ?', actor.userId);
  if (query.scope === 'mine') add('v.created_by = ?', actor.userId);
  if (query.scope === 'to-approve') {
    where.push(`v.status = 'PENDING'`);
    if (!approvableKinds(actor).includes(query.kind)) where.push('FALSE');
    else if (!allowSelfApproval) add('v.created_by <> ?', actor.userId);
  }
  if (query.accountId) {
    params.push(query.accountId);
    where.push(`(v.account_id = $${params.length} OR v.dest_account_id = $${params.length})`);
  }
  if (query.reasonId) add('v.reason_id = ?', query.reasonId);
  if (query.costCenterId) add('v.cost_center_id = ?', query.costCenterId);
  if (query.from) {
    if (!isValidDate(query.from)) throw invalid('Từ ngày không hợp lệ.');
    add('v.voucher_date >= ?::date', query.from);
  }
  if (query.to) {
    if (!isValidDate(query.to)) throw invalid('Đến ngày không hợp lệ.');
    add('v.voucher_date <= ?::date', query.to);
  }
  const search = query.search?.trim();
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    where.push(
      `(v.code ILIKE ${p} OR v.content ILIKE ${p} OR v.counterparty_name ILIKE ${p} OR v.created_by_name ILIKE ${p} OR r.name ILIKE ${p})`,
    );
  }
  const base = where.join(' AND ');
  const joined = `FROM finance_schema.vouchers v LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id`;

  const statusCounts = Object.fromEntries(FINANCE_VOUCHER_STATUSES.map((s) => [s, 0])) as Record<FinanceVoucherStatus, number>;
  const counts = (await db.query(`SELECT v.status, count(*)::int AS n, COALESCE(SUM(v.total_amount) FILTER (WHERE v.status='APPROVED'),0) AS approved_total ${joined} WHERE ${base} GROUP BY v.status`, params)).rows as Row[];
  let approvedTotal = 0;
  for (const row of counts) {
    statusCounts[row.status as FinanceVoucherStatus] = num(row.n);
    approvedTotal += num(row.approved_total);
  }

  if (query.status) {
    if (!FINANCE_VOUCHER_STATUSES.includes(query.status)) throw invalid('Trạng thái không hợp lệ.');
    add('v.status = ?', query.status);
  }
  const filtered = where.join(' AND ');
  const total = query.status ? statusCounts[query.status] : Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const pageSize = PAGE_SIZES.includes(Math.trunc(query.pageSize ?? 20)) ? Math.trunc(query.pageSize ?? 20) : 20;
  const page = Math.max(Math.trunc(query.page ?? 1), 1);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = (
    await db.query(
      `${VOUCHER_SELECT} WHERE v.id IN (
         SELECT v.id ${joined} WHERE ${filtered}
          ORDER BY v.voucher_date DESC, v.created_at DESC, v.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}
       ) ORDER BY v.voucher_date DESC, v.created_at DESC, v.id DESC`,
      params,
    )
  ).rows as Row[];
  return { items: rows.map(mapSummary), total, page, pageSize, statusCounts, approvedTotal };
}
