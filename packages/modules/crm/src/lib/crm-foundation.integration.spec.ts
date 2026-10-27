import { randomUUID } from 'node:crypto';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { writeAuditLog } from './infrastructure/audit-log.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

integration('Bán hàng: migration nền và nhật ký (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('tạo crm_schema và đủ ba bảng nền', async () => {
    await expect(handle.database.schemaStatus(tenantId)).resolves.toEqual({ schemaExists: true, tablesReady: true });
    const { rows } = await handle.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm_schema' ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(['audit_log', 'integration_requests', 'settings']);
  });

  it('nhật ký ghi trong transaction: commit thì còn, rollback thì mất', async () => {
    const committed = randomUUID();
    const rolledBack = randomUUID();
    await handle.database.transaction(tenantId, (client) =>
      writeAuditLog(client, { entityType: 'quote', entityId: committed, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', action: 'submit', actorId: randomUUID() }),
    );
    await expect(
      handle.database.transaction(tenantId, async (client) => {
        await writeAuditLog(client, { entityType: 'quote', entityId: rolledBack, action: 'submit' });
        throw new Error('nghiệp vụ lỗi');
      }),
    ).rejects.toThrow('nghiệp vụ lỗi');
    const { rows } = await handle.pool.query<{ entity_id: string; to_status: string }>(
      `SELECT entity_id, to_status FROM crm_schema.audit_log WHERE entity_id = ANY($1::uuid[])`,
      [[committed, rolledBack]],
    );
    expect(rows).toEqual([{ entity_id: committed, to_status: 'SUBMITTED' }]);
  });

  it('khoá chống lặp của lệnh gửi phân hệ khác là duy nhất', async () => {
    const insert = `INSERT INTO crm_schema.integration_requests (target, operation, idempotency_key) VALUES ('inventory', 'reservation.create', $1)`;
    await handle.pool.query(insert, ['order-1:reserve']);
    await expect(handle.pool.query(insert, ['order-1:reserve'])).rejects.toMatchObject({ code: '23505' });
  });

  it('migration chạy lại được', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant/crm/0001-crm-foundation.sql'), 'utf8');
    await handle.pool.query(`BEGIN; ${sql}; COMMIT;`);
  });
});
