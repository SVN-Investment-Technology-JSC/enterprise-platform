import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { PlatformIdentityService } from './platform-identity.service.js';

// jose là ESM thuần; Jest không cần chữ ký thật cho phần Core này.
jest.mock('jose', () => ({
  exportJWK: jest.fn(),
  generateKeyPair: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

// Opt-in: tạo và xóa CHỈ các database ngẫu nhiên tên appointment_test_*.
const integration = process.env.RBAC_TEST_ADMIN_URL ? describe : describe.skip;
integration('Core applyAppointment PostgreSQL integration', () => {
  const databaseName = 'appointment_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const treeId = randomUUID();
  const unitId = randomUUID();
  const posStaff = randomUUID();
  const posLead = randomUUID();
  const posOther = randomUUID();
  const userId = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let service: PlatformIdentityService;

  const active = async () =>
    (
      await pool.query(
        `SELECT node_id, is_primary, status, start_date::text, end_date::text, source_decision_id
           FROM core_schema.organization_node_assignments
          WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at, start_date`,
        [userId],
      )
    ).rows;

  beforeAll(async () => {
    const url = new URL(process.env.RBAC_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Integration tests require a local disposable PostgreSQL server.');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const file of [
      '0001-core-schema.sql',
      '0002-organization-soft-delete.sql',
      '0004-organization-category.sql',
      '0006-employees.sql',
      '0007-org-hrm-bridge.sql',
      '0009-assignment-source-decision.sql',
    ])
      await pool.query(
        await readFile(
          resolve(process.cwd(), '../../../migrations/tenant/core', file),
          'utf8',
        ),
      );
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'An', 'an@test.local', 'x')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO core_schema.organization_trees (id, code, name, is_primary) VALUES ($1, 'main', 'Chính', true)`,
      [treeId],
    );
    await pool.query(
      `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name) VALUES ($1, $2, 'unit', 'KT', 'Kỹ thuật')`,
      [unitId, treeId],
    );
    for (const [id, code] of [
      [posStaff, 'NV'],
      [posLead, 'TP'],
      [posOther, 'KN'],
    ])
      await pool.query(
        `INSERT INTO core_schema.organization_nodes (id, tree_id, parent_id, category, code, name) VALUES ($1, $2, $3, 'position', $4, $4)`,
        [id, treeId, unitId, code],
      );
    // Chỉ cần withTenantCoreDatabase: chạy thao tác trên database thử nghiệm.
    service = Object.create(PlatformIdentityService.prototype) as PlatformIdentityService;
    (service as unknown as Record<string, unknown>)['withTenantCoreDatabase'] = (
      _tenantId: string,
      operation: (p: typeof pool) => Promise<unknown>,
    ) => operation(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^appointment_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  it('giao chức danh đầu tiên làm chức danh chính', async () => {
    const decisionId = randomUUID();
    const result = await service.applyAppointment(tenantId, {
      decisionId,
      action: 'ASSIGN',
      userId,
      nodeId: posStaff,
      effectiveDate: '2026-01-01',
      endCurrent: true,
      isPrimary: true,
      note: 'QDNS-2026-0001',
    });
    expect(result).toMatchObject({ endedAssignmentIds: [], replayed: false });
    const rows = await active();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      node_id: posStaff,
      is_primary: true,
      status: 'active',
      start_date: '2026-01-01',
      source_decision_id: decisionId,
    });
  });

  it('thử lại cùng quyết định không tạo thêm phân công (idempotent)', async () => {
    const decisionId = (await active())[0].source_decision_id as string;
    const again = await service.applyAppointment(tenantId, {
      decisionId,
      action: 'ASSIGN',
      userId,
      nodeId: posStaff,
      effectiveDate: '2026-01-01',
      endCurrent: true,
      isPrimary: true,
    });
    expect(again.replayed).toBe(true);
    expect(await active()).toHaveLength(1);
  });

  it('thăng chức kết thúc phân công chính cũ đến hết ngày trước hiệu lực', async () => {
    const result = await service.applyAppointment(tenantId, {
      decisionId: randomUUID(),
      action: 'ASSIGN',
      userId,
      nodeId: posLead,
      effectiveDate: '2026-02-01',
      endCurrent: true,
      isPrimary: true,
    });
    expect(result.endedAssignmentIds).toHaveLength(1);
    const rows = await active();
    const old = rows.find((r) => r.node_id === posStaff);
    const current = rows.find((r) => r.node_id === posLead);
    expect(old).toMatchObject({ status: 'ended', end_date: '2026-01-31', is_primary: false });
    expect(current).toMatchObject({ status: 'active', is_primary: true, start_date: '2026-02-01' });
  });

  it('kiêm nhiệm giữ nguyên chức danh chính', async () => {
    await service.applyAppointment(tenantId, {
      decisionId: randomUUID(),
      action: 'ASSIGN',
      userId,
      nodeId: posOther,
      effectiveDate: '2026-03-01',
      endCurrent: false,
      isPrimary: false,
    });
    const rows = await active();
    expect(rows.find((r) => r.node_id === posLead)?.is_primary).toBe(true);
    expect(rows.find((r) => r.node_id === posOther)).toMatchObject({
      is_primary: false,
      status: 'active',
    });
  });

  it('không giao lại chức danh đang giữ và không giao vào node không phải chức danh', async () => {
    await expect(
      service.applyAppointment(tenantId, {
        decisionId: randomUUID(),
        action: 'ASSIGN',
        userId,
        nodeId: posLead,
        effectiveDate: '2026-04-01',
        endCurrent: true,
      }),
    ).rejects.toThrow(/đang giữ chức danh này/);
    await expect(
      service.applyAppointment(tenantId, {
        decisionId: randomUUID(),
        action: 'ASSIGN',
        userId,
        nodeId: unitId,
        effectiveDate: '2026-04-01',
        endCurrent: true,
      }),
    ).rejects.toThrow(/POSITION/);
  });

  it('miễn nhiệm kết thúc đúng phân công được chỉ định', async () => {
    const result = await service.applyAppointment(tenantId, {
      decisionId: randomUUID(),
      action: 'END',
      userId,
      nodeId: posOther,
      effectiveDate: '2026-05-01',
    });
    expect(result.endedAssignmentIds).toHaveLength(1);
    const rows = await active();
    expect(rows.find((r) => r.node_id === posOther)).toMatchObject({
      status: 'ended',
      end_date: '2026-04-30',
    });
    expect(rows.find((r) => r.node_id === posLead)?.status).toBe('active');
  });

  it('miễn nhiệm người không còn phân công nào báo lỗi rõ ràng', async () => {
    await expect(
      service.applyAppointment(tenantId, {
        decisionId: randomUUID(),
        action: 'END',
        userId,
        nodeId: posStaff,
        effectiveDate: '2026-06-01',
      }),
    ).rejects.toThrow(/không có phân công đang hiệu lực/);
  });

  it('từ chối đầu vào thiếu hoặc sai', async () => {
    await expect(
      service.applyAppointment(tenantId, { action: 'ASSIGN', userId, nodeId: posLead, effectiveDate: '2026-06-01' }),
    ).rejects.toThrow(/Thiếu Quyết định/);
    await expect(
      service.applyAppointment(tenantId, {
        decisionId: randomUUID(),
        action: 'ASSIGN',
        userId,
        effectiveDate: '2026-06-01',
      }),
    ).rejects.toThrow(/chức danh/);
    await expect(
      service.applyAppointment(tenantId, {
        decisionId: randomUUID(),
        action: 'ASSIGN',
        userId,
        nodeId: posLead,
        effectiveDate: '01/06/2026',
      }),
    ).rejects.toThrow(/Ngày hiệu lực không hợp lệ/);
  });
});
