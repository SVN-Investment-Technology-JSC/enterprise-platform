import {
  FINANCE_VOUCHER_STATUSES,
  financeIncludedTax,
  financePeriodOf,
  formatFinanceDraftCode,
  formatFinanceOfficialCode,
  type FinanceAllocation,
  type FinanceProjectVoucher,
  type FinanceProjectTotals,
  type FinanceProjectVoucherList,
  type FinanceProjectWorkItemTotals,
  type FinanceRelatedProject,
  type FinanceVoucherAttachment,
  type FinanceVoucherEvent,
  type FinanceVoucherEventAction,
  type FinanceVoucherInvoice,
  type FinanceVoucherKind,
  type FinanceVoucherList,
  type FinanceVoucherListQuery,
  type FinanceVoucherStatus,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { approvableKinds, canReadAll, type FinanceActor } from '../domain/finance.access.js';
import { conflict, invalid, notFound } from '../domain/finance.error.js';
import { isValidDate, type NormalizedVoucher } from '../domain/voucher.rules.js';
import { notificationFacts, notifyApprovalRequested } from './finance-notification-events.js';
import { dateOnly, iso, num, optStr, type Db } from './finance.database.js';
import { assertSubmittable } from './voucher-submit-check.js';

export type Row = QueryResultRow & Record<string, unknown>;

export const VOUCHER_SELECT = `
  SELECT v.*, r.name AS reason_name, a.name AS account_name, d.name AS dest_account_name,
         g.name AS group_name, src.instance_code AS source_instance_code
    FROM finance_schema.vouchers v
    LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id
    LEFT JOIN finance_schema.accounts a ON a.id = v.account_id
    LEFT JOIN finance_schema.accounts d ON d.id = v.dest_account_id
    LEFT JOIN finance_schema.counterparty_groups g ON g.id = v.counterparty_group_id
    LEFT JOIN finance_schema.voucher_sources src ON src.voucher_id = v.id`;

/** Hạch toán lưu trên dòng phiếu; null khi chưa hạch toán. */
export function mapAllocation(row: Row): FinanceAllocation | null {
  if (!row.alloc_type) return null;
  return {
    type: row.alloc_type as FinanceAllocation['type'],
    projectId: String(row.alloc_project_id),
    projectCode: String(row.alloc_project_code ?? ''),
    projectName: String(row.alloc_project_name ?? ''),
    workItemId: optStr(row.alloc_work_item_id),
    workItemCode: optStr(row.alloc_work_item_code),
    workItemTitle: optStr(row.alloc_work_item_title),
  };
}

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
    totalAmount: num(row.total_amount),
    status: row.status as FinanceVoucherStatus,
    createdBy: String(row.created_by),
    createdByName: optStr(row.created_by_name),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    approvalMode: row.approval_mode as FinanceVoucherSummary['approvalMode'],
    allocation: mapAllocation(row),
    draftCode: optStr(row.draft_code),
    officialCode: optStr(row.official_code),
    sourceCode: optStr(row.source_instance_code),
  };
}

/** Dự án/công việc đã được Workspace xác nhận (mã, tên) cùng một phiếu; được ghi nguyên văn vào phiếu. */
export interface ResolvedWorkspaceLinks {
  allocation: FinanceAllocation | null;
  relatedProjects: FinanceRelatedProject[];
}

type CodeSeries = 'DRAFT' | 'OFFICIAL';

/**
 * Tăng bộ đếm của một dãy mã trong giao dịch hiện tại. Bộ đếm là dòng bảng (không phải sequence): giao dịch lùi thì số
 * cũng lùi, nên dãy số liền mạch; dòng bộ đếm bị khoá tới hết giao dịch nên hai phiếu cùng kỳ không lấy trùng số.
 */
async function nextSequence(db: Db, tenantId: string, kind: FinanceVoucherKind, series: CodeSeries, period: string): Promise<number> {
  const row = (
    await db.query(
      `INSERT INTO finance_schema.code_counters (tenant_id, kind, series, period, last_value) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (tenant_id, kind, series, period) DO UPDATE SET last_value = finance_schema.code_counters.last_value + 1
       RETURNING last_value`,
      [tenantId, kind, series, period],
    )
  ).rows[0] as Row;
  return num(row.last_value);
}

