import { invalidMany } from '../domain/finance.error.js';
import { validateForSubmit, type NormalizedVoucher, type SubmitReferences } from '../domain/voucher.rules.js';
import { dateOnly, type Db } from './finance.database.js';
import type { QueryResultRow } from 'pg';

type Row = QueryResultRow & Record<string, unknown>;

/**
 * Tra cứu các tham chiếu cần để kiểm điều kiện gửi duyệt (`validateForSubmit`). Tách riêng khỏi `voucher-workflow.ts`
 * (nơi dùng đầu tiên, lúc gửi duyệt) để `vouchers.store.ts` cũng dùng được khi sửa phiếu đang chờ duyệt mà không tạo
 * vòng import (`voucher-workflow.ts` đã import ngược từ `vouchers.store.ts`).
 */
async function accountRef(db: Db, tenantId: string, id: string | null) {
  if (!id) return null;
  const row = (await db.query(`SELECT name, is_active, opening_date FROM finance_schema.accounts WHERE tenant_id=$1 AND id=$2`, [tenantId, id])).rows[0] as
    | Row
    | undefined;
  return row ? { name: String(row.name), isActive: Boolean(row.is_active), openingDate: dateOnly(row.opening_date) } : null;
}

export async function buildSubmitReferences(db: Db, tenantId: string, voucher: NormalizedVoucher): Promise<SubmitReferences> {
  const reason = voucher.reasonId
    ? ((await db.query(`SELECT kind, is_active FROM finance_schema.reasons WHERE tenant_id=$1 AND id=$2`, [tenantId, voucher.reasonId])).rows[0] as Row | undefined)
    : undefined;
  const group = voucher.counterpartyGroupId
    ? ((await db.query(`SELECT is_active FROM finance_schema.counterparty_groups WHERE tenant_id=$1 AND id=$2`, [tenantId, voucher.counterpartyGroupId])).rows[0] as Row | undefined)
    : undefined;
  return {
    account: await accountRef(db, tenantId, voucher.accountId),
    dest: await accountRef(db, tenantId, voucher.destAccountId),
    reason: reason ? { kind: String(reason.kind), isActive: Boolean(reason.is_active) } : null,
    counterpartyGroup: group ? { isActive: Boolean(group.is_active) } : null,
  };
}

/** Ném `FINANCE_SUBMIT_INVALID` (đủ danh sách lỗi) nếu phiếu chưa đủ điều kiện gửi duyệt. */
export async function assertSubmittable(db: Db, tenantId: string, voucher: NormalizedVoucher): Promise<void> {
  const errors = validateForSubmit(voucher, await buildSubmitReferences(db, tenantId, voucher));
  if (errors.length) throw invalidMany('FINANCE_SUBMIT_INVALID', errors);
}
