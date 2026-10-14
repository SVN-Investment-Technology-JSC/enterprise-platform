import type { FinanceVoucherKind } from '@enterprise-platform/contracts-finance';
import { canApprove, canCreate, type FinanceActor } from '../domain/finance.access.js';
import { conflict, forbidden, invalid, invalidMany, notFound } from '../domain/finance.error.js';
import {
  assertPostingDateAllowed,
  validateForSubmit,
  type NormalizedVoucher,
} from '../domain/voucher.rules.js';
import { loadSettings } from './catalogs.store.js';
import {
  notifyApprovalRequested,
  notifyOutcome,
  type VoucherNotificationFacts,
} from './finance-notification-events.js';
import { dateOnly, num, optStr, todayVn, type Db } from './finance.database.js';
import { addEvent, canViewVoucher, loadVoucherRecord, type Row, type VoucherRecord } from './vouchers.store.js';

/** Dữ kiện của phiếu cần cho nội dung thông báo, lấy từ một dòng phiếu đã đọc. */
export function notificationFacts(tenantId: string, row: Row): VoucherNotificationFacts {
  return {
    tenantId,
    voucherId: String(row.id),
    kind: row.kind as FinanceVoucherKind,
    code: String(row.code),
    content: String(row.content),
    totalAmount: num(row.total_amount),
    requesterUserId: String(row.created_by),
    requesterName: optStr(row.created_by_name),
  };
}

/** Khoá dòng phiếu không kiểm quyền xem: dành cho tiến trình hệ thống (áp kết quả quy trình). */
export async function lockVoucherRow(db: Db, tenantId: string, id: string): Promise<Row | undefined> {
  return (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as Row | undefined;
}

/** Khoá dòng phiếu cho cả giao dịch; người không được xem phiếu nhận 404 như phiếu không tồn tại. */
async function lockVoucher(db: Db, tenantId: string, actor: FinanceActor, id: string): Promise<Row> {
  const row = (await db.query(`SELECT * FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  if (!row || !canViewVoucher(actor, row)) throw notFound('phiếu');
  return row;
}

/** Dựng lại dữ liệu chuẩn hoá từ phiếu đã lưu để kiểm điều kiện gửi duyệt đúng như lúc lưu. */
function recordToNormalized(record: VoucherRecord): NormalizedVoucher {
  const row = record.row;
  return {
    kind: row.kind as FinanceVoucherKind,
    voucherDate: dateOnly(row.voucher_date),
    postingDate: dateOnly(row.posting_date),
    content: String(row.content),
    reasonId: optStr(row.reason_id),
    accountId: optStr(row.account_id),
    destAccountId: optStr(row.dest_account_id),
    counterpartyGroupId: optStr(row.counterparty_group_id),
    counterpartyName: optStr(row.counterparty_name),
    counterpartyAccountNo: optStr(row.counterparty_account_no),
    counterpartyBank: optStr(row.counterparty_bank),
    costCenterId: optStr(row.cost_center_id),
    taxIncluded: Boolean(row.tax_included),
    taxRate: num(row.tax_rate),
    note: optStr(row.note),
    totalAmount: num(row.total_amount),
    lines: record.lines.map((line) => ({
      lineNo: num(line.line_no),
      description: String(line.description),
      quantity: num(line.quantity),
      unitAmount: num(line.unit_amount),
      total: num(line.total),
    })),
    invoices: [],
    related: [],
  };
}

async function accountRef(db: Db, tenantId: string, id: string | null) {
  if (!id) return null;
  const row = (await db.query(`SELECT name, is_active, opening_date FROM finance_schema.accounts WHERE tenant_id=$1 AND id=$2`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  return row ? { name: String(row.name), isActive: Boolean(row.is_active), openingDate: dateOnly(row.opening_date) } : null;
}

/**
 * Gửi duyệt: kiểm đủ điều kiện rồi chuyển PENDING. `mode` là cách duyệt đang áp cho loại phiếu: với PROCEDURE, nơi gọi
 * tạo liên kết quy trình trong cùng giao dịch (từ phiếu trả về) để phiếu và liên kết cùng thành công hoặc cùng huỷ.
 */
export async function submitVoucher(
  db: Db,
  tenantId: string,
  actor: FinanceActor,
  id: string,
  mode: 'DIRECT' | 'PROCEDURE' = 'DIRECT',
): Promise<Row> {
  const row = await lockVoucher(db, tenantId, actor, id);
  const kind = row.kind as FinanceVoucherKind;
  if (row.created_by !== actor.userId || !canCreate(actor, kind)) throw forbidden('Chỉ người lập phiếu mới được gửi duyệt.');
  if (row.status !== 'DRAFT' && row.status !== 'REJECTED') throw conflict('FINANCE_VOUCHER_LOCKED', 'Phiếu đã gửi duyệt hoặc đã xử lý.');
  const record = await loadVoucherRecord(db, tenantId, id);
  const voucher = recordToNormalized(record);

  const reason = voucher.reasonId
    ? ((await db.query(`SELECT kind, is_active FROM finance_schema.reasons WHERE tenant_id=$1 AND id=$2`, [tenantId, voucher.reasonId])).rows[0] as Row | undefined)
    : undefined;
  const group = voucher.counterpartyGroupId
    ? ((await db.query(`SELECT is_active FROM finance_schema.counterparty_groups WHERE tenant_id=$1 AND id=$2`, [tenantId, voucher.counterpartyGroupId])).rows[0] as Row | undefined)
    : undefined;
  const errors = validateForSubmit(voucher, {
    account: await accountRef(db, tenantId, voucher.accountId),
    dest: await accountRef(db, tenantId, voucher.destAccountId),
    reason: reason ? { kind: String(reason.kind), isActive: Boolean(reason.is_active) } : null,
    counterpartyGroup: group ? { isActive: Boolean(group.is_active) } : null,
  });
  if (errors.length) throw invalidMany('FINANCE_SUBMIT_INVALID', errors);

  await db.query(
    `UPDATE finance_schema.vouchers SET status='PENDING', approval_mode=$4, submitted_by=$3, submitted_at=now(),
            decided_by=NULL, decided_by_name=NULL, decided_at=NULL, decision_note=NULL, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, actor.userId, mode],
  );
  await addEvent(db, tenantId, id, 'SUBMITTED', actor, mode === 'PROCEDURE' ? 'Gửi duyệt qua quy trình' : null);
  // Duyệt trực tiếp: báo người có quyền duyệt. Qua quy trình thì Procedure tự báo người được giao bước (procedure.assignment.created).
  if (mode === 'DIRECT') await notifyApprovalRequested(db, notificationFacts(tenantId, record.row));
  return record.row;
}

interface AccountState {
  id: string;
  name: string;
  isActive: boolean;
  allowNegative: boolean;
  openingDate: string;
  balance: number;
}

/** Khoá các tài khoản (theo thứ tự id để tránh khoá chéo) rồi đọc số dư thực: chặn hai phiếu cùng rút một số dư. */
async function lockAccounts(db: Db, tenantId: string, ids: string[]): Promise<Map<string, AccountState>> {
  const rows = (
    await db.query(
      `SELECT a.id, a.name, a.is_active, a.allow_negative, a.opening_date,
              a.opening_balance + COALESCE((SELECT SUM(l.amount) FROM finance_schema.ledger_entries l WHERE l.account_id = a.id), 0) AS balance
         FROM finance_schema.accounts a
        WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
        ORDER BY a.id FOR UPDATE OF a`,
      [tenantId, ids],
    )
  ).rows as Row[];
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.name),
        isActive: Boolean(row.is_active),
        allowNegative: Boolean(row.allow_negative),
        openingDate: dateOnly(row.opening_date),
        balance: num(row.balance),
      },
    ]),
  );
}

