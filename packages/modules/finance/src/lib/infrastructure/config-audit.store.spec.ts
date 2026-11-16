import type { SaveFinanceAccountRequest } from '@enterprise-platform/contracts-finance';
import { FinanceError } from '../domain/finance.error.js';
import { saveAccount } from './accounts.store.js';
import { saveSettings } from './catalogs.store.js';
import { diffFields, listConfigAudit } from './config-audit.store.js';
import type { Db } from './finance.database.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const ACCOUNT = '00000000-0000-4000-8000-0000000000aa';
const ACTOR = { id: '00000000-0000-4000-8000-0000000000bb', name: 'Kế toán trưởng' };

interface AuditRow {
  entityType: string;
  entityId: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
}

/** Db giả: trả dòng theo câu SQL, ghi lại các dòng lịch sử được chèn. */
function fakeDb(rows: { settings?: Record<string, unknown>; account?: Record<string, unknown> }) {
  const audits: AuditRow[] = [];
  type Result = { rows: Record<string, unknown>[]; rowCount?: number };
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<Result> => {
    if (sql.includes('INSERT INTO finance_schema.config_audit')) {
      const [, entityType, entityId, field, oldValue, newValue, reason, actorId, actorName] = params as (string | null)[];
      audits.push({ entityType: entityType as string, entityId, field: field as string, oldValue, newValue, reason, actorId, actorName });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM finance_schema.settings')) return { rows: rows.settings ? [rows.settings] : [] };
    if (sql.includes('FROM finance_schema.accounts a WHERE a.tenant_id')) return { rows: rows.account ? [rows.account] : [] };
    return { rows: [], rowCount: 1 };
  });
  return { db: { query } as unknown as Db, query, audits };
}

const ACCOUNT_ROW = {
  id: ACCOUNT,
  code: 'QUY-TM',
  name: 'Quỹ tiền mặt',
  account_type: 'CASH',
  bank_name: null,
  account_number: null,
  account_holder: null,
  branch: null,
  opening_balance: '1000000.00',
  opening_date: '2026-01-01',
  allow_negative: false,
  is_active: true,
  note: null,
};

const cashInput = (extra: Partial<SaveFinanceAccountRequest> = {}): SaveFinanceAccountRequest => ({
  code: 'QUY-TM',
  name: 'Quỹ tiền mặt',
  accountType: 'CASH',
  ...extra,
});