/** Cấp mã nháp `NHAP_PC_2610_0045` lúc lập phiếu, theo kỳ của ngày hạch toán. */
async function allocateDraftCode(db: Db, tenantId: string, kind: FinanceVoucherKind, postingDate: string): Promise<string> {
  const period = financePeriodOf(postingDate);
  return formatFinanceDraftCode(kind, period, await nextSequence(db, tenantId, kind, 'DRAFT', period));
}

/**
 * Cấp mã chính thức `PC-2610-0045` cho phiếu đang ghi sổ, theo kỳ của ngày hạch toán, và đặt nó làm mã hiển thị.
 * Gọi trong CÙNG giao dịch ghi sổ (sau khi đã khoá dòng phiếu) để số chỉ được tiêu khi ghi sổ thật sự thành công.
 * Phiếu đã có mã chính thức (phiếu cũ) thì giữ nguyên. Trả về mã chính thức; `row.code` không bị sửa tại chỗ.
 */
export async function assignOfficialCode(db: Db, tenantId: string, row: Row): Promise<string> {
  const existing = optStr(row.official_code);
  if (existing) return existing;
  const kind = row.kind as FinanceVoucherKind;
  const period = financePeriodOf(dateOnly(row.posting_date));
  const code = formatFinanceOfficialCode(kind, period, await nextSequence(db, tenantId, kind, 'OFFICIAL', period));
  await db.query(`UPDATE finance_schema.vouchers SET official_code=$3, code=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [
    tenantId,
    String(row.id),
    code,
  ]);
  return code;
}

/** Mã nháp kế tiếp dự kiến, để form hiện trước khi lưu (không giữ chỗ). */
export async function peekNextCode(db: Db, tenantId: string, kind: FinanceVoucherKind, postingDate: string): Promise<string> {
  const period = financePeriodOf(postingDate);
  const row = (
    await db.query(`SELECT last_value FROM finance_schema.code_counters WHERE tenant_id=$1 AND kind=$2 AND series='DRAFT' AND period=$3`, [
      tenantId,
      kind,
      period,
    ])
  ).rows[0] as Row | undefined;
  return formatFinanceDraftCode(kind, period, num(row?.last_value) + 1);
}

/** Mọi id tham chiếu phải thuộc tenant: khoá ngoại không kiểm tenant_id. */
async function assertReferences(db: Db, tenantId: string, v: NormalizedVoucher): Promise<void> {
  const checks: [string, string | null, string][] = [
    ['accounts', v.accountId, 'Tài khoản'],
    ['accounts', v.destAccountId, 'Tài khoản đích'],
    ['reasons', v.reasonId, 'Lý do'],
    ['counterparty_groups', v.counterpartyGroupId, 'Đối tượng'],
  ];
  for (const [table, id, label] of checks) {
    if (!id) continue;
    const found = await db.query(`SELECT 1 FROM finance_schema.${table} WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    if (!found.rows.length) throw invalid(`${label} không tồn tại.`);
  }
}

/** Hạch toán và dự án liên quan đang lưu của một phiếu, để lưu lại mà không phải hỏi Workspace khi chúng không đổi. */
export async function loadStoredLinks(db: Db, tenantId: string, voucherId: string): Promise<ResolvedWorkspaceLinks | null> {
  const row = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2`, [tenantId, voucherId])).rows[0] as Row | undefined;
  if (!row) return null;
  const related = (
    await db.query(`SELECT * FROM finance_schema.voucher_related WHERE voucher_id=$1 AND kind='PROJECT' ORDER BY project_code`, [voucherId])
  ).rows as Row[];
  return { allocation: mapAllocation(row), relatedProjects: related.map(mapRelatedProject) };
}

export async function replaceChildren(db: Db, tenantId: string, voucherId: string, v: NormalizedVoucher, links: ResolvedWorkspaceLinks): Promise<void> {
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
  for (const project of links.relatedProjects)
    await db.query(
      `INSERT INTO finance_schema.voucher_related (tenant_id, voucher_id, kind, project_id, project_code, project_name, label) VALUES ($1,$2,'PROJECT',$3,$4,$5,$6)`,
      [tenantId, voucherId, project.projectId, project.projectCode, project.projectName, `${project.projectCode} - ${project.projectName}`],
    );
}

/** Cột hạch toán theo thứ tự cố định: type, project id/code/name, work item id/code/title. */
export function allocationColumns(links: ResolvedWorkspaceLinks): (string | null)[] {
  const a = links.allocation;
  return a ? [a.type, a.projectId, a.projectCode, a.projectName, a.workItemId, a.workItemCode, a.workItemTitle] : [null, null, null, null, null, null, null];
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
    // clock_timestamp(), không phải now(): nhiều sự kiện trong cùng giao dịch (sửa rồi gửi duyệt lại) vẫn giữ đúng thứ tự.
    `INSERT INTO finance_schema.voucher_events (tenant_id, voucher_id, action, actor_id, actor_name, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
    [tenantId, voucherId, action, actor?.userId ?? null, actor?.displayName ?? null, note?.trim() || null],
  );
}