interface LedgerPlan {
  accountId: string;
  /** Dương: tiền vào; âm: tiền ra. */
  amount: number;
}

/** Bút toán của một phiếu khi ghi sổ. Phiếu đảo dùng dấu ngược lại. */
export function ledgerPlan(
  voucher: { kind: FinanceVoucherKind; accountId: string; destAccountId: string | null; totalAmount: number },
  reversal: boolean,
): LedgerPlan[] {
  const sign = reversal ? -1 : 1;
  const total = voucher.totalAmount;
  if (voucher.kind === 'RECEIPT') return [{ accountId: voucher.accountId, amount: sign * total }];
  if (voucher.kind === 'PAYMENT') return [{ accountId: voucher.accountId, amount: -sign * total }];
  return [
    { accountId: voucher.accountId, amount: -sign * total },
    { accountId: voucher.destAccountId as string, amount: sign * total },
  ];
}

/** Người thực hiện thao tác ghi sổ/duyệt: người dùng thật hoặc tài khoản hệ thống khi quy trình áp kết quả. */
export interface Decider {
  userId: string;
  displayName: string;
}

async function postEntries(
  db: Db,
  tenantId: string,
  actor: Pick<Decider, 'userId'>,
  voucher: { id: string; code: string; kind: FinanceVoucherKind; accountId: string; destAccountId: string | null; totalAmount: number },
  options: { reversal: boolean; postedDate: string; checkOpeningDate: boolean },
): Promise<void> {
  const plan = ledgerPlan(voucher, options.reversal);
  const accounts = await lockAccounts(db, tenantId, plan.map((entry) => entry.accountId));
  for (const entry of plan) {
    const account = accounts.get(entry.accountId);
    if (!account) throw invalid('Tài khoản của phiếu không còn tồn tại.');
    if (!options.reversal && !account.isActive) throw invalid(`Tài khoản ${account.name} đã ngừng sử dụng.`);
    if (options.checkOpeningDate && options.postedDate < account.openingDate)
      throw invalid(`Ngày hạch toán trước ngày bắt đầu sử dụng của ${account.name} (${account.openingDate}).`);
    if (entry.amount < 0 && !account.allowNegative && account.balance + entry.amount < 0)
      throw conflict(
        'FINANCE_INSUFFICIENT_BALANCE',
        `Số dư ${account.name} không đủ: hiện có ${account.balance.toLocaleString('vi-VN')}, cần ${(-entry.amount).toLocaleString('vi-VN')}.`,
      );
  }
  const description = `${voucher.code}${options.reversal ? ' (đảo)' : ''}`;
  for (const entry of plan)
    await db.query(
      `INSERT INTO finance_schema.ledger_entries (tenant_id, account_id, voucher_id, posted_date, amount, description, is_reversal, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, entry.accountId, voucher.id, options.postedDate, entry.amount, description, options.reversal, actor.userId],
    );
}

function toPostable(row: Row) {
  return {
    id: String(row.id),
    code: String(row.code),
    kind: row.kind as FinanceVoucherKind,
    accountId: optStr(row.account_id) as string,
    destAccountId: optStr(row.dest_account_id),
    totalAmount: num(row.total_amount),
  };
}

/** Duyệt trực tiếp (không qua Procedure): kiểm quyền, khoá sổ, số dư rồi ghi sổ trong cùng giao dịch. */
export async function approveVoucher(db: Db, tenantId: string, actor: FinanceActor, id: string, note?: string): Promise<void> {
  const row = await lockVoucher(db, tenantId, actor, id);
  const kind = row.kind as FinanceVoucherKind;
  if (!canApprove(actor, kind)) throw forbidden('Bạn không có quyền duyệt loại phiếu này.');
  if (row.status !== 'PENDING') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không ở trạng thái chờ duyệt.');
  if (row.approval_mode !== 'DIRECT') throw conflict('FINANCE_PROCEDURE_MANAGED', 'Phiếu đang duyệt qua quy trình; xử lý trong quy trình.');
  const settings = await loadSettings(db, tenantId);
  if (row.created_by === actor.userId && !settings.allowSelfApproval)
    throw forbidden('Không được tự duyệt phiếu do mình lập.');

  await postApproval(db, tenantId, row, actor, note);
}

/**
 * Ghi sổ và chuyển phiếu sang ĐÃ DUYỆT: dùng chung cho duyệt trực tiếp và cho kết quả "đã duyệt" của quy trình.
 * Chặn theo khoá sổ, ngày hạch toán, trạng thái tài khoản và số dư; lỗi nào cũng xảy ra TRƯỚC khi ghi dòng sổ cái nào.
 */
export async function postApproval(db: Db, tenantId: string, row: Row, decider: Decider, note?: string): Promise<void> {
  const settings = await loadSettings(db, tenantId);
  const postingDate = dateOnly(row.posting_date);
  assertPostingDateAllowed(postingDate, settings.booksLockedUntil, todayVn());
  await postEntries(db, tenantId, decider, toPostable(row), { reversal: false, postedDate: postingDate, checkOpeningDate: true });
  await db.query(
    `UPDATE finance_schema.vouchers SET status='APPROVED', decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5, posted_at=now(), updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, String(row.id), decider.userId, decider.displayName, note?.trim() || null],
  );
  await addEvent(db, tenantId, String(row.id), 'APPROVED', decider, note);
  await notifyOutcome(db, notificationFacts(tenantId, row), 'APPROVED', decider.userId, decider.displayName, note ?? null);
}

