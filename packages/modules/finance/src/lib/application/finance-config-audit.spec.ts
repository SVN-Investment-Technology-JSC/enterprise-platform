import type { FinanceActor } from '../domain/finance.access.js';
import type { FinanceDatabase } from '../infrastructure/finance.database.js';
import { FinanceApplication } from './finance.application.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

const actor = (permissions: string[]): FinanceActor => ({
  tenantId: TENANT,
  userId: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Kế toán',
  permissions,
});

function setup() {
  const query = jest.fn(async (sql: string) => (sql.includes('count(*)') ? { rows: [{ n: 0 }] } : { rows: [] }));
  const database = { pool: jest.fn(async () => ({ query })) } as unknown as FinanceDatabase;
  return { app: new FinanceApplication(database, {} as never), query };
}

describe('API lịch sử cấu hình Tài chính (ISS-BE-034, SEC-BE034-13)', () => {
  it('không có finance.settings.manage thì 403, không đọc DB', async () => {
    const { app, query } = setup();
    await expect(app.configAudit(actor(['finance.read', 'finance.account.manage']), {})).rejects.toMatchObject({
      status: 403,
      code: 'FINANCE_FORBIDDEN',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('có finance.settings.manage (hoặc quản trị tenant) thì đọc được', async () => {
    const { app } = setup();
    await expect(app.configAudit(actor(['finance.settings.manage']), { entityType: 'SETTINGS' })).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    await expect(app.configAudit(actor(['tenant.manage']), {})).resolves.toMatchObject({ total: 0 });
  });
});