export async function createVoucher(db: Db, tenantId: string, actor: FinanceActor, v: NormalizedVoucher, links: ResolvedWorkspaceLinks): Promise<string> {
  await assertReferences(db, tenantId, v);
  const code = await allocateDraftCode(db, tenantId, v.kind, v.postingDate);
  const row = (
    await db.query(
      `INSERT INTO finance_schema.vouchers
         (tenant_id, kind, code, draft_code, voucher_date, posting_date, content, reason_id, account_id, dest_account_id, counterparty_group_id,
          counterparty_name, counterparty_account_no, counterparty_bank,
          tax_included, tax_rate, total_amount, note,
          created_by, created_by_name,
          alloc_type, alloc_project_id, alloc_project_code, alloc_project_name, alloc_work_item_id, alloc_work_item_code, alloc_work_item_title)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
      [
        tenantId, v.kind, code, v.voucherDate, v.postingDate, v.content, v.reasonId, v.accountId, v.destAccountId, v.counterpartyGroupId,
        v.counterpartyName ?? null, v.counterpartyAccountNo ?? null, v.counterpartyBank ?? null,
        v.taxIncluded, v.taxRate, v.totalAmount, v.note,
        actor.userId, actor.displayName,
        ...allocationColumns(links),
      ],
    )
  ).rows[0] as Row;
  const id = String(row.id);
  await replaceChildren(db, tenantId, id, v, links);
  await addEvent(db, tenantId, id, 'CREATED', actor);
  return id;
}

/**
 * Sửa phiếu: chủ phiếu sửa được khi phiếu còn là NHÁP (lưu lỏng, giữ nháp), hoặc khi BỊ TỪ CHỐI hay đang CHỜ DUYỆT
 * THEO CÁCH TRỰC TIẾP (coi như gửi duyệt lại ngay — không còn bước "lưu nháp" riêng, phải đủ điều kiện gửi duyệt và
 * chuyển thẳng về PENDING). Phiếu đang chờ duyệt THEO QUY TRÌNH thì không tự sửa được ở đây: Procedure Engine đã
 * nhận snapshot số liệu lúc gửi, sửa ngầm sẽ làm lệch dữ liệu bên đó — phải dùng Huỷ rồi lập lại.
 *
 * `resubmitMode` (DIRECT|PROCEDURE) do nơi gọi (`finance.application.ts`) tính sẵn NGOÀI giao dịch này giống hệt lúc
 * gửi duyệt (`submit()`), vì việc đó có thể cần hỏi Procedure Engine qua mạng; bắt buộc có khi đang gửi duyệt lại.
 */
export async function updateVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  id: string,
  v: NormalizedVoucher,
  revision: number | undefined,
  links: ResolvedWorkspaceLinks,
  resubmitMode: 'DIRECT' | 'PROCEDURE' | null,
): Promise<Row> {
  const current = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  if (!current || current.created_by !== actor.userId) throw notFound('phiếu');
  if (current.approval_mode === 'INHERITED') throw sourceManaged();
  if (current.kind !== v.kind) throw invalid('Không đổi được loại phiếu.');
  const status = String(current.status);
  const resubmitting = status === 'REJECTED' || (status === 'PENDING' && current.approval_mode === 'DIRECT');
  if (status !== 'DRAFT' && !resubmitting)
    throw conflict(
      'FINANCE_VOUCHER_LOCKED',
      status === 'PENDING' ? 'Phiếu đang duyệt theo quy trình; không tự sửa được ở đây, dùng Huỷ rồi lập lại.' : 'Chỉ sửa được phiếu ở trạng thái nháp, chờ duyệt trực tiếp hoặc bị từ chối.',
    );
  if (revision !== undefined && revision !== num(current.revision))
    throw conflict('FINANCE_REVISION_CONFLICT', 'Phiếu đã được thay đổi bởi lần lưu khác; tải lại trước khi sửa.');
  await assertReferences(db, tenantId, v);
  if (resubmitting) {
    if (!resubmitMode) throw invalid('Thiếu chế độ duyệt khi gửi lại.');
    await assertSubmittable(db, tenantId, v);
  }

  const row = (
    await db.query(
      `UPDATE finance_schema.vouchers SET voucher_date=$3, posting_date=$4, content=$5, reason_id=$6, account_id=$7, dest_account_id=$8,
              counterparty_group_id=$9,
              tax_included=$10, tax_rate=$11, total_amount=$12, note=$13,
              alloc_type=$14, alloc_project_id=$15, alloc_project_code=$16, alloc_project_name=$17,
              alloc_work_item_id=$18, alloc_work_item_code=$19, alloc_work_item_title=$20,
              status=$21::text, approval_mode=COALESCE($22, approval_mode), revision=revision+1,
              submitted_at=CASE WHEN $21::text='PENDING' THEN now() ELSE submitted_at END,
              submitted_by=CASE WHEN $21::text='PENDING' THEN $23 ELSE submitted_by END,
              decided_at=NULL, decided_by=NULL, decided_by_name=NULL, decision_note=NULL, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        tenantId, id, v.voucherDate, v.postingDate, v.content, v.reasonId, v.accountId, v.destAccountId, v.counterpartyGroupId,
        v.taxIncluded, v.taxRate, v.totalAmount, v.note,
        ...allocationColumns(links),
        resubmitting ? 'PENDING' : 'DRAFT',
        resubmitMode,
        actor.userId,
      ],
    )
  ).rows[0] as Row;
  await replaceChildren(db, tenantId, id, v, links);
  await addEvent(db, tenantId, id, 'UPDATED', actor, status === 'REJECTED' ? 'Sửa phiếu bị từ chối' : status === 'PENDING' ? 'Sửa phiếu đang chờ duyệt' : null);
  if (resubmitting) {
    await addEvent(db, tenantId, id, 'SUBMITTED', actor, resubmitMode === 'PROCEDURE' ? 'Gửi duyệt qua quy trình' : null);
    if (resubmitMode === 'DIRECT') await notifyApprovalRequested(db, notificationFacts(tenantId, row));
  }
  return row;
}

