import {
  roundMoney,
  type FinanceAccountMovement,
  type FinanceBreakdownRow,
  type FinanceCashflowPoint,
  type FinanceDashboard,
  type FinanceLedgerReport,
  type FinanceLedgerReportQuery,
  type FinanceVoucherKind,
  type FinanceReport,
  type FinanceReportQuery,
} from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { canReadAll, approvableKinds, canSeeBalances, type FinanceActor } from '../domain/finance.access.js';
import { invalid } from '../domain/finance.error.js';
import { isValidDate } from '../domain/voucher.rules.js';
import { listAccounts } from './accounts.store.js';
import { mapSummary, VOUCHER_SELECT } from './vouchers.store.js';
import { dateOnly, iso, num, optStr, todayVn, type Db } from './finance.database.js';

type Row = QueryResultRow & Record<string, unknown>;

const DAY_MS = 86_400_000;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Từ ngày dài hơn 62 ngày thì gom theo tháng, ngược lại theo ngày. */
export function reportGranularity(from: string, to: string): 'day' | 'month' {
  return spanDays(from, to) > 62 ? 'month' : 'day';
}

function emptyBreakdown(rows: Row[]): FinanceBreakdownRow[] {
  return rows.map((row) => ({ id: row.id ? String(row.id) : null, name: String(row.name), amount: roundMoney(num(row.amount)), count: num(row.n) }));
}

/**
 * Báo cáo thu chi tính từ SỔ CÁI theo ngày ghi sổ, không từ trạng thái phiếu: phiếu đã huỷ bằng bút toán đảo
 * ghi vào kỳ hiện tại, nên số của kỳ đã qua không bị đổi ngầm. Chuyển tiền nội bộ không tính vào thu/chi.
 */
