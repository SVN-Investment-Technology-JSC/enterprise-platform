import type {
  FinanceAccount,
  FinanceLedgerEntry,
  FinancePage,
  FinanceVoucherKind,
  SaveFinanceAccountRequest,
} from '@enterprise-platform/contracts-finance';
import { FINANCE_MAX_AMOUNT, roundMoney } from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { conflict, invalid, notFound } from '../domain/finance.error.js';
import { isValidDate } from '../domain/voucher.rules.js';
import { dateOnly, iso, num, optStr, type Db } from './finance.database.js';

type Row = QueryResultRow & Record<string, unknown>;

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;

const ACCOUNT_SELECT = `
  SELECT a.*,
         a.opening_balance + COALESCE(l.total_in, 0) - COALESCE(l.total_out, 0) AS balance,
         COALESCE(l.total_in, 0) AS total_in, COALESCE(l.total_out, 0) AS total_out,
         COALESCE(l.receipt_count, 0) AS receipt_count, COALESCE(l.payment_count, 0) AS payment_count,
         COALESCE(l.transfer_count, 0) AS transfer_count,
         COALESCE(p.pending_out, 0) AS pending_out
    FROM finance_schema.accounts a
    LEFT JOIN (
      -- Bút toán đảo thuộc bên của bút toán gốc (đảo phiếu chi trừ vào Tiền chi, không cộng vào Tiền thu).
      SELECT x.account_id,
             COALESCE(SUM(x.amount) FILTER (WHERE x.original_sign > 0), 0) AS total_in,
             COALESCE(-SUM(x.amount) FILTER (WHERE x.original_sign < 0), 0) AS total_out,
             count(DISTINCT x.voucher_id) FILTER (WHERE x.kind = 'RECEIPT' AND x.status = 'APPROVED') AS receipt_count,
             count(DISTINCT x.voucher_id) FILTER (WHERE x.kind = 'PAYMENT' AND x.status = 'APPROVED') AS payment_count,
             count(DISTINCT x.voucher_id) FILTER (WHERE x.kind = 'TRANSFER' AND x.status = 'APPROVED') AS transfer_count
        FROM (
          SELECT le.account_id, le.voucher_id, le.amount, v.kind, v.status,
                 CASE WHEN le.is_reversal THEN -SIGN(le.amount) ELSE SIGN(le.amount) END AS original_sign
            FROM finance_schema.ledger_entries le
            JOIN finance_schema.vouchers v ON v.id = le.voucher_id
           WHERE le.tenant_id = $1
        ) x
       GROUP BY x.account_id
    ) l ON l.account_id = a.id
    LEFT JOIN (
      SELECT account_id, SUM(total_amount) AS pending_out
        FROM finance_schema.vouchers
       WHERE tenant_id = $1 AND status = 'PENDING' AND kind IN ('PAYMENT', 'TRANSFER') AND account_id IS NOT NULL
       GROUP BY account_id
    ) p ON p.account_id = a.id
   WHERE a.tenant_id = $1`;

function mapAccount(row: Row, withBalances: boolean): FinanceAccount {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    accountType: row.account_type as FinanceAccount['accountType'],
    bankName: optStr(row.bank_name),
    accountNumber: optStr(row.account_number),
    accountHolder: optStr(row.account_holder),
    branch: optStr(row.branch),
    currency: String(row.currency).trim(),
    openingBalance: num(row.opening_balance),
    openingDate: dateOnly(row.opening_date),
    allowNegative: Boolean(row.allow_negative),
    isActive: Boolean(row.is_active),
    note: optStr(row.note),
    balance: withBalances ? num(row.balance) : null,
    pendingOut: withBalances ? num(row.pending_out) : null,
    receiptCount: withBalances ? num(row.receipt_count) : null,
    paymentCount: withBalances ? num(row.payment_count) : null,
    transferCount: withBalances ? num(row.transfer_count) : null,
    totalReceipts: withBalances ? num(row.total_in) : null,
    totalPayments: withBalances ? num(row.total_out) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listAccounts(
  db: Db,
  tenantId: string,
  options: { includeInactive: boolean; withBalances: boolean },
): Promise<FinanceAccount[]> {
  const rows = (
    await db.query(
      `${ACCOUNT_SELECT} ${options.includeInactive ? '' : 'AND a.is_active'} ORDER BY a.is_active DESC, a.account_type, a.name`,
      [tenantId],
    )
  ).rows as Row[];
  return rows.map((row) => mapAccount(row, options.withBalances));
}

export async function getAccount(db: Db, tenantId: string, id: string, withBalances: boolean): Promise<FinanceAccount> {
  const row = (await db.query(`${ACCOUNT_SELECT} AND a.id = $2`, [tenantId, id])).rows[0] as Row | undefined;
  if (!row) throw notFound('tài khoản');
  return mapAccount(row, withBalances);
}

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw invalid(`${label} tối đa ${max} ký tự.`);
  return trimmed;
}