/** Phiếu tạo từ hồ sơ quy trình chỉ thay đổi qua thao tác của kế toán (ghi sổ / trả hồ sơ) hoặc qua chính hồ sơ. */
export const sourceManaged = () =>
  conflict('FINANCE_SOURCE_MANAGED', 'Phiếu tạo từ hồ sơ quy trình: kế toán ghi sổ hoặc trả hồ sơ; người lập sửa tại hồ sơ.');

/** Xoá: nháp, hoặc phiếu đang chờ duyệt THEO CÁCH TRỰC TIẾP (chưa ghi sổ, chưa có hồ sơ quy trình). Phiếu bị từ chối, đang
 * chờ duyệt theo quy trình, hoặc tạo từ hồ sơ quy trình (INHERITED) thì dùng Huỷ hoặc thao tác ở hồ sơ — xoá thẳng ở đây
 * sẽ bỏ sót việc đóng hồ sơ bên Procedure. */
export async function deleteDraft(db: Db, tenantId: string, actor: FinanceActor, id: string): Promise<void> {
  const current = (
    await db.query(`SELECT created_by, status, approval_mode FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])
  ).rows[0] as Row | undefined;
  if (!current || current.created_by !== actor.userId) throw notFound('phiếu');
  if (current.approval_mode === 'INHERITED') throw sourceManaged();
  const deletable = current.status === 'DRAFT' || (current.status === 'PENDING' && current.approval_mode === 'DIRECT');
  if (!deletable) throw conflict('FINANCE_VOUCHER_LOCKED', 'Chỉ xoá được phiếu nháp hoặc đang chờ duyệt trực tiếp; phiếu khác thì huỷ.');
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
    db.query(`SELECT * FROM finance_schema.voucher_related WHERE voucher_id=$1 AND kind='PROJECT' ORDER BY project_code`, [id]),
    db.query(`SELECT * FROM finance_schema.voucher_attachments WHERE voucher_id=$1 AND purpose='ATTACHMENT' AND deleted_at IS NULL AND status='READY' ORDER BY uploaded_at`, [id]),
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
export const mapRelatedProject = (row: Row): FinanceRelatedProject => ({
  projectId: String(row.project_id),
  projectCode: String(row.project_code ?? ''),
  projectName: String(row.project_name ?? ''),
});
export const mapAttachment = (row: Row): FinanceVoucherAttachment => ({
  id: String(row.id),
  fileName: String(row.file_name),
  contentType: String(row.content_type),
  sizeBytes: num(row.size_bytes),
  uploadedBy: optStr(row.uploaded_by),
  uploadedByName: optStr(row.uploaded_by_name),
  uploadedAt: iso(row.uploaded_at),
  purpose: (row.purpose as FinanceVoucherAttachment['purpose'] | undefined) ?? 'ATTACHMENT',
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
  /** Bộ lọc "Chờ tôi ghi sổ": chỉ các phiếu này (đã lọc theo phân công ở tầng ứng dụng). */
  restrictIds?: readonly string[],
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
  if (query.scope === 'to-post' || query.scope === 'awaiting-post') {
    // Phiếu từ quy trình đang chờ kế toán ghi sổ; chỉ người duyệt loại phiếu mới có việc ở đây.
    where.push(
      `v.approval_mode = 'INHERITED' AND v.status = 'DRAFT' AND EXISTS (SELECT 1 FROM finance_schema.voucher_sources s WHERE s.voucher_id = v.id AND s.status = 'OPEN')`,
    );
    if (!approvableKinds(actor).includes(query.kind)) where.push('FALSE');
    if (query.scope === 'to-post') add('v.id = ANY(?::uuid[])', [...(restrictIds ?? [])]);
  }
  if (query.source === 'procedure') where.push(`v.approval_mode = 'INHERITED'`);
  if (query.accountId) {
    params.push(query.accountId);
    where.push(`(v.account_id = $${params.length} OR v.dest_account_id = $${params.length})`);
  }
  if (query.reasonId) add('v.reason_id = ?', query.reasonId);
  if (query.projectId) add('v.alloc_project_id = ?', query.projectId);
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
      `(v.code ILIKE ${p} OR v.draft_code ILIKE ${p} OR v.official_code ILIKE ${p} OR v.content ILIKE ${p} OR v.counterparty_name ILIKE ${p} OR v.created_by_name ILIKE ${p} OR r.name ILIKE ${p}
        OR EXISTS (SELECT 1 FROM finance_schema.voucher_sources s WHERE s.voucher_id = v.id AND s.instance_code ILIKE ${p}))`,
    );
  }
  const base = where.join(' AND ');
  const joined = `FROM finance_schema.vouchers v LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id`;

  const statusCounts = Object.fromEntries(FINANCE_VOUCHER_STATUSES.map((s) => [s, 0])) as Record<FinanceVoucherStatus, number>;
  const statusAmounts = Object.fromEntries(FINANCE_VOUCHER_STATUSES.map((s) => [s, 0])) as Record<FinanceVoucherStatus, number>;
  const counts = (await db.query(`SELECT v.status, count(*)::int AS n, COALESCE(SUM(v.total_amount),0) AS amount ${joined} WHERE ${base} GROUP BY v.status`, params)).rows as Row[];
  for (const row of counts) {
    statusCounts[row.status as FinanceVoucherStatus] = num(row.n);
    statusAmounts[row.status as FinanceVoucherStatus] = num(row.amount);
  }
  const approvedTotal = statusAmounts.APPROVED;

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
  return { items: rows.map(mapSummary), total, page, pageSize, statusCounts, approvedTotal, statusAmounts };
}

const PROJECT_LIST_LIMIT = 200;
/** Chỉ phiếu đang có hiệu lực tiền: chờ duyệt và đã ghi sổ. Nháp, bị từ chối, đã huỷ (kể cả đã đảo) không phải tiền của dự án. */
const PROJECT_STATUSES = ['PENDING', 'APPROVED'];

/**
 * Phiếu thu/chi gắn với một dự án, cho trang dự án bên Workspace.
 *
 * Người gọi đã được Workspace xác nhận xem được tài chính dự án và có quyền `finance.read` (kiểm ở tầng application), nên
 * số liệu tính trên mọi phiếu của dự án. Tổng tiền chỉ tính phiếu HẠCH TOÁN cho dự án (kể cả công việc thuộc dự án);
 * phiếu "liên quan" chỉ để tra cứu. Chi đã duyệt hạch toán cho công việc là chi phí thực tế của công việc đó.
 */
export async function listProjectVouchers(db: Db, tenantId: string, projectId: string): Promise<FinanceProjectVoucherList> {
  const params: unknown[] = [tenantId, projectId, PROJECT_STATUSES];
  const scope = `v.tenant_id = $1 AND v.kind IN ('RECEIPT','PAYMENT') AND v.status = ANY($3::text[])`;

  const totalsRows = (
    await db.query(
      `SELECT v.alloc_work_item_id, max(v.alloc_work_item_code) AS work_item_code, max(v.alloc_work_item_title) AS work_item_title,
              v.kind, v.status, count(*)::int AS n, COALESCE(SUM(v.total_amount),0) AS amount
         FROM finance_schema.vouchers v WHERE ${scope} AND v.alloc_project_id = $2::uuid
        GROUP BY v.alloc_work_item_id, v.kind, v.status`,
      params,
    )
  ).rows as Row[];
  const emptyTotals = (): FinanceProjectTotals => ({ received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 });
  const add = (target: FinanceProjectTotals, row: Row) => {
    const amount = num(row.amount);
    const approved = row.status === 'APPROVED';
    if (row.kind === 'RECEIPT') {
      target.receiptCount += num(row.n);
      if (approved) target.received += amount;
      else target.pendingReceived += amount;
    } else {
      target.paymentCount += num(row.n);
      if (approved) target.paid += amount;
      else target.pendingPaid += amount;
    }
  };
  const totals = emptyTotals();
  const projectLevel = emptyTotals();
  const byWorkItem = new Map<string, FinanceProjectWorkItemTotals>();
  for (const row of totalsRows) {
    add(totals, row);
    if (!row.alloc_work_item_id) {
      add(projectLevel, row);
      continue;
    }
    const id = String(row.alloc_work_item_id);
    let entry = byWorkItem.get(id);
    if (!entry) {
      entry = { workItemId: id, code: String(row.work_item_code ?? ''), title: String(row.work_item_title ?? ''), ...emptyTotals() };
      byWorkItem.set(id, entry);
    }
    add(entry, row);
  }
  const workItems = [...byWorkItem.values()].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));

  const rows = (
    await db.query(
      `SELECT v.id, v.kind, v.code, v.voucher_date, v.content, v.status, v.total_amount, v.created_by_name,
              v.alloc_work_item_id, v.alloc_work_item_code, v.alloc_work_item_title, r.name AS reason_name,
              (v.alloc_project_id = $2::uuid) AS is_allocation
         FROM finance_schema.vouchers v LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id
        WHERE ${scope}
          AND (v.alloc_project_id = $2::uuid
               OR EXISTS (SELECT 1 FROM finance_schema.voucher_related rel WHERE rel.voucher_id = v.id AND rel.kind = 'PROJECT' AND rel.project_id = $2::uuid))
        ORDER BY v.voucher_date DESC, v.created_at DESC, v.id DESC LIMIT ${PROJECT_LIST_LIMIT + 1}`,
      params,
    )
  ).rows as Row[];
  const items: FinanceProjectVoucher[] = rows.slice(0, PROJECT_LIST_LIMIT).map((row) => ({
    id: String(row.id),
    kind: row.kind as FinanceVoucherKind,
    code: String(row.code),
    voucherDate: dateOnly(row.voucher_date),
    content: String(row.content),
    reasonName: optStr(row.reason_name),
    status: row.status as FinanceVoucherStatus,
    totalAmount: num(row.total_amount),
    link: row.is_allocation ? 'ALLOCATION' : 'RELATED',
    workItem:
      row.is_allocation && row.alloc_work_item_id
        ? { id: String(row.alloc_work_item_id), code: String(row.alloc_work_item_code ?? ''), title: String(row.alloc_work_item_title ?? '') }
        : null,
    createdByName: optStr(row.created_by_name),
  }));
  return { items, totals, projectLevel, workItems, truncated: rows.length > PROJECT_LIST_LIMIT };
}
