import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type {
  HrmFleetAvailability,
  HrmFleetBooking,
  HrmFleetBookingStatus,
  HrmFleetBusySlot,
  HrmFleetDriver,
  HrmFleetEntityStatus,
  HrmFleetSourceModule,
  HrmFleetSourceType,
  HrmFleetVehicle,
  HrmTransportInput,
  HrmTransportMode,
  SaveFleetDriverRequest,
  SaveFleetVehicleRequest,
} from '@enterprise-platform/contracts-hrm';
import { requireText, requireUuid } from './hrm-validation.js';

type Db = Pick<PoolClient, 'query'>;
type Reader = Pick<Pool, 'query'>;

/**
 * Lịch xe công ty. Người tạo đơn tự chọn xe và tài xế còn trống; lịch giữ chỗ (PENDING) lúc đơn gốc
 * chưa duyệt, tự xác nhận khi đơn gốc duyệt và tự giải phóng khi đơn bị từ chối, huỷ hay huỷ hiệu lực
 * (trigger `sync_fleet_booking_status`, migration 0056). Chống trùng lịch ở tầng ứng dụng: khoá dòng
 * xe và tài xế trong cùng transaction rồi kiểm tra chồng lấn.
 */
export const FLEET_SOURCES: Record<HrmFleetSourceType, HrmFleetSourceModule> = {
  BUSINESS_TRIP: 'HRM',
  CUSTOM_REQUEST: 'HRM',
  WORK_ITEM: 'WORKSPACE',
  CALENDAR_EVENT: 'WORKSPACE',
  INCIDENT: 'MAINTENANCE',
};

const ENTITY_STATUSES: readonly HrmFleetEntityStatus[] = ['ACTIVE', 'INACTIVE'];

function invalid(message: string): never {
  throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message });
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, max);
}

function entityStatus(value: unknown): HrmFleetEntityStatus | undefined {
  if (value === undefined) return undefined;
  if (!ENTITY_STATUSES.includes(value as HrmFleetEntityStatus)) invalid('status: không hợp lệ');
  return value as HrmFleetEntityStatus;
}

export function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalid(`${field}: thời gian không hợp lệ`);
  }
  return new Date(value as string).toISOString();
}

export function parseRange(startAt: unknown, endAt: unknown): { startAt: string; endAt: string } {
  const start = parseTimestamp(startAt, 'startAt');
  const end = parseTimestamp(endAt, 'endAt');
  if (Date.parse(end) <= Date.parse(start)) invalid('endAt: phải sau thời điểm bắt đầu');
  return { startAt: start, endAt: end };
}

// ---- Danh mục xe ----

function mapVehicle(row: Record<string, unknown>): HrmFleetVehicle {
  return {
    id: row.id as string,
    plateNo: row.plate_no as string,
    name: row.name as string,
    seats: Number(row.seats),
    status: row.status as HrmFleetEntityStatus,
    note: (row.note as string | null) ?? null,
  };
}

export async function listVehicles(db: Reader, tenantId: string): Promise<HrmFleetVehicle[]> {
  const { rows } = await db.query(
    `SELECT id, plate_no, name, seats, status, note FROM hrm_schema.fleet_vehicles
      WHERE tenant_id = $1 ORDER BY status, plate_no`,
    [tenantId],
  );
  return rows.map(mapVehicle);
}

