import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { createFleetTransportStore } from './postgres-fleet-transport.js';
import { receiveWorkspaceIntegrationEvent } from './project-request-events.js';

const integration = process.env.WORKSPACE_TEST_ADMIN_URL ?? process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const pathsBetween = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...pathsBetween('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...pathsBetween('  workspace: [', '};'),
  ];
}

integration('Phương tiện của công việc và lịch họp (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const vehicleId = randomUUID();
  const driverId = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: ReturnType<typeof createFleetTransportStore>;

  beforeAll(async () => {
    const url = new URL((process.env.WORKSPACE_TEST_ADMIN_URL ?? process.env.HRM_TEST_ADMIN_URL)!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    store = createFleetTransportStore(async () => pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  const outbox = async (sourceId: string) =>
    (
      await pool.query(
        `SELECT event_type, payload->'payload' AS payload FROM integration_schema.outbox_events
          WHERE aggregate_type = 'workspace-fleet-transport' AND aggregate_id = $1 ORDER BY occurred_at, id`,
        [sourceId],
      )
    ).rows;
  const company = (sourceId: string, over: Record<string, unknown> = {}) => ({
    sourceType: 'WORK_ITEM' as const,
    sourceId,
    sourceLabel: 'CV-001 Khảo sát hiện trường',
    requesterUserId: randomUUID(),
    mode: 'COMPANY_VEHICLE' as const,
    vehicleId,
    driverId,
    startAt: '2027-03-01T01:00:00.000Z',
    endAt: '2027-03-01T09:00:00.000Z',
    destination: 'Bình Dương',
    ...over,
  });
  const hrmReply = (type: string, payload: Record<string, unknown>) =>
    createIntegrationEvent({ id: randomUUID(), type, tenantId, source: 'hrm', correlationId: String(payload.sourceId), payload });

  it('xe công ty: ghi REQUESTED và phát sự kiện đặt xe; lưu lại y nguyên thì không phát lại; đổi sang phương tiện ngoài thì trả xe', async () => {
    const sourceId = randomUUID();
    const saved = await store.save(tenantId, company(sourceId));
    expect(saved).toMatchObject({ mode: 'COMPANY_VEHICLE', status: 'REQUESTED', vehicleId, driverId, destination: 'Bình Dương' });
    const [requested] = await outbox(sourceId);
    expect(requested.event_type).toBe('workspace.fleet-booking.requested');
    expect(requested.payload).toMatchObject({ sourceType: 'WORK_ITEM', sourceId, vehicleId, driverId, destination: 'Bình Dương' });

    await store.save(tenantId, { ...company(sourceId), requesterUserId: randomUUID() });
    expect(await outbox(sourceId)).toHaveLength(1);

    const external = await store.save(tenantId, {
      sourceType: 'WORK_ITEM',
      sourceId,
      sourceLabel: 'CV-001 Khảo sát hiện trường',
      requesterUserId: randomUUID(),
      mode: 'EXTERNAL',
      detail: 'Máy bay',
    });
    expect(external).toMatchObject({ mode: 'EXTERNAL', status: 'NONE', vehicleId: null, detail: 'Máy bay' });
    expect((await outbox(sourceId)).map((e) => e.event_type)).toEqual([
      'workspace.fleet-booking.requested',
      'workspace.fleet-booking.cancelled',
    ]);
  });

  it('HRM trả lời confirmed hoặc conflicted thì cập nhật trạng thái; trả lời của nguồn khác hay của lựa chọn đã đổi bị bỏ qua', async () => {
    const sourceId = randomUUID();
    await store.save(tenantId, company(sourceId, { sourceType: 'CALENDAR_EVENT' }));
    const statusOf = async () => (await store.find(tenantId, 'CALENDAR_EVENT', sourceId))?.status;

    await receiveWorkspaceIntegrationEvent(
      pool,
      tenantId,
      hrmReply('hrm.fleet-booking.confirmed', { sourceType: 'CALENDAR_EVENT', sourceId, bookingId: randomUUID() }),
    );
    expect(await statusOf()).toBe('CONFIRMED');

    await receiveWorkspaceIntegrationEvent(
      pool,
      tenantId,
      hrmReply('hrm.fleet-booking.conflicted', { sourceType: 'CALENDAR_EVENT', sourceId, reason: 'Xe 51A-111.11 đã có lịch' }),
    );
    expect(await statusOf()).toBe('CONFLICT');
    expect((await store.find(tenantId, 'CALENDAR_EVENT', sourceId))?.statusReason).toBe('Xe 51A-111.11 đã có lịch');

    // Sự kiện cho sự cố (của Maintenance) không đụng tới dòng này.
    await receiveWorkspaceIntegrationEvent(pool, tenantId, hrmReply('hrm.fleet-booking.confirmed', { sourceType: 'INCIDENT', sourceId }));
    expect(await statusOf()).toBe('CONFLICT');

    // Đặt lại sau xung đột: trạng thái về REQUESTED, lý do được xoá.
    await store.save(
      tenantId,
      company(sourceId, {
        sourceType: 'CALENDAR_EVENT',
        startAt: '2027-03-02T01:00:00.000Z',
        endAt: '2027-03-02T05:00:00.000Z',
      }),
    );
    const again = await store.find(tenantId, 'CALENDAR_EVENT', sourceId);
    expect(again).toMatchObject({ status: 'REQUESTED', statusReason: null });
  });

  it('bỏ phương tiện hoặc nguồn bị huỷ thì xoá dòng và trả xe; phương tiện ngoài thì không có gì để trả', async () => {
    const sourceId = randomUUID();
    await store.save(tenantId, company(sourceId));
    await store.clear(tenantId, 'WORK_ITEM', sourceId);
    expect(await store.find(tenantId, 'WORK_ITEM', sourceId)).toBeUndefined();
    expect((await outbox(sourceId)).map((e) => e.event_type)).toEqual([
      'workspace.fleet-booking.requested',
      'workspace.fleet-booking.cancelled',
    ]);

    const outside = randomUUID();
    await store.save(tenantId, {
      sourceType: 'WORK_ITEM',
      sourceId: outside,
      sourceLabel: 'x',
      requesterUserId: randomUUID(),
      mode: 'EXTERNAL',
      detail: 'Taxi hoặc xe ngoài',
    });
    await store.clear(tenantId, 'WORK_ITEM', outside);
    expect(await outbox(outside)).toEqual([]);
  });
});