export async function financeReport(db: Db, tenantId: string, query: FinanceReportQuery): Promise<FinanceReport> {
  if (!isValidDate(query.from) || !isValidDate(query.to)) throw invalid('Khoảng thời gian không hợp lệ.');
  if (query.to < query.from) throw invalid('Đến ngày phải sau hoặc bằng từ ngày.');
  if (spanDays(query.from, query.to) > 3660) throw invalid('Khoảng thời gian tối đa 10 năm.');
  const granularity = reportGranularity(query.from, query.to);
  const params = [tenantId, query.from, query.to, query.accountId ?? null, query.projectId ?? null];
  // Lọc theo tài khoản và dự án hạch toán (hạch toán chỉ có ở phiếu thu/chi).
  const scope = `
    l.tenant_id = $1 AND l.posted_date BETWEEN $2::date AND $3::date
    AND ($4::uuid IS NULL OR l.account_id = $4::uuid)
    AND ($5::uuid IS NULL OR v.alloc_project_id = $5::uuid)`;
  const from = `FROM finance_schema.ledger_entries l JOIN finance_schema.vouchers v ON v.id = l.voucher_id`;

  const totalsRow = (
    await db.query(
      `SELECT COALESCE(SUM(l.amount) FILTER (WHERE v.kind='RECEIPT'),0) AS receipts,
              COALESCE(-SUM(l.amount) FILTER (WHERE v.kind='PAYMENT'),0) AS payments,
              count(DISTINCT v.id) FILTER (WHERE v.kind='RECEIPT' AND NOT l.is_reversal) AS receipt_count,
              count(DISTINCT v.id) FILTER (WHERE v.kind='PAYMENT' AND NOT l.is_reversal) AS payment_count,
              count(DISTINCT v.id) FILTER (WHERE v.kind='TRANSFER' AND NOT l.is_reversal) AS transfer_count
         ${from} WHERE ${scope}`,
      params,
    )
  ).rows[0] as Row;
  const receipts = roundMoney(num(totalsRow.receipts));
  const payments = roundMoney(num(totalsRow.payments));

  const bucket = granularity === 'month' ? `to_char(l.posted_date, 'YYYY-MM')` : `to_char(l.posted_date, 'YYYY-MM-DD')`;
  const flow = (
    await db.query(
      `SELECT ${bucket} AS period,
              COALESCE(SUM(l.amount) FILTER (WHERE v.kind='RECEIPT'),0) AS receipts,
              COALESCE(-SUM(l.amount) FILTER (WHERE v.kind='PAYMENT'),0) AS payments
         ${from} WHERE ${scope} AND v.kind IN ('RECEIPT','PAYMENT') GROUP BY 1 ORDER BY 1`,
      params,
    )
  ).rows as Row[];
  const byPeriod = new Map(flow.map((row) => [String(row.period), row]));
  const cashflow: FinanceCashflowPoint[] = fillPeriods(query.from, query.to, granularity).map((period) => {
    const row = byPeriod.get(period);
    const r = roundMoney(num(row?.receipts));
    const p = roundMoney(num(row?.payments));
    return { period, receipts: r, payments: p, net: roundMoney(r - p) };
  });

  const byReason = async (kind: 'RECEIPT' | 'PAYMENT') =>
    emptyBreakdown(
      (
        await db.query(
          `SELECT r.id, COALESCE(r.name, 'Chưa có lý do') AS name,
                  ${kind === 'RECEIPT' ? 'SUM(l.amount)' : '-SUM(l.amount)'} AS amount, count(DISTINCT v.id) AS n
             ${from} LEFT JOIN finance_schema.reasons r ON r.id = v.reason_id
            WHERE ${scope} AND v.kind = '${kind}'
            GROUP BY r.id, r.name HAVING SUM(l.amount) <> 0 ORDER BY ABS(SUM(l.amount)) DESC`,
          params,
        )
      ).rows as Row[],
    );
  // Theo dự án hạch toán (hạch toán cho công việc tính về dự án chứa nó); phiếu chưa hạch toán gom một dòng riêng.
  const byProject = async (kind: 'RECEIPT' | 'PAYMENT') =>
    emptyBreakdown(
      (
        await db.query(
          `SELECT v.alloc_project_id AS id,
                  COALESCE(MAX(v.alloc_project_code) || ' - ' || MAX(v.alloc_project_name), 'Chưa hạch toán') AS name,
                  ${kind === 'RECEIPT' ? 'SUM(l.amount)' : '-SUM(l.amount)'} AS amount, count(DISTINCT v.id) AS n
             ${from}
            WHERE ${scope} AND v.kind = '${kind}'
            GROUP BY v.alloc_project_id HAVING SUM(l.amount) <> 0 ORDER BY ABS(SUM(l.amount)) DESC`,
          params,
        )
      ).rows as Row[],
    );

  // Biến động theo tài khoản: số dư đầu = số dư đầu kỳ tài khoản + bút toán trước ngày bắt đầu báo cáo.
  const movement = (
    await db.query(
      `SELECT a.id, a.name, a.opening_balance,
              COALESCE((SELECT SUM(x.amount) FROM finance_schema.ledger_entries x WHERE x.account_id = a.id AND x.posted_date < $2::date), 0) AS before_sum,
              COALESCE(SUM(l.amount) FILTER (WHERE v.kind='RECEIPT'),0) AS receipts,
              COALESCE(-SUM(l.amount) FILTER (WHERE v.kind='PAYMENT'),0) AS payments,
              COALESCE(SUM(l.amount) FILTER (WHERE v.kind='TRANSFER' AND l.amount > 0),0) AS transfers_in,
              COALESCE(-SUM(l.amount) FILTER (WHERE v.kind='TRANSFER' AND l.amount < 0),0) AS transfers_out
         FROM finance_schema.accounts a
         LEFT JOIN finance_schema.ledger_entries l ON l.account_id = a.id AND l.posted_date BETWEEN $2::date AND $3::date
         LEFT JOIN finance_schema.vouchers v ON v.id = l.voucher_id
        WHERE a.tenant_id = $1 AND ($4::uuid IS NULL OR a.id = $4::uuid)
        GROUP BY a.id, a.name, a.opening_balance, a.account_type
        ORDER BY a.account_type, a.name`,
      // Truy vấn này không dùng dự án ($5): truyền thừa tham số sẽ bị PostgreSQL từ chối.
      params.slice(0, 4),
    )
  ).rows as Row[];
  const accounts: FinanceAccountMovement[] = movement.map((row) => {
    const opening = roundMoney(num(row.opening_balance) + num(row.before_sum));
    const r = roundMoney(num(row.receipts));
    const p = roundMoney(num(row.payments));
    const tin = roundMoney(num(row.transfers_in));
    const tout = roundMoney(num(row.transfers_out));
    return {
      accountId: String(row.id),
      accountName: String(row.name),
      openingBalance: opening,
      receipts: r,
      payments: p,
      transfersIn: tin,
      transfersOut: tout,
      closingBalance: roundMoney(opening + r - p + tin - tout),
    };
  });

  return {
    from: query.from,
    to: query.to,
    granularity,
    totals: {
      receipts,
      payments,
      net: roundMoney(receipts - payments),
      receiptCount: num(totalsRow.receipt_count),
      paymentCount: num(totalsRow.payment_count),
      transferCount: num(totalsRow.transfer_count),
    },
    cashflow,
    receiptsByReason: await byReason('RECEIPT'),
    paymentsByReason: await byReason('PAYMENT'),
    receiptsByProject: await byProject('RECEIPT'),
    paymentsByProject: await byProject('PAYMENT'),
    accounts,
  };
}