/** Tạo (id = null) hoặc sửa tài khoản. Số dư đầu kỳ chỉ đổi được khi tài khoản chưa có bút toán nào. */
export async function saveAccount(
  db: Db,
  tenantId: string,
  actorId: string,
  id: string | null,
  input: SaveFinanceAccountRequest,
): Promise<string> {
  const code = text(input.code, 50, 'Mã tài khoản');
  if (!code || !CODE.test(code)) throw invalid('Mã tài khoản chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới (tối đa 50 ký tự).');
  const name = text(input.name, 255, 'Tên tài khoản');
  if (!name) throw invalid('Tên tài khoản là bắt buộc.');
  if (input.accountType !== 'BANK' && input.accountType !== 'CASH') throw invalid('Loại tài khoản không hợp lệ.');
  const accountNumber = text(input.accountNumber, 60, 'Số tài khoản');
  if (input.accountType === 'BANK' && !accountNumber) throw invalid('Tài khoản ngân hàng phải có số tài khoản.');
  if (input.accountType === 'BANK' && !text(input.bankName, 120, 'Ngân hàng')) throw invalid('Chọn ngân hàng cho tài khoản ngân hàng.');
  const openingBalance = input.openingBalance === undefined ? undefined : roundMoney(Number(input.openingBalance));
  if (openingBalance !== undefined && (!Number.isFinite(openingBalance) || Math.abs(openingBalance) > FINANCE_MAX_AMOUNT))
    throw invalid('Số dư đầu kỳ không hợp lệ.');
  if (input.openingDate !== undefined && !isValidDate(input.openingDate)) throw invalid('Ngày bắt đầu sử dụng không hợp lệ.');
  const bank = input.accountType === 'BANK';
  const values = {
    code,
    name,
    type: input.accountType,
    bankName: bank ? text(input.bankName, 120, 'Ngân hàng') : null,
    accountNumber: bank ? accountNumber : null,
    accountHolder: bank ? text(input.accountHolder, 255, 'Chủ tài khoản') : null,
    branch: bank ? text(input.branch, 255, 'Chi nhánh') : null,
    note: text(input.note, 2000, 'Ghi chú'),
  };

  try {
    if (!id) {
      const row = (
        await db.query(
          `INSERT INTO finance_schema.accounts
             (tenant_id, code, name, account_type, bank_name, account_number, account_holder, branch, opening_balance, opening_date, allow_negative, is_active, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date, CURRENT_DATE),$11,$12,$13,$14) RETURNING id`,
          [
            tenantId, values.code, values.name, values.type, values.bankName, values.accountNumber, values.accountHolder, values.branch,
            openingBalance ?? 0, input.openingDate ?? null, input.allowNegative === true, input.isActive !== false, values.note, actorId,
          ],
        )
      ).rows[0] as Row;
      return String(row.id);
    }

    const current = (
      await db.query(
        `SELECT a.*, EXISTS (SELECT 1 FROM finance_schema.ledger_entries l WHERE l.account_id = a.id) AS has_ledger
           FROM finance_schema.accounts a WHERE a.tenant_id = $1 AND a.id = $2 FOR UPDATE`,
        [tenantId, id],
      )
    ).rows[0] as Row | undefined;
    if (!current) throw notFound('tài khoản');
    const hasLedger = Boolean(current.has_ledger);
    if (hasLedger) {
      if (openingBalance !== undefined && openingBalance !== num(current.opening_balance))
        throw conflict('FINANCE_ACCOUNT_HAS_LEDGER', 'Tài khoản đã có bút toán nên không đổi được số dư đầu kỳ.');
      if (input.openingDate !== undefined && input.openingDate !== dateOnly(current.opening_date))
        throw conflict('FINANCE_ACCOUNT_HAS_LEDGER', 'Tài khoản đã có bút toán nên không đổi được ngày bắt đầu sử dụng.');
      if (input.accountType !== current.account_type)
        throw conflict('FINANCE_ACCOUNT_HAS_LEDGER', 'Tài khoản đã có bút toán nên không đổi được loại tài khoản.');
    }
    if (input.isActive === false && current.is_active) {
      const pending = (
        await db.query(
          `SELECT count(*)::int AS n FROM finance_schema.vouchers
            WHERE tenant_id = $1 AND status = 'PENDING' AND (account_id = $2 OR dest_account_id = $2)`,
          [tenantId, id],
        )
      ).rows[0] as Row;
      if (num(pending.n) > 0)
        throw conflict('FINANCE_ACCOUNT_IN_USE', `Còn ${num(pending.n)} phiếu đang chờ duyệt dùng tài khoản này; xử lý xong mới ngừng sử dụng.`);
    }
    await db.query(
      `UPDATE finance_schema.accounts SET code=$3, name=$4, account_type=$5, bank_name=$6, account_number=$7, account_holder=$8, branch=$9,
              opening_balance=COALESCE($10, opening_balance), opening_date=COALESCE($11::date, opening_date),
              allow_negative=COALESCE($12, allow_negative), is_active=COALESCE($13, is_active), note=$14, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [
        tenantId, id, values.code, values.name, values.type, values.bankName, values.accountNumber, values.accountHolder, values.branch,
        openingBalance ?? null, input.openingDate ?? null,
        input.allowNegative === undefined ? null : input.allowNegative, input.isActive === undefined ? null : input.isActive, values.note,
      ],
    );
    // Cho phép số âm bị tắt trong khi số dư đã âm: không chặn việc tắt, nhưng phiếu chi sau đó sẽ không qua.
    return id;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw conflict('FINANCE_CODE_EXISTS', `Mã tài khoản ${code} đã tồn tại.`);
    throw error;
  }
}

export interface LedgerQuery {
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Sổ cái một tài khoản, kèm số dư sau từng bút toán (tính theo thứ tự ghi sổ, không theo bộ lọc ngày). */
export async function accountLedger(
  db: Db,
  tenantId: string,
  accountId: string,
  query: LedgerQuery,
): Promise<FinancePage<FinanceLedgerEntry> & { openingBalance: number }> {
  const account = (await db.query(`SELECT opening_balance FROM finance_schema.accounts WHERE tenant_id=$1 AND id=$2`, [tenantId, accountId]))
    .rows[0] as Row | undefined;
  if (!account) throw notFound('tài khoản');
  if (query.from && !isValidDate(query.from)) throw invalid('Từ ngày không hợp lệ.');
  if (query.to && !isValidDate(query.to)) throw invalid('Đến ngày không hợp lệ.');
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 50), 1), 200);
  const page = Math.max(Math.trunc(query.page ?? 1), 1);
  const params: unknown[] = [tenantId, accountId, num(account.opening_balance), query.from ?? null, query.to ?? null];
  const filtered = `
    WITH running AS (
      SELECT l.*, v.code AS voucher_code, v.kind AS voucher_kind,
             $3::numeric + SUM(l.amount) OVER (ORDER BY l.seq) AS balance_after
        FROM finance_schema.ledger_entries l
        JOIN finance_schema.vouchers v ON v.id = l.voucher_id
       WHERE l.tenant_id = $1 AND l.account_id = $2
    )
    SELECT * FROM running WHERE ($4::date IS NULL OR posted_date >= $4::date) AND ($5::date IS NULL OR posted_date <= $5::date)`;
  const total = num(
    ((await db.query(`SELECT count(*) AS n FROM (${filtered}) x`, params)).rows[0] as Row).n,
  );
  const rows = (
    await db.query(`${filtered} ORDER BY seq DESC LIMIT $6 OFFSET $7`, [...params, pageSize, (page - 1) * pageSize])
  ).rows as Row[];
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      voucherId: String(row.voucher_id),
      voucherCode: String(row.voucher_code),
      voucherKind: row.voucher_kind as FinanceVoucherKind,
      postedDate: dateOnly(row.posted_date),
      amount: num(row.amount),
      balanceAfter: num(row.balance_after),
      description: optStr(row.description),
      isReversal: Boolean(row.is_reversal),
      createdAt: iso(row.created_at),
    })),
    total,
    page,
    pageSize,
    openingBalance: num(account.opening_balance),
  };
}
