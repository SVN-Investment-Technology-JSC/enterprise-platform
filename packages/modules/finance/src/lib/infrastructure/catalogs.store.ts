import type {
  FinanceCatalogs,
  FinanceCounterpartyGroup,
  FinanceReason,
  FinanceSettings,
  SaveFinanceCounterpartyGroupRequest,
  SaveFinanceReasonRequest,
  SaveFinanceSettingsRequest,
} from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { conflict, invalid, notFound } from '../domain/finance.error.js';
import { isValidDate } from '../domain/voucher.rules.js';
import { dateOnly, optStr, type Db } from './finance.database.js';

type Row = QueryResultRow & Record<string, unknown>;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;

/** Nhóm đối tượng mặc định nạp một lần cho tenant mới; sau đó tenant tự quản. */
export const DEFAULT_COUNTERPARTY_GROUPS: readonly { code: string; name: string }[] = [
  { code: 'KHACH_HANG', name: 'Khách hàng' },
  { code: 'NHA_CUNG_CAP', name: 'Nhà cung cấp' },
  { code: 'NHAN_VIEN', name: 'Nhân viên' },
  { code: 'DOI_TAC', name: 'Đối tác' },
  { code: 'KHAC', name: 'Khác' },
];

/** Nạp nhóm đối tượng mặc định đúng một lần (cờ defaults_seeded), an toàn khi gọi đồng thời. */
export async function ensureDefaults(db: Db, tenantId: string): Promise<void> {
  const claimed = (
    await db.query(
      `INSERT INTO finance_schema.settings (tenant_id, defaults_seeded) VALUES ($1, TRUE)
       ON CONFLICT (tenant_id) DO UPDATE SET defaults_seeded = TRUE WHERE finance_schema.settings.defaults_seeded = FALSE
       RETURNING tenant_id`,
      [tenantId],
    )
  ).rows[0];
  if (!claimed) return;
  for (const group of DEFAULT_COUNTERPARTY_GROUPS)
    await db.query(
      `INSERT INTO finance_schema.counterparty_groups (tenant_id, code, name) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, group.code, group.name],
    );
}

const mapReason = (row: Row): FinanceReason => ({
  id: String(row.id),
  kind: row.kind as FinanceReason['kind'],
  code: String(row.code),
  name: String(row.name),
  isActive: Boolean(row.is_active),
  note: optStr(row.note),
});
const mapGroup = (row: Row): FinanceCounterpartyGroup => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  isActive: Boolean(row.is_active),
});

export async function listCatalogs(db: Db, tenantId: string, includeInactive: boolean): Promise<FinanceCatalogs> {
  await ensureDefaults(db, tenantId);
  const active = includeInactive ? '' : 'AND is_active';
  const reasons = await db.query(`SELECT * FROM finance_schema.reasons WHERE tenant_id=$1 ${active} ORDER BY kind, name`, [tenantId]);
  const groups = await db.query(`SELECT * FROM finance_schema.counterparty_groups WHERE tenant_id=$1 ${active} ORDER BY name`, [tenantId]);
  return {
    reasons: (reasons.rows as Row[]).map(mapReason),
    counterpartyGroups: (groups.rows as Row[]).map(mapGroup),
  };
}

function codeAndName(input: { code: string; name: string }, label: string): { code: string; name: string } {
  const code = String(input.code ?? '').trim();
  if (!CODE.test(code)) throw invalid(`Mã ${label} chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới (tối đa 50 ký tự).`);
  const name = String(input.name ?? '').trim();
  if (!name) throw invalid(`Tên ${label} là bắt buộc.`);
  if (name.length > 255) throw invalid(`Tên ${label} tối đa 255 ký tự.`);
  return { code, name };
}

async function guardedWrite<T>(code: string, label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw conflict('FINANCE_CODE_EXISTS', `Mã ${label} ${code} đã tồn tại.`);
    throw error;
  }
}

export async function saveReason(db: Db, tenantId: string, id: string | null, input: SaveFinanceReasonRequest): Promise<FinanceReason> {
  if (input.kind !== 'RECEIPT' && input.kind !== 'PAYMENT') throw invalid('Loại lý do không hợp lệ.');
  const { code, name } = codeAndName(input, 'lý do');
  const note = input.note?.trim() || null;
  return guardedWrite(code, 'lý do', async () => {
    if (!id) {
      const row = (
        await db.query(
          `INSERT INTO finance_schema.reasons (tenant_id, kind, code, name, is_active, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId, input.kind, code, name, input.isActive !== false, note],
        )
      ).rows[0] as Row;
      return mapReason(row);
    }
    const current = (await db.query(`SELECT kind FROM finance_schema.reasons WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0] as Row | undefined;
    if (!current) throw notFound('lý do');
    if (current.kind !== input.kind) {
      const used = (
        await db.query(`SELECT count(*) AS n FROM finance_schema.vouchers WHERE reason_id=$1`, [id])
      ).rows[0] as Row;
      if (Number(used.n) > 0) throw conflict('FINANCE_REASON_IN_USE', 'Lý do đã được dùng nên không đổi được loại thu/chi.');
    }
    const row = (
      await db.query(
        `UPDATE finance_schema.reasons SET kind=$3, code=$4, name=$5, is_active=COALESCE($6, is_active), note=$7, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, input.kind, code, name, input.isActive ?? null, note],
      )
    ).rows[0] as Row;
    return mapReason(row);
  });
}

