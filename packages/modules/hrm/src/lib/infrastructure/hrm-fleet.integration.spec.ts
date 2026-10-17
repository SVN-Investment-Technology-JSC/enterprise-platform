import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { receiveFleetBookingEvent } from './hrm-fleet-events';
import {
  cancelFleetBookingBySource,
  findAvailability,
  listBookings,
  saveDriver,
  saveVehicle,
  saveRequestTransport,
  upsertFleetBooking,
} from './hrm-fleet';

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

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
    ...pathsBetween('  hrm: [', '  inventory: ['),
  ];
}

integration('Lịch xe công ty (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let vehicleA: string;
  let vehicleB: string;
  let driverA: string;
  let driverB: string;
  let requester: string;

  const person = async (code: string) => {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.users (id,username,full_name,email,password_hash) VALUES ($1,$2,$2,$3,'x')`,
      [userId, `${code}-${userId.slice(0, 6)}`, `${userId}@t.local`],
    );
    const id = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees (id,tenant_id,user_id,full_name,work_email) VALUES ($1,$2,$3,$4,$5)`,
      [id, tenantId, userId, code, `${userId}@t.local`],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id,tenant_id,employee_code,join_date) VALUES ($1,$2,$3,'2020-01-01')`,
      [id, tenantId, code],
    );
    return id;
  };

  const book = (over: Record<string, unknown>) =>
    upsertFleetBooking(pool, tenantId, {
      sourceType: 'WORK_ITEM',
      sourceId: randomUUID(),
      vehicleId: vehicleA,
      driverId: driverA,
      startAt: '2026-11-10T01:00:00Z',
      endAt: '2026-11-10T09:00:00Z',
      status: 'CONFIRMED',
      ...over,
    });

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    vehicleA = (await saveVehicle(pool, tenantId, null, { plateNo: '51A-111.11', name: 'Innova', seats: 7 })).id;
    vehicleB = (await saveVehicle(pool, tenantId, null, { plateNo: '51A-222.22', name: 'Ford Transit', seats: 16 })).id;
    driverA = (await saveDriver(pool, tenantId, null, { employeeId: await person('DRV-A') })).id;
    driverB = (await saveDriver(pool, tenantId, null, { employeeId: await person('DRV-B') })).id;
    requester = await person('REQ');
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  it('chặn trùng lịch cả theo xe lẫn theo tài xế; sát biên thì không trùng', async () => {
    await book({});
    await expect(book({ driverId: driverB, startAt: '2026-11-10T08:00:00Z', endAt: '2026-11-10T10:00:00Z' })).rejects.toMatchObject({
      response: { code: 'HRM_FLEET_CONFLICT', resource: 'VEHICLE' },
    });
    await expect(book({ vehicleId: vehicleB, startAt: '2026-11-10T08:00:00Z', endAt: '2026-11-10T10:00:00Z' })).rejects.toMatchObject({
      response: { code: 'HRM_FLEET_CONFLICT', resource: 'DRIVER' },
    });
    await expect(book({ startAt: '2026-11-10T09:00:00Z', endAt: '2026-11-10T11:00:00Z' })).resolves.toBeTruthy();
  });

  it('sửa lịch của chính nguồn không tự trùng với lịch cũ của nó', async () => {
    const sourceId = randomUUID();
    const base = { sourceId, vehicleId: vehicleB, driverId: driverB, startAt: '2026-11-12T01:00:00Z', endAt: '2026-11-12T05:00:00Z' };
    const first = await book(base);
    const again = await book({ ...base, endAt: '2026-11-12T07:00:00Z' });
    expect(again.id).toBe(first.id);
  });

  it('availability liệt kê khoảng bận của xe và tài xế, bỏ qua nguồn được loại trừ', async () => {
    const sourceId = randomUUID();
    await book({ sourceId, vehicleId: vehicleB, driverId: driverB, startAt: '2026-11-15T01:00:00Z', endAt: '2026-11-15T05:00:00Z', sourceLabel: 'Họp khách hàng' });
    const busy = await findAvailability(pool, tenantId, '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z');
    expect(busy.vehicles.find((v) => v.id === vehicleB)?.busy).toEqual([
      expect.objectContaining({ sourceLabel: 'Họp khách hàng', status: 'CONFIRMED' }),
    ]);
    expect(busy.drivers.find((d) => d.id === driverB)?.busy).toHaveLength(1);
    const own = await findAvailability(pool, tenantId, '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z', {
      sourceType: 'WORK_ITEM',
      sourceId,
    });
    expect(own.vehicles.find((v) => v.id === vehicleB)?.busy).toEqual([]);
  });

  it('lịch gắn theo đơn công tác: PENDING khi nộp, CONFIRMED khi duyệt, CANCELLED khi huỷ', async () => {
    const trip = async () => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests (id,tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status)
         VALUES ($1,$2,$3,'Hà Nội','2026-12-01','2026-12-02',2,'Gặp khách','PENDING')`,
        [id, tenantId, requester],
      );
      return id;
    };
    const tripId = await trip();
    const saved = await saveRequestTransport(
      pool,
      tenantId,
      {
        table: 'business_trip_requests',
        sourceType: 'BUSINESS_TRIP',
        requestId: tripId,
        requesterEmployeeId: requester,
        sourceLabel: 'Đơn công tác: Hà Nội',
        defaultRange: { startAt: '2026-12-01T01:00:00Z', endAt: '2026-12-02T10:00:00Z' },
      },
      { mode: 'COMPANY_VEHICLE', vehicleId: vehicleA, driverId: driverA },
    );
    expect(saved.transport_mode).toBe('COMPANY_VEHICLE');
    const statusOf = async () =>
      (await listBookings(pool, tenantId, '2026-12-01T00:00:00Z', '2026-12-03T00:00:00Z')).find((b) => b.sourceId === tripId)?.status;
    expect(await statusOf()).toBe('PENDING');
    // Đơn đang giữ chỗ nên đơn thứ hai trùng giờ không đặt được cùng xe.
    await expect(book({ startAt: '2026-12-01T05:00:00Z', endAt: '2026-12-01T06:00:00Z' })).rejects.toMatchObject({
      response: { code: 'HRM_FLEET_CONFLICT' },
    });
    await pool.query(`UPDATE hrm_schema.business_trip_requests SET status='APPROVED' WHERE id=$1`, [tripId]);
    expect(await statusOf()).toBe('CONFIRMED');
    await pool.query(`UPDATE hrm_schema.business_trip_requests SET status='CANCELLED' WHERE id=$1`, [tripId]);
    expect(await statusOf()).toBeUndefined();
    // Lịch đã giải phóng: đặt lại được.
    await expect(book({ startAt: '2026-12-01T05:00:00Z', endAt: '2026-12-01T06:00:00Z' })).resolves.toBeTruthy();
  });

  it('phương tiện ngoài chỉ ghi nhận, không tạo lịch xe; nguồn bị xoá thì lịch được giải phóng', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO hrm_schema.business_trip_requests (id,tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status)
       VALUES ($1,$2,$3,'Đà Nẵng','2027-01-05','2027-01-05',1,'Khảo sát','PENDING')`,
      [id, tenantId, requester],
    );
    const saved = await saveRequestTransport(
      pool,
      tenantId,
      { table: 'business_trip_requests', sourceType: 'BUSINESS_TRIP', requestId: id, requesterEmployeeId: requester, sourceLabel: 'x' },
      { mode: 'EXTERNAL', detail: 'Máy bay' },
    );
    expect(saved).toEqual({ transport_mode: 'EXTERNAL', transport_detail: 'Máy bay' });
    const bookings = await listBookings(pool, tenantId, '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z');
    expect(bookings.filter((b) => b.sourceId === id)).toEqual([]);

    const sourceId = randomUUID();
    await book({ sourceId, startAt: '2027-02-01T01:00:00Z', endAt: '2027-02-01T05:00:00Z' });
    await cancelFleetBookingBySource(pool, tenantId, 'WORK_ITEM', sourceId);
    await expect(book({ startAt: '2027-02-01T01:00:00Z', endAt: '2027-02-01T05:00:00Z' })).resolves.toBeTruthy();
  });

  it('nhận sự kiện đặt xe của Workspace và Maintenance: xác nhận, báo trùng, huỷ, bỏ qua nguồn không thuộc module gửi', async () => {
    const userId = (await pool.query(`SELECT user_id FROM core_schema.employees WHERE id = $1`, [requester])).rows[0].user_id;
    const event = (type: string, payload: Record<string, unknown>) =>
      createIntegrationEvent({
        id: randomUUID(),
        type,
        tenantId,
        source: type.split('.')[0],
        correlationId: String(payload.sourceId),
        payload,
      });
    const replies = async (sourceId: string) =>
      (
        await pool.query(
          `SELECT event_type, payload->'payload' AS payload FROM integration_schema.outbox_events
            WHERE aggregate_type = 'hrm-fleet-booking' AND aggregate_id = $1 ORDER BY occurred_at, id`,
          [sourceId],
        )
      ).rows;
    const request = (type: string, sourceId: string, over: Record<string, unknown> = {}) =>
      event(type, {
        sourceType: 'CALENDAR_EVENT',
        sourceId,
        sourceLabel: 'Họp khách hàng',
        vehicleId: vehicleA,
        driverId: driverA,
        startAt: '2027-04-01T01:00:00Z',
        endAt: '2027-04-01T05:00:00Z',
        destination: 'Quận 1',
        requesterUserId: userId,
        ...over,
      });

    const first = randomUUID();
    const requested = request('workspace.fleet-booking.requested', first);
    expect(await receiveFleetBookingEvent(pool, tenantId, requested)).toBe(true);
    // Nhận lại cùng một sự kiện không tạo thêm lịch hay trả lời lần hai.
    expect(await receiveFleetBookingEvent(pool, tenantId, requested)).toBe(false);
    expect((await replies(first)).map((r) => r.event_type)).toEqual(['hrm.fleet-booking.confirmed']);
    const booking = (await listBookings(pool, tenantId, '2027-04-01T00:00:00Z', '2027-04-02T00:00:00Z')).find((b) => b.sourceId === first);
    expect(booking).toMatchObject({ status: 'CONFIRMED', sourceType: 'CALENDAR_EVENT', requesterName: 'REQ', destination: 'Quận 1' });

    // Người thứ hai chọn cùng xe cùng giờ: không lỗi giao dịch, HRM trả lời conflicted kèm lý do.
    const second = randomUUID();
    await receiveFleetBookingEvent(pool, tenantId, request('workspace.fleet-booking.requested', second, { sourceType: 'WORK_ITEM' }));
    const conflict = await replies(second);
    expect(conflict.map((r) => r.event_type)).toEqual(['hrm.fleet-booking.conflicted']);
    expect(conflict[0].payload.reason).toMatch(/51A-111\.11/);

    // Huỷ nguồn thứ nhất giải phóng xe; đặt lại cho nguồn thứ hai thành công.
    await receiveFleetBookingEvent(pool, tenantId, event('workspace.fleet-booking.cancelled', { sourceType: 'CALENDAR_EVENT', sourceId: first }));
    await receiveFleetBookingEvent(pool, tenantId, request('workspace.fleet-booking.requested', second, { sourceType: 'WORK_ITEM' }));
    expect((await replies(second)).map((r) => r.event_type)).toEqual([
      'hrm.fleet-booking.conflicted',
      'hrm.fleet-booking.confirmed',
    ]);

    // Maintenance chỉ được đặt xe cho sự cố; Workspace không được đặt cho sự cố.
    const stray = randomUUID();
    await receiveFleetBookingEvent(pool, tenantId, request('workspace.fleet-booking.requested', stray, { sourceType: 'INCIDENT', startAt: '2027-05-01T01:00:00Z', endAt: '2027-05-01T05:00:00Z' }));
    expect(await replies(stray)).toEqual([]);
    const incident = randomUUID();
    await receiveFleetBookingEvent(pool, tenantId, request('maintenance.fleet-booking.requested', incident, { sourceType: 'INCIDENT', startAt: '2027-05-01T01:00:00Z', endAt: '2027-05-01T05:00:00Z' }));
    expect((await replies(incident)).map((r) => r.event_type)).toEqual(['hrm.fleet-booking.confirmed']);
  });

  it('không đặt được xe hoặc tài xế đã ngừng sử dụng', async () => {
    const retired = await saveVehicle(pool, tenantId, null, { plateNo: '51A-999.99', name: 'Xe cũ', status: 'INACTIVE' });
    await expect(book({ vehicleId: retired.id, startAt: '2027-03-01T01:00:00Z', endAt: '2027-03-01T05:00:00Z' })).rejects.toMatchObject({
      response: { code: 'HRM_FLEET_VEHICLE_INACTIVE' },
    });
  });
});