export async function saveVehicle(
  db: Db,
  tenantId: string,
  id: string | null,
  input: SaveFleetVehicleRequest,
): Promise<HrmFleetVehicle> {
  const plateNo = input.plateNo === undefined ? undefined : requireText(input.plateNo, 'plateNo', 30);
  const name = input.name === undefined ? undefined : requireText(input.name, 'name');
  const seats = input.seats === undefined ? undefined : Number(input.seats);
  if (seats !== undefined && (!Number.isInteger(seats) || seats < 1 || seats > 100)) invalid('seats: từ 1 đến 100');
  const status = entityStatus(input.status);
  const note = input.note === undefined ? undefined : optionalText(input.note, 'note', 1000);
  try {
    if (id === null) {
      if (!plateNo || !name) invalid('Cần nhập biển số và tên xe');
      const { rows } = await db.query(
        `INSERT INTO hrm_schema.fleet_vehicles (tenant_id, plate_no, name, seats, status, note)
         VALUES ($1, $2, $3, COALESCE($4, 4), COALESCE($5, 'ACTIVE'), $6) RETURNING *`,
        [tenantId, plateNo, name, seats ?? null, status ?? null, note ?? null],
      );
      return mapVehicle(rows[0]);
    }
    const { rows } = await db.query(
      `UPDATE hrm_schema.fleet_vehicles SET
         plate_no = COALESCE($3, plate_no), name = COALESCE($4, name), seats = COALESCE($5, seats),
         status = COALESCE($6, status), note = CASE WHEN $7::boolean THEN $8 ELSE note END, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id, plateNo ?? null, name ?? null, seats ?? null, status ?? null, note !== undefined, note ?? null],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'HRM_FLEET_VEHICLE_NOT_FOUND', message: 'Không tìm thấy xe' });
    return mapVehicle(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictException({ code: 'HRM_FLEET_PLATE_EXISTS', message: 'Biển số đã có trong danh mục' });
    }
    throw error;
  }
}

// ---- Tài xế ----

const DRIVER_SELECT = `SELECT d.id, d.employee_id, d.license_no, d.status, ed.full_name, ed.employee_code
  FROM hrm_schema.fleet_drivers d
  LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = d.employee_id AND ed.tenant_id = d.tenant_id`;

function mapDriver(row: Record<string, unknown>): HrmFleetDriver {
  return {
    id: row.id as string,
    employeeId: row.employee_id as string,
    employeeName: (row.full_name as string | null) ?? null,
    employeeCode: (row.employee_code as string | null) ?? null,
    licenseNo: (row.license_no as string | null) ?? null,
    status: row.status as HrmFleetEntityStatus,
  };
}

export async function listDrivers(db: Reader, tenantId: string): Promise<HrmFleetDriver[]> {
  const { rows } = await db.query(`${DRIVER_SELECT} WHERE d.tenant_id = $1 ORDER BY d.status, ed.full_name`, [tenantId]);
  return rows.map(mapDriver);
}

export async function saveDriver(
  db: Db,
  tenantId: string,
  id: string | null,
  input: SaveFleetDriverRequest,
): Promise<HrmFleetDriver> {
  const employeeId = input.employeeId === undefined ? undefined : requireUuid(input.employeeId, 'employeeId');
  const status = entityStatus(input.status);
  const licenseNo = input.licenseNo === undefined ? undefined : optionalText(input.licenseNo, 'licenseNo', 50);
  let savedId: string;
  try {
    if (id === null) {
      if (!employeeId) invalid('Cần chọn nhân viên làm tài xế');
      const { rows: emp } = await db.query(
        'SELECT 1 FROM hrm_schema.employee_profiles WHERE tenant_id = $1 AND employee_id = $2',
        [tenantId, employeeId],
      );
      if (!emp[0]) throw new NotFoundException({ code: 'HRM_EMPLOYEE_NOT_FOUND', message: 'Không tìm thấy nhân viên' });
      const { rows } = await db.query(
        `INSERT INTO hrm_schema.fleet_drivers (tenant_id, employee_id, license_no, status)
         VALUES ($1, $2, $3, COALESCE($4, 'ACTIVE')) RETURNING id`,
        [tenantId, employeeId, licenseNo ?? null, status ?? null],
      );
      savedId = rows[0].id as string;
    } else {
      const { rows } = await db.query(
        `UPDATE hrm_schema.fleet_drivers SET
           license_no = CASE WHEN $3::boolean THEN $4 ELSE license_no END,
           status = COALESCE($5, status), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id, licenseNo !== undefined, licenseNo ?? null, status ?? null],
      );
      if (!rows[0]) throw new NotFoundException({ code: 'HRM_FLEET_DRIVER_NOT_FOUND', message: 'Không tìm thấy tài xế' });
      savedId = rows[0].id as string;
    }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictException({ code: 'HRM_FLEET_DRIVER_EXISTS', message: 'Nhân viên này đã là tài xế' });
    }
    throw error;
  }
  const { rows } = await db.query(`${DRIVER_SELECT} WHERE d.tenant_id = $1 AND d.id = $2`, [tenantId, savedId]);
  return mapDriver(rows[0]);
}

// ---- Lịch xe ----