export async function saveCounterpartyGroup(
  db: Db,
  tenantId: string,
  id: string | null,
  input: SaveFinanceCounterpartyGroupRequest,
): Promise<FinanceCounterpartyGroup> {
  const { code, name } = codeAndName(input, 'đối tượng');
  return guardedWrite(code, 'đối tượng', async () => {
    const row = (
      id
        ? await db.query(
            `UPDATE finance_schema.counterparty_groups SET code=$3, name=$4, is_active=COALESCE($5, is_active), updated_at=now()
              WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [tenantId, id, code, name, input.isActive ?? null],
          )
        : await db.query(
            `INSERT INTO finance_schema.counterparty_groups (tenant_id, code, name, is_active) VALUES ($1,$2,$3,$4) RETURNING *`,
            [tenantId, code, name, input.isActive !== false],
          )
    ).rows[0] as Row | undefined;
    if (!row) throw notFound('đối tượng');
    return mapGroup(row);
  });
}

export async function loadSettings(db: Db, tenantId: string): Promise<FinanceSettings> {
  const row = (await db.query(`SELECT books_locked_until, allow_self_approval FROM finance_schema.settings WHERE tenant_id=$1`, [tenantId])).rows[0] as
    | Row
    | undefined;
  return {
    booksLockedUntil: row?.books_locked_until ? dateOnly(row.books_locked_until) : null,
    allowSelfApproval: row ? Boolean(row.allow_self_approval) : false,
  };
}

export async function saveSettings(db: Db, tenantId: string, actorId: string, input: SaveFinanceSettingsRequest): Promise<FinanceSettings> {
  if (input.booksLockedUntil !== undefined && input.booksLockedUntil !== null && !isValidDate(input.booksLockedUntil))
    throw invalid('Ngày khoá sổ không hợp lệ.');
  const current = await loadSettings(db, tenantId);
  const lock = input.booksLockedUntil === undefined ? current.booksLockedUntil : input.booksLockedUntil;
  // Mở lại sổ (lùi hoặc bỏ ngày khoá) là thao tác nhạy cảm nhưng hợp lệ: kế toán trưởng có thể sửa sai kỳ.
  const self = input.allowSelfApproval ?? current.allowSelfApproval;
  await db.query(
    `INSERT INTO finance_schema.settings (tenant_id, books_locked_until, allow_self_approval, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (tenant_id) DO UPDATE SET books_locked_until=EXCLUDED.books_locked_until, allow_self_approval=EXCLUDED.allow_self_approval,
       updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [tenantId, lock, self, actorId],
  );
  return { booksLockedUntil: lock, allowSelfApproval: self };
}