describe('lịch sử cấu hình Tài chính (ISS-BE-034)', () => {
  it('SEC-BE034-08: saveSettings đổi allowSelfApproval ghi đúng 1 dòng giá trị cũ, mới', async () => {
    const { db, audits } = fakeDb({ settings: { books_locked_until: null, allow_self_approval: false } });
    await saveSettings(db, TENANT, ACTOR, { allowSelfApproval: true, reason: ' Thiếu người duyệt ' });
    expect(audits).toEqual([
      {
        entityType: 'SETTINGS',
        entityId: null,
        field: 'allowSelfApproval',
        oldValue: 'false',
        newValue: 'true',
        reason: 'Thiếu người duyệt',
        actorId: ACTOR.id,
        actorName: ACTOR.name,
      },
    ]);
  });

  it('saveSettings mở khoá sổ ghi 1 dòng ngày khoá cũ → trống; lưu lại giá trị cũ không ghi gì', async () => {
    const { db, audits } = fakeDb({ settings: { books_locked_until: '2026-03-31', allow_self_approval: false } });
    await saveSettings(db, TENANT, ACTOR, { booksLockedUntil: null });
    expect(audits).toMatchObject([{ field: 'booksLockedUntil', oldValue: '2026-03-31', newValue: null }]);
    const same = fakeDb({ settings: { books_locked_until: '2026-03-31', allow_self_approval: false } });
    await saveSettings(same.db, TENANT, ACTOR, { booksLockedUntil: '2026-03-31', allowSelfApproval: false });
    expect(same.audits).toEqual([]);
  });

  it('SEC-BE034-09: đổi số dư đầu kỳ của tài khoản đã có bút toán mà không có lý do thì 400, không cập nhật', async () => {
    const { db, query, audits } = fakeDb({ account: { ...ACCOUNT_ROW, has_ledger: true } });
    const error = await saveAccount(db, TENANT, ACTOR, ACCOUNT, cashInput({ openingBalance: 1_500_000 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FinanceError);
    expect(error).toMatchObject({ status: 400, code: 'FINANCE_REASON_REQUIRED' });
    expect((error as Error).message).toMatch(/^Phải nhập lý do khi sửa số dư đầu kỳ/);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE finance_schema.accounts'))).toBe(false);
    expect(audits).toEqual([]);
  });

  it('SEC-BE034-11: có lý do thì lưu và ghi dòng lịch sử kèm lý do', async () => {
    const { db, audits } = fakeDb({ account: { ...ACCOUNT_ROW, has_ledger: true } });
    await saveAccount(db, TENANT, ACTOR, ACCOUNT, cashInput({ openingBalance: 1_500_000, reason: 'Đối chiếu MISA' }));
    expect(audits).toEqual([
      {
        entityType: 'ACCOUNT',
        entityId: ACCOUNT,
        field: 'openingBalance',
        oldValue: '1000000',
        newValue: '1500000',
        reason: 'Đối chiếu MISA',
        actorId: ACTOR.id,
        actorName: ACTOR.name,
      },
    ]);
  });

  it('gửi lại đúng số dư đầu kỳ cũ (không đổi) thì không đòi lý do; tài khoản chưa có bút toán đổi số dư không cần lý do', async () => {
    const same = fakeDb({ account: { ...ACCOUNT_ROW, has_ledger: true } });
    await saveAccount(same.db, TENANT, ACTOR, ACCOUNT, cashInput({ openingBalance: 1_000_000 }));
    expect(same.audits).toEqual([]);
    const fresh = fakeDb({ account: { ...ACCOUNT_ROW, has_ledger: false } });
    await saveAccount(fresh.db, TENANT, ACTOR, ACCOUNT, cashInput({ openingBalance: 2_000_000 }));
    expect(fresh.audits).toMatchObject([{ field: 'openingBalance', oldValue: '1000000', newValue: '2000000', reason: null }]);
  });

  it('SEC-BE034-12: đổi "cho phép âm" của quỹ ghi 1 dòng', async () => {
    const { db, audits } = fakeDb({ account: { ...ACCOUNT_ROW, has_ledger: true } });
    await saveAccount(db, TENANT, ACTOR, ACCOUNT, cashInput({ allowNegative: true }));
    expect(audits).toMatchObject([{ entityType: 'ACCOUNT', field: 'allowNegative', oldValue: 'false', newValue: 'true' }]);
  });

  it('tạo tài khoản mới không ghi lịch sử sửa', async () => {
    const { db, query, audits } = fakeDb({});
    query.mockImplementationOnce(async () => ({ rows: [{ id: ACCOUNT }], rowCount: 1 }));
    await expect(saveAccount(db, TENANT, ACTOR, null, cashInput({ openingBalance: 5_000 }))).resolves.toBe(ACCOUNT);
    expect(audits).toEqual([]);
  });

  it('diffFields so theo dạng chữ, bỏ trường không đổi', () => {
    expect(diffFields({ a: 1, b: null, c: true }, { a: 1, b: '', c: false }, ['a', 'b', 'c'])).toEqual([
      { field: 'c', oldValue: 'true', newValue: 'false' },
    ]);
  });

  it('listConfigAudit từ chối loại và id không hợp lệ, trả trang mới nhất trước', async () => {
    const { db, query } = fakeDb({});
    await expect(listConfigAudit(db, TENANT, { entityType: 'VOUCHER' })).rejects.toMatchObject({ code: 'FINANCE_INVALID' });
    await expect(listConfigAudit(db, TENANT, { entityId: 'x' })).rejects.toMatchObject({ code: 'FINANCE_INVALID' });
    query.mockImplementationOnce(async () => ({ rows: [{ n: '1' }] }));
    query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'r1',
          entity_type: 'ACCOUNT',
          entity_id: ACCOUNT,
          account_code: 'QUY-TM',
          account_name: 'Quỹ tiền mặt',
          field: 'allowNegative',
          old_value: 'false',
          new_value: 'true',
          reason: null,
          actor_id: ACTOR.id,
          actor_name: ACTOR.name,
          created_at: new Date('2026-11-15T03:00:00Z'),
        },
      ],
    }));
    const page = await listConfigAudit(db, TENANT, { entityType: 'account', entityId: ACCOUNT });
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(page.items[0]).toMatchObject({ entityLabel: 'QUY-TM - Quỹ tiền mặt', field: 'allowNegative', createdAt: '2026-11-15T03:00:00.000Z' });
    expect(query.mock.calls.at(-1)?.[1]).toEqual([TENANT, 'ACCOUNT', ACCOUNT, 50, 0]);
  });
});