/** Đưa phiếu về trạng thái đã xử lý không ghi sổ (từ chối hoặc huỷ), dùng chung cho thao tác thủ công và kết quả quy trình. */
export async function closeWithoutPosting(
  db: Db,
  tenantId: string,
  voucherId: string,
  status: 'REJECTED' | 'CANCELLED',
  decider: Decider,
  note: string | null,
): Promise<void> {
  const row = (
    await db.query(
      `UPDATE finance_schema.vouchers SET status=$3, decided_by=$4, decided_by_name=$5, decided_at=now(), decision_note=$6, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tenantId, voucherId, status, decider.userId, decider.displayName, note?.trim() || null],
    )
  ).rows[0] as Row | undefined;
  await addEvent(db, tenantId, voucherId, status === 'REJECTED' ? 'REJECTED' : 'CANCELLED', decider, note);
  if (row) await notifyOutcome(db, notificationFacts(tenantId, row), status, decider.userId, decider.displayName, note);
}

/** Từ chối: người lập có thể sửa và gửi lại. Bắt buộc có lý do. */
export async function rejectVoucher(db: Db, tenantId: string, actor: FinanceActor, id: string, note: string | undefined): Promise<void> {
  const row = await lockVoucher(db, tenantId, actor, id);
  const kind = row.kind as FinanceVoucherKind;
  if (!canApprove(actor, kind)) throw forbidden('Bạn không có quyền từ chối loại phiếu này.');
  if (row.status !== 'PENDING') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu không ở trạng thái chờ duyệt.');
  if (row.approval_mode !== 'DIRECT') throw conflict('FINANCE_PROCEDURE_MANAGED', 'Phiếu đang duyệt qua quy trình; xử lý trong quy trình.');
  const reason = note?.trim();
  if (!reason) throw invalid('Nhập lý do từ chối.');
  if (row.created_by === actor.userId) throw forbidden('Người lập muốn rút phiếu thì dùng Huỷ phiếu.');
  await db.query(
    `UPDATE finance_schema.vouchers SET status='REJECTED', decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, actor.userId, actor.displayName, reason],
  );
  await addEvent(db, tenantId, id, 'REJECTED', actor, reason);
  await notifyOutcome(db, notificationFacts(tenantId, row), 'REJECTED', actor.userId, actor.displayName, reason);
}

