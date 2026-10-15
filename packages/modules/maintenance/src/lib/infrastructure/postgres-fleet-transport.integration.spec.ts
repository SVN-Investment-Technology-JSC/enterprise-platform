import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { FleetTransportService, parseTransport } from '../application/fleet-transport.service.js';
import type { MaintenanceActor, MaintenanceStore } from '../application/maintenance-store.port.js';
import { createIncidentTransportStore } from './postgres-fleet-transport.js';

const adminUrl = process.env['MAINTENANCE_TEST_ADMIN_URL'] ?? process.env['HRM_TEST_ADMIN_URL'];
const integration = adminUrl ? describe : describe.skip;

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
    ...pathsBetween('  maintenance: [', '  workspace: ['),
  ];
}

const VEHICLE = '11111111-1111-4111-8111-111111111111';
const DRIVER = '22222222-2222-4222-8222-222222222222';
const company = {
  mode: 'COMPANY_VEHICLE' as const,
  vehicleId: VEHICLE,
  driverId: DRIVER,
  startAt: '2027-06-01T01:00:00Z',
  endAt: '2027-06-01T09:00:00Z',
  destination: ' Trạm biến áp ',
};

describe('parseTransport (phiếu sự cố)', () => {
  it('xe công ty cần xe, tài xế và khung giờ hợp lệ; phương tiện ngoài cần loại phương tiện', () => {
    expect(parseTransport(company)).toMatchObject({ mode: 'COMPANY_VEHICLE', destination: 'Trạm biến áp' });
    expect(() => parseTransport({ ...company, vehicleId: undefined })).toThrow(/xe công ty/i);
    expect(() => parseTransport({ ...company, driverId: 'x' })).toThrow(/tài xế/i);
    expect(() => parseTransport({ ...company, endAt: company.startAt })).toThrow(/sau giờ đi/);
    expect(() => parseTransport({ ...company, endAt: '2027-06-20T09:00:00Z' })).toThrow(/7 ngày/);
    expect(parseTransport({ mode: 'EXTERNAL', detail: ' Taxi ' })).toEqual({ mode: 'EXTERNAL', detail: 'Taxi' });
    expect(() => parseTransport({ mode: 'EXTERNAL' })).toThrow(/loại phương tiện/);
  });
});

integration('Phương tiện của phiếu sự cố (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const actor = { tenantId, userId: randomUUID(), displayName: 'Kỹ thuật viên', canManage: false } as MaintenanceActor;
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let service: FleetTransportService;
  let store: ReturnType<typeof createIncidentTransportStore>;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    store = createIncidentTransportStore(async () => pool);
    service = new FleetTransportService(
      { fleetTransport: store } as unknown as MaintenanceStore,
      { read: async () => ({ vehicles: [], drivers: [] }) },
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  const outbox = async (incidentId: string) =>
    (
      await pool.query(
        `SELECT event_type, payload->'payload' AS payload FROM integration_schema.outbox_events
          WHERE aggregate_type = 'maintenance-fleet-transport' AND aggregate_id = $1 ORDER BY occurred_at, id`,
        [incidentId],
      )
    ).rows;

  it('xe công ty: ghi REQUESTED và phát sự kiện đặt xe với người yêu cầu; lưu lại y nguyên không phát lại; đổi sang phương tiện ngoài thì trả xe', async () => {
    const incident = { id: randomUUID(), label: 'INC-2027-AB12 Máy biến áp quá nhiệt' };
    await service.apply(actor, incident, parseTransport(company));
    expect(await service.find(actor, incident.id)).toMatchObject({
      mode: 'COMPANY_VEHICLE',
      status: 'REQUESTED',
      vehicleId: VEHICLE,
      destination: 'Trạm biến áp',
    });
    const [requested] = await outbox(incident.id);
    expect(requested.event_type).toBe('maintenance.fleet-booking.requested');
    expect(requested.payload).toMatchObject({
      sourceType: 'INCIDENT',
      sourceId: incident.id,
      sourceLabel: incident.label,
      requesterUserId: actor.userId,
      driverId: DRIVER,
    });

    await service.apply(actor, incident, parseTransport(company));
    expect(await outbox(incident.id)).toHaveLength(1);

    await service.apply(actor, incident, parseTransport({ mode: 'EXTERNAL', detail: 'Xe cá nhân' }));
    expect(await service.find(actor, incident.id)).toMatchObject({ mode: 'EXTERNAL', status: 'NONE', vehicleId: null });
    expect((await outbox(incident.id)).map((e) => e.event_type)).toEqual([
      'maintenance.fleet-booking.requested',
      'maintenance.fleet-booking.cancelled',
    ]);
  });

  it('bỏ phương tiện (null) trả xe và xoá dòng; undefined giữ nguyên', async () => {
    const incident = { id: randomUUID(), label: 'INC-2027-CD34 Mất tín hiệu SCADA' };
    await service.apply(actor, incident, parseTransport(company));
    await service.apply(actor, incident, undefined);
    expect(await service.find(actor, incident.id)).toMatchObject({ status: 'REQUESTED' });
    await service.apply(actor, incident, null);
    expect(await service.find(actor, incident.id)).toBeNull();
    expect((await outbox(incident.id)).map((e) => e.event_type)).toEqual([
      'maintenance.fleet-booking.requested',
      'maintenance.fleet-booking.cancelled',
    ]);
  });
});