/** Số dòng tối đa mỗi lần trả về (xuất Excel/"Hiện tất cả" tải nhiều dòng một lượt). */
export const LEDGER_REPORT_MAX_LIMIT = 5000;

/**
 * Báo cáo thu chi dạng sổ: mỗi bút toán sổ cái là một dòng, có tồn quỹ chạy sau từng dòng (xếp theo ngày hạch toán rồi
 * thứ tự ghi sổ). Tồn quỹ tính trên toàn kỳ rồi mới cắt trang, nên tải thêm dòng không làm lệch số.
 * Không chọn tài khoản: tính trên toàn công ty và bỏ qua chuyển tiền nội bộ (hai chiều triệt tiêu nhau).
 */
export async function financeLedgerReport(db: Db, tenantId: string, query: FinanceLedgerReportQuery): Promise<FinanceLedgerReport> {
  if (!isValidDate(query.from) || !isValidDate(query.to)) throw invalid('Khoảng thời gian không hợp lệ.');
  if (query.to < query.from) throw invalid('Đến ngày phải sau hoặc bằng từ ngày.');
  if (spanDays(query.from, query.to) > 3660) throw invalid('Khoảng thời gian tối đa 10 năm.');
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 60), 1), LEDGER_REPORT_MAX_LIMIT);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  // PostgreSQL từ chối tham số truyền thừa, nên mỗi truy vấn chỉ nhận đúng các tham số nó dùng; $4 luôn là tài khoản.
  const scope = `
    l.tenant_id = $1
    AND ($4::uuid IS NULL OR l.account_id = $4::uuid)
    AND ($4::uuid IS NOT NULL OR v.kind <> 'TRANSFER')`;
  const joined = `FROM finance_schema.ledger_entries l JOIN finance_schema.vouchers v ON v.id = l.voucher_id`;
  const base = [tenantId, query.from, query.to, query.accountId ?? null];

  const accountOpening = (
    await db.query(
      `SELECT COALESCE(SUM(opening_balance), 0) AS n FROM finance_schema.accounts WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)`,
      [tenantId, query.accountId ?? null],
    )
  ).rows[0] as Row;
  const before = (
    await db.query(`SELECT COALESCE(SUM(l.amount), 0) AS n ${joined} WHERE ${scope} AND l.posted_date < $2::date AND $3::date IS NOT NULL`, base)
  ).rows[0] as Row;
  const openingBalance = roundMoney(num(accountOpening.n) + num(before.n));

  const totals = (
    await db.query(
      `SELECT count(*) AS n,
              COALESCE(SUM(l.amount) FILTER (WHERE v.kind = 'RECEIPT' OR (v.kind = 'TRANSFER' AND l.amount > 0)), 0) AS receipts,
              COALESCE(-SUM(l.amount) FILTER (WHERE v.kind = 'PAYMENT' OR (v.kind = 'TRANSFER' AND l.amount < 0)), 0) AS payments
         ${joined} WHERE ${scope} AND l.posted_date BETWEEN $2::date AND $3::date`,
      base,
    )
  ).rows[0] as Row;
  const totalReceipts = roundMoney(num(totals.receipts));
  const totalPayments = roundMoney(num(totals.payments));

  const rows = (
    await db.query(
      `SELECT * FROM (
         SELECT l.id, l.seq, l.voucher_id, l.account_id, l.posted_date, l.amount, l.is_reversal, v.code AS voucher_code, v.kind AS voucher_kind,
                v.content, v.created_by_name, v.created_at, a.name AS account_name,
                $5::numeric + SUM(l.amount) OVER (ORDER BY l.posted_date, l.seq) AS balance_after
           ${joined} JOIN finance_schema.accounts a ON a.id = l.account_id
          WHERE ${scope} AND l.posted_date BETWEEN $2::date AND $3::date
       ) x ORDER BY x.posted_date, x.seq LIMIT $6 OFFSET $7`,
      [...base, openingBalance, limit, offset],
    )
  ).rows as Row[];

  return {
    from: query.from,
    to: query.to,
    openingBalance,
    closingBalance: roundMoney(openingBalance + totalReceipts - totalPayments),
    totalReceipts,
    totalPayments,
    total: num(totals.n),
    offset,
    items: rows.map((row) => {
      const amount = num(row.amount);
      // Cùng cách tính với báo cáo tổng hợp: bút toán đảo của phiếu chi nằm ở cột chi (số âm), không thành khoản thu.
      const isIn = row.voucher_kind === 'RECEIPT' || (row.voucher_kind === 'TRANSFER' && amount > 0);
      return {
        id: String(row.id),
        voucherId: String(row.voucher_id),
        voucherCode: String(row.voucher_code),
        voucherKind: row.voucher_kind as FinanceVoucherKind,
        content: String(row.content),
        createdByName: optStr(row.created_by_name),
        createdAt: iso(row.created_at),
        postedDate: dateOnly(row.posted_date),
        accountId: String(row.account_id),
        accountName: String(row.account_name),
        receipt: isIn ? roundMoney(amount) : 0,
        payment: isIn ? 0 : roundMoney(-amount),
        balanceAfter: roundMoney(num(row.balance_after)),
        isReversal: Boolean(row.is_reversal),
      };
    }),
  };
}