/** Huỷ phiếu chưa ghi sổ: người lập huỷ phiếu của mình; người duyệt huỷ phiếu đang chờ hoặc bị từ chối. */
export async function cancelVoucher(db: Db, tenantId: string, actor: FinanceActor, id: string, note: string | undefined): Promise<void> {
  const row = await lockVoucher(db, tenantId, actor, id);
  const kind = row.kind as FinanceVoucherKind;
  if (row.status === 'APPROVED') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu đã ghi sổ; dùng Huỷ phiếu đã ghi sổ (đảo bút toán).');
  if (row.status === 'CANCELLED') throw conflict('FINANCE_VOUCHER_STATE', 'Phiếu đã huỷ.');
  const owner = row.created_by === actor.userId && canCreate(actor, kind);
  const approver = canApprove(actor, kind) && row.status !== 'DRAFT';
  if (!owner && !approver) throw forbidden('Bạn không có quyền huỷ phiếu này.');
  await db.query(
    `UPDATE finance_schema.vouchers SET status='CANCELLED', decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, actor.userId, actor.displayName, note?.trim() || null],
  );
  await addEvent(db, tenantId, id, 'CANCELLED', actor, note);
  await notifyOutcome(db, notificationFacts(tenantId, row), 'CANCELLED', actor.userId, actor.displayName, note ?? null);
}

/**
 * Huỷ phiếu đã ghi sổ bằng bút toán đảo ghi vào ngày hôm nay (kỳ đang mở), không sửa số của kỳ đã qua.
 * Kỳ đã khoá sổ vẫn đảo được vì bút toán đảo nằm ở kỳ hiện tại.
 */
export async function reverseVoucher(db: Db, tenantId: string, actor: FinanceActor, id: string, note: string | undefined): Promise<void> {
  const row = await lockVoucher(db, tenantId, actor, id);
  const kind = row.kind as FinanceVoucherKind;
  if (!canApprove(actor, kind)) throw forbidden('Bạn không có quyền huỷ phiếu đã ghi sổ.');
  if (row.status !== 'APPROVED') throw conflict('FINANCE_VOUCHER_STATE', 'Chỉ đảo được phiếu đã duyệt và ghi sổ.');
  const reason = note?.trim();
  if (!reason) throw invalid('Nhập lý do huỷ phiếu đã ghi sổ.');
  const settings = await loadSettings(db, tenantId);
  const today = todayVn();
  assertPostingDateAllowed(today, settings.booksLockedUntil, today);
  await postEntries(db, tenantId, actor, toPostable(row), { reversal: true, postedDate: today, checkOpeningDate: false });
  await db.query(
    `UPDATE finance_schema.vouchers SET status='CANCELLED', decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5, updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, actor.userId, actor.displayName, reason],
  );
  await addEvent(db, tenantId, id, 'REVERSED', actor, reason);
  await notifyOutcome(db, notificationFacts(tenantId, row), 'REVERSED', actor.userId, actor.displayName, reason);
}