function mapBooking(row: Record<string, unknown>): HrmFleetBooking {
  return {
    id: row.id as string,
    vehicleId: row.vehicle_id as string,
    vehiclePlateNo: row.plate_no as string,
    vehicleName: row.vehicle_name as string,
    driverId: row.driver_id as string,
    driverName: (row.driver_name as string | null) ?? null,
    startAt: new Date(row.start_at as string).toISOString(),
    endAt: new Date(row.end_at as string).toISOString(),
    destination: (row.destination as string | null) ?? null,
    purpose: (row.purpose as string | null) ?? null,
    requesterEmployeeId: (row.requester_employee_id as string | null) ?? null,
    requesterName: (row.requester_name as string | null) ?? null,
    sourceModule: row.source_module as HrmFleetSourceModule,
    sourceType: row.source_type as HrmFleetSourceType,
    sourceId: row.source_id as string,
    sourceLabel: (row.source_label as string | null) ?? null,
    status: row.status as HrmFleetBookingStatus,
  };
}

/** Lịch chưa huỷ giao với [from, to], cho bảng lịch xe. */
export async function listBookings(
  db: Reader,
  tenantId: string,
  from: string,
  to: string,
): Promise<HrmFleetBooking[]> {
  const range = parseRange(from, to);
  const { rows } = await db.query(
    `SELECT b.*, v.plate_no, v.name AS vehicle_name, dd.full_name AS driver_name, rd.full_name AS requester_name
       FROM hrm_schema.fleet_bookings b
       JOIN hrm_schema.fleet_vehicles v ON v.id = b.vehicle_id
       JOIN hrm_schema.fleet_drivers d ON d.id = b.driver_id
       LEFT JOIN hrm_schema.employee_directory dd ON dd.employee_id = d.employee_id AND dd.tenant_id = b.tenant_id
       LEFT JOIN hrm_schema.employee_directory rd ON rd.employee_id = b.requester_employee_id AND rd.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.status <> 'CANCELLED' AND b.start_at < $3 AND b.end_at > $2
      ORDER BY b.start_at`,
    [tenantId, range.startAt, range.endAt],
  );
  return rows.map(mapBooking);
}

export interface FleetSourceRef {
  sourceType: HrmFleetSourceType;
  sourceId: string;
}

function checkSource(sourceType: unknown): HrmFleetSourceType {
  if (typeof sourceType !== 'string' || !(sourceType in FLEET_SOURCES)) invalid('sourceType: không hợp lệ');
  return sourceType as HrmFleetSourceType;
}

/**
 * Xe và tài xế đang hoạt động kèm khoảng bận trong [from, to]. `exclude` là lịch của chính nguồn đang
 * sửa: không tính là bận để người dùng giữ nguyên lựa chọn cũ.
 */
export async function findAvailability(
  db: Reader,
  tenantId: string,
  from: string,
  to: string,
  exclude?: FleetSourceRef,
): Promise<HrmFleetAvailability> {
  const range = parseRange(from, to);
  const params: unknown[] = [tenantId, range.startAt, range.endAt];
  let excludeSql = '';
  if (exclude) {
    params.push(exclude.sourceType, exclude.sourceId);
    excludeSql = 'AND NOT (source_type = $4 AND source_id = $5)';
  }
  const [vehicles, drivers, busy] = await Promise.all([
    db.query(
      `SELECT id, plate_no, name, seats, status, note FROM hrm_schema.fleet_vehicles
        WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY plate_no`,
      [tenantId],
    ),
    db.query(`${DRIVER_SELECT} WHERE d.tenant_id = $1 AND d.status = 'ACTIVE' ORDER BY ed.full_name`, [tenantId]),
    db.query(
      `SELECT vehicle_id, driver_id, start_at, end_at, status, source_label FROM hrm_schema.fleet_bookings
        WHERE tenant_id = $1 AND status <> 'CANCELLED' AND start_at < $3 AND end_at > $2 ${excludeSql}`,
      params,
    ),
  ]);
  const slotOf = (row: Record<string, unknown>): HrmFleetBusySlot => ({
    startAt: new Date(row.start_at as string).toISOString(),
    endAt: new Date(row.end_at as string).toISOString(),
    status: row.status as HrmFleetBusySlot['status'],
    sourceLabel: (row.source_label as string | null) ?? null,
  });
  const byVehicle = new Map<string, HrmFleetBusySlot[]>();
  const byDriver = new Map<string, HrmFleetBusySlot[]>();
  for (const row of busy.rows) {
    const slot = slotOf(row);
    byVehicle.set(row.vehicle_id as string, [...(byVehicle.get(row.vehicle_id as string) ?? []), slot]);
    byDriver.set(row.driver_id as string, [...(byDriver.get(row.driver_id as string) ?? []), slot]);
  }
  return {
    vehicles: vehicles.rows.map((row) => ({ ...mapVehicle(row), busy: byVehicle.get(row.id as string) ?? [] })),
    drivers: drivers.rows.map((row) => {
      const driver = mapDriver(row);
      return {
        id: driver.id,
        employeeId: driver.employeeId,
        employeeName: driver.employeeName,
        licenseNo: driver.licenseNo,
        busy: byDriver.get(driver.id) ?? [],
      };
    }),
  };
}