/** Danh sách kỳ liên tục (ngày hoặc tháng) để biểu đồ không bị đứt quãng khi kỳ không có phát sinh. */
export function fillPeriods(from: string, to: string, granularity: 'day' | 'month'): string[] {
  const out: string[] = [];
  if (granularity === 'day') {
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthRange(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

function sixMonthsBack(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 - 5, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Trang tổng quan: mỗi khối chỉ lấy khi người xem có quyền nhìn số liệu đó. */
export async function financeDashboard(db: Db, tenantId: string, actor: FinanceActor): Promise<FinanceDashboard> {
  const today = todayVn();
  const month = monthRange(today);
  const seeAll = canSeeBalances(actor);

  let monthReceipts = 0;
  let monthPayments = 0;
  let cashflow: FinanceCashflowPoint[] = [];
  let accounts: FinanceDashboard['accounts'] = [];
  let totalBalance = 0;
  if (seeAll) {
    const report = await financeReport(db, tenantId, { from: sixMonthsBack(today), to: month.to });
    cashflow = report.cashflow;
    const current = report.cashflow.find((point) => point.period === month.from.slice(0, 7));
    monthReceipts = current?.receipts ?? 0;
    monthPayments = current?.payments ?? 0;
    const list = await listAccounts(db, tenantId, { includeInactive: false, withBalances: true });
    accounts = list.map(({ id, code, name, accountType, balance, pendingOut }) => ({ id, code, name, accountType, balance, pendingOut }));
    totalBalance = roundMoney(list.reduce((sum, account) => sum + (account.balance ?? 0), 0));
  }

  // Phiếu chờ duyệt thuộc quyền người xem: đúng loại phiếu mình duyệt, không tính phiếu của chính mình.
  const kinds = approvableKinds(actor);
  const pending = kinds.length
    ? ((
        await db.query(
          `SELECT count(*)::int AS n, COALESCE(SUM(total_amount),0) AS total FROM finance_schema.vouchers
            WHERE tenant_id=$1 AND status='PENDING' AND kind = ANY($2::text[]) AND created_by <> $3`,
          [tenantId, kinds, actor.userId],
        )
      ).rows[0] as Row)
    : { n: 0, total: 0 };
  const drafts = (
    await db.query(`SELECT count(*)::int AS n FROM finance_schema.vouchers WHERE tenant_id=$1 AND status IN ('DRAFT','REJECTED') AND created_by=$2`, [tenantId, actor.userId])
  ).rows[0] as Row;

  const visibleAll = canReadAll(actor);
  const recent = (
    await db.query(
      `${VOUCHER_SELECT} WHERE v.tenant_id = $1 AND ($2::boolean OR v.created_by = $3 OR v.kind = ANY($4::text[]))
        ORDER BY v.created_at DESC LIMIT 8`,
      [tenantId, visibleAll, actor.userId, kinds],
    )
  ).rows as Row[];

  return {
    today,
    monthFrom: month.from,
    monthTo: month.to,
    monthReceipts,
    monthPayments,
    monthNet: roundMoney(monthReceipts - monthPayments),
    totalBalance,
    pendingApprovalCount: num(pending.n),
    pendingApprovalAmount: roundMoney(num(pending.total)),
    myDraftCount: num(drafts.n),
    cashflow,
    accounts,
    recent: recent.map(mapSummary),
  };
}
