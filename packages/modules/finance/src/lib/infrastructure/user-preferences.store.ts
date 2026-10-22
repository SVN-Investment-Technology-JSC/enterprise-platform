import { FINANCE_VOUCHER_KINDS, type FinanceListColumns, type FinanceVoucherKind } from '@enterprise-platform/contracts-finance';
import { invalid } from '../domain/finance.error.js';
import type { Db } from './finance.database.js';

const COLUMN_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_COLUMNS = 30;

function assertListKey(listKey: string): asserts listKey is FinanceVoucherKind {
  if (!FINANCE_VOUCHER_KINDS.includes(listKey as FinanceVoucherKind)) throw invalid('Danh sách không hợp lệ.');
}

/** Cột người dùng đã chọn cho một danh sách phiếu; `columns: null` khi chưa chọn (giao diện dùng bộ cột mặc định). */
export async function loadListColumns(db: Db, tenantId: string, userId: string, listKey: string): Promise<FinanceListColumns> {
  assertListKey(listKey);
  const row = (
    await db.query(`SELECT columns FROM finance_schema.user_list_columns WHERE tenant_id=$1 AND user_id=$2 AND list_key=$3`, [tenantId, userId, listKey])
  ).rows[0] as { columns?: unknown } | undefined;
  const columns = Array.isArray(row?.columns) ? row.columns.filter((key): key is string => typeof key === 'string') : null;
  return { listKey, columns };
}

/**
 * Lưu cột hiển thị của riêng người dùng. Máy chủ chỉ kiểm hình dạng (mã cột ngắn, không trùng, không quá nhiều);
 * cột nào tồn tại là việc của giao diện, mã lạ bị bỏ qua khi hiển thị. `columns: null` xoá cấu hình, về bộ mặc định.
 */
export async function saveListColumns(db: Db, tenantId: string, userId: string, listKey: string, columns: unknown): Promise<FinanceListColumns> {
  assertListKey(listKey);
  if (columns === null) {
    await db.query(`DELETE FROM finance_schema.user_list_columns WHERE tenant_id=$1 AND user_id=$2 AND list_key=$3`, [tenantId, userId, listKey]);
    return { listKey, columns: null };
  }
  if (!Array.isArray(columns) || columns.length > MAX_COLUMNS || columns.some((key) => typeof key !== 'string' || !COLUMN_KEY.test(key)))
    throw invalid('Danh sách cột không hợp lệ.');
  const unique = [...new Set(columns as string[])];
  await db.query(
    `INSERT INTO finance_schema.user_list_columns (tenant_id, user_id, list_key, columns, updated_at) VALUES ($1,$2,$3,$4::jsonb,now())
     ON CONFLICT (tenant_id, user_id, list_key) DO UPDATE SET columns=EXCLUDED.columns, updated_at=now()`,
    [tenantId, userId, listKey, JSON.stringify(unique)],
  );
  return { listKey, columns: unique };
}