export interface UpsertFleetBookingInput extends FleetSourceRef {
  vehicleId: unknown;
  driverId: unknown;
  startAt: unknown;
  endAt: unknown;
  destination?: string | null;
  purpose?: string | null;
  requesterEmployeeId?: string | null;
  sourceLabel?: string | null;
  /** Trạng thái khi tạo mới: PENDING nếu nguồn còn chờ duyệt, CONFIRMED nếu nguồn không có bước duyệt. */
  status: Exclude<HrmFleetBookingStatus, 'CANCELLED'>;
}

/** Tạo hoặc sửa lịch xe của một nguồn; 409 khi xe hoặc tài xế đã bận trong khung giờ. */
export async function upsertFleetBooking(
  db: Db,
  tenantId: string,
  input: UpsertFleetBookingInput,
): Promise<{ id: string; status: HrmFleetBookingStatus }> {
  const sourceType = checkSource(input.sourceType);
  const sourceId = requireUuid(input.sourceId, 'sourceId');
  const vehicleId = requireUuid(input.vehicleId, 'vehicleId');
  const driverId = requireUuid(input.driverId, 'driverId');
  const { startAt, endAt } = parseRange(input.startAt, input.endAt);

  // Khoá xe rồi tài xế theo thứ tự cố định để hai giao dịch đặt cùng lúc không khoá chéo nhau.
  const { rows: vehicle } = await db.query(
    'SELECT plate_no, status FROM hrm_schema.fleet_vehicles WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
    [tenantId, vehicleId],
  );
  if (!vehicle[0]) throw new NotFoundException({ code: 'HRM_FLEET_VEHICLE_NOT_FOUND', message: 'Không tìm thấy xe' });
  if (vehicle[0].status !== 'ACTIVE') {
    throw new ConflictException({ code: 'HRM_FLEET_VEHICLE_INACTIVE', message: 'Xe đã ngừng sử dụng' });
  }
  const { rows: driver } = await db.query(
    `SELECT d.status, ed.full_name FROM hrm_schema.fleet_drivers d
       LEFT JOIN hrm_schema.employee_directory ed ON ed.employee_id = d.employee_id AND ed.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.id = $2 FOR UPDATE OF d`,
    [tenantId, driverId],
  );
  if (!driver[0]) throw new NotFoundException({ code: 'HRM_FLEET_DRIVER_NOT_FOUND', message: 'Không tìm thấy tài xế' });
  if (driver[0].status !== 'ACTIVE') {
    throw new ConflictException({ code: 'HRM_FLEET_DRIVER_INACTIVE', message: 'Tài xế đã ngừng hoạt động' });
  }

  const { rows: clash } = await db.query(
    `SELECT vehicle_id, driver_id, start_at, end_at, source_label FROM hrm_schema.fleet_bookings
      WHERE tenant_id = $1 AND status <> 'CANCELLED' AND (vehicle_id = $2 OR driver_id = $3)
        AND start_at < $5 AND end_at > $4 AND NOT (source_type = $6 AND source_id = $7)
      ORDER BY start_at LIMIT 1`,
    [tenantId, vehicleId, driverId, startAt, endAt, sourceType, sourceId],
  );
  if (clash[0]) {
    const byVehicle = clash[0].vehicle_id === vehicleId;
    throw new ConflictException({
      code: 'HRM_FLEET_CONFLICT',
      message: byVehicle
        ? `Xe ${vehicle[0].plate_no as string} đã có lịch trong khung giờ này`
        : `Tài xế ${(driver[0].full_name as string | null) ?? ''} đã có lịch trong khung giờ này`.replace('  ', ' '),
      resource: byVehicle ? 'VEHICLE' : 'DRIVER',
      startAt: new Date(clash[0].start_at as string).toISOString(),
      endAt: new Date(clash[0].end_at as string).toISOString(),
      sourceLabel: clash[0].source_label ?? null,
    });
  }

  const values = [
    input.destination ?? null,
    input.purpose ?? null,
    input.requesterEmployeeId ?? null,
    input.sourceLabel ?? null,
  ];
  const { rows: existing } = await db.query(
    `UPDATE hrm_schema.fleet_bookings SET vehicle_id = $3, driver_id = $4, start_at = $5, end_at = $6,
            destination = $7, purpose = $8, requester_employee_id = $9, source_label = $10, updated_at = now()
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $11 AND status <> 'CANCELLED'
      RETURNING id, status`,
    [tenantId, sourceType, vehicleId, driverId, startAt, endAt, ...values, sourceId],
  );
  if (existing[0]) return { id: existing[0].id as string, status: existing[0].status as HrmFleetBookingStatus };
  const { rows } = await db.query(
    `INSERT INTO hrm_schema.fleet_bookings
       (tenant_id, vehicle_id, driver_id, start_at, end_at, destination, purpose, requester_employee_id,
        source_module, source_type, source_id, source_label, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, status`,
    [
      tenantId, vehicleId, driverId, startAt, endAt, values[0], values[1], values[2],
      FLEET_SOURCES[sourceType], sourceType, sourceId, values[3], input.status,
    ],
  );
  return { id: rows[0].id as string, status: rows[0].status as HrmFleetBookingStatus };
}

/** Giải phóng lịch xe của một nguồn (nguồn bị xoá hoặc đổi sang phương tiện ngoài). */
export async function cancelFleetBookingBySource(
  db: Db,
  tenantId: string,
  sourceType: HrmFleetSourceType,
  sourceId: string,
): Promise<void> {
  await db.query(
    `UPDATE hrm_schema.fleet_bookings SET status = 'CANCELLED', updated_at = now()
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND status <> 'CANCELLED'`,
    [tenantId, checkSource(sourceType), sourceId],
  );
}

export interface RequestTransportOptions {
  table: 'business_trip_requests' | 'custom_requests';
  sourceType: Extract<HrmFleetSourceType, 'BUSINESS_TRIP' | 'CUSTOM_REQUEST'>;
  requestId: string;
  requesterEmployeeId: string;
  sourceLabel: string;
  destination?: string | null;
  purpose?: string | null;
  /** Thời gian của đơn, dùng khi người dùng không nhập giờ riêng cho xe. */
  defaultRange?: { startAt: string; endAt: string } | null;
}

/**
 * Ghi phương tiện di chuyển lên đơn vừa tạo. Xe công ty sinh lịch xe giữ chỗ (PENDING) trong cùng
 * transaction với đơn; phương tiện ngoài chỉ ghi nhận loại phương tiện, nhân sự tự sắp xếp.
 * Trả về cặp cột để gộp vào dòng đơn trả cho người gọi.
 */
export async function saveRequestTransport(
  db: Db,
  tenantId: string,
  options: RequestTransportOptions,
  transport: HrmTransportInput | undefined,
): Promise<{ transport_mode: HrmTransportMode | null; transport_detail: string | null }> {
  if (!transport) return { transport_mode: null, transport_detail: null };
  if (transport.mode !== 'COMPANY_VEHICLE' && transport.mode !== 'EXTERNAL') invalid('transport.mode: không hợp lệ');
  const detail = optionalText(transport.detail, 'transport.detail', 100);
  if (transport.mode === 'COMPANY_VEHICLE') {
    const range = transport.startAt || transport.endAt ? { startAt: transport.startAt, endAt: transport.endAt } : options.defaultRange;
    if (!range) invalid('Cần nhập giờ đi và giờ về khi đi xe công ty');
    await upsertFleetBooking(db, tenantId, {
      sourceType: options.sourceType,
      sourceId: options.requestId,
      vehicleId: transport.vehicleId,
      driverId: transport.driverId,
      startAt: range.startAt,
      endAt: range.endAt,
      destination: optionalText(transport.destination, 'transport.destination', 255) ?? options.destination ?? null,
      purpose: options.purpose ?? null,
      requesterEmployeeId: options.requesterEmployeeId,
      sourceLabel: options.sourceLabel,
      status: 'PENDING',
    });
  }
  const mode = transport.mode;
  const saved = mode === 'EXTERNAL' ? detail : null;
  await db.query(
    `UPDATE hrm_schema.${options.table} SET transport_mode = $3, transport_detail = $4
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, options.requestId, mode, saved],
  );
  return { transport_mode: mode, transport_detail: saved };
}
