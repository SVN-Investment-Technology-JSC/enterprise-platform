/**
 * CÔNG CỤ THỦ CÔNG, không phải test tự động: nhập đơn từ xuất từ 1Office vào một tenant DEV, rồi dựng lại chấm công từ đơn.
 * Mặc định bị bỏ qua. Dữ liệu trong file là dữ liệu nhân sự thật: đường dẫn file chỉ truyền qua biến môi trường, không đưa file vào repo.
 *
 *   HRM_1OFFICE_DATABASE_URL=<URL database của tenant>  HRM_1OFFICE_CONFIRM=yes  HRM_1OFFICE_FILE=<đường dẫn .xlsx>
 *   [HRM_1OFFICE_EMPLOYEES="Họ tên 1;Họ tên 2"]  [HRM_1OFFICE_MONTHS=2026-09,2026-10]  [HRM_1OFFICE_CLEANUP=yes]
 *   [HRM_1OFFICE_REPORT=<đường dẫn file .json ghi báo cáo>]
 *   pnpm --dir packages/modules/hrm exec jest src/lib/presentation/hrm-1office-import.manual.spec.ts --runInBand
 *
 * Làm gì (theo thứ tự):
 *  0. RELAX_OT_LIMITS=yes: nâng giới hạn ngày/tuần/tháng/năm của chính sách OT (dữ liệu 1Office có ca làm thêm dài hơn giới hạn).
 *  1. CLEANUP=yes: xóa đơn và chấm công của các tháng nhập (mọi nhân viên của tenant), trừ dữ liệu đang được bảng công đã tạo tham chiếu.
 *  2. Ghép nhân viên theo họ tên (DB không dùng mã NS_xxx của 1Office); nhân viên không khớp bị bỏ qua và ghi vào báo cáo.
 *  3. Tạo công tác, nghỉ, làm thêm bằng đúng luồng tạo đơn của hệ thống rồi duyệt; chấm công bổ sung ghi thành lượt chấm.
 *     Đơn vượt tháng được tách tại 00:00 ngày mùng 1 như 1Office; phần ngoài các tháng nhập bị bỏ.
 *  4. Dựng chấm công: theo ca của từng ngày, trừ phần đã được nghỉ hoặc công tác che; lượt chấm bổ sung của 1Office thay lượt tương ứng.
 *  5. HRM_1OFFICE_RECONCILE_FILES="<bảng công tháng 9.xlsx>;<bảng công tháng 10.xlsx>": đối chiếu từng ngày công của bảng công ERP với bảng công 1Office (chỉ đọc, không ghi).
 * Đơn bị hệ thống từ chối (chồng ca, chồng đơn khác, thiếu số dư phép...) không làm dừng lượt nhập: ghi lý do vào báo cáo.
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { formatLocalMinutes, localMinutes, splitBlockByMonth } from '../domain/overtime-classification';
import {
  normalizeName,
  parseLeaveRange,
  parseOvertimeBlocks,
  parsePunchAt,
  parseTripRange,
  splitRangeByMonths,
  type LocalRange,
} from '../domain/oneoffice-requests';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
import { transitionLeave } from '../infrastructure/hrm-leave-operations';
import { approveOvertime, createOvertime } from '../infrastructure/hrm-overtime';
import { approveBusinessTrip } from '../infrastructure/hrm-request-transition';
import { testApprovalPolicy } from '../infrastructure/hrm-test-support';
import { hrmTransaction } from '../infrastructure/hrm-transaction';
import { loadBoard } from '../infrastructure/hrm-timesheet-board';
import { shiftForDate } from '../infrastructure/hrm-time';
import { cancelHoliday } from '../infrastructure/hrm-work-schedule';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmRequestController } from './hrm-request.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const DEFAULT_EMPLOYEES = [
  'Bùi Công Quyền',
  'Trần Quốc Vương',
  'Đậu Bá Kiên',
  'Nguyễn Tấn Thịnh',
  'Phan Đức Thắng',
  'Bùi Long Quốc Huy',
  'Huỳnh Văn Trọng',
  'Trần Văn Thìn',
  'Trần Quang Bình',
];
const realUrl = process.env.HRM_1OFFICE_DATABASE_URL;
const reconcileFiles = (process.env.HRM_1OFFICE_RECONCILE_FILES ?? '').split(';').map((f) => f.trim()).filter(Boolean);
const enabled = Boolean(realUrl) && process.env.HRM_1OFFICE_CONFIRM === 'yes' && Boolean(process.env.HRM_1OFFICE_FILE);
const suite = enabled ? describe : describe.skip;

const MONTHS = (process.env.HRM_1OFFICE_MONTHS ?? '2026-09,2026-10').split(',').map((m) => m.trim());
const TZ = 'Asia/Ho_Chi_Minh';
const TZ_OFFSET_MINUTES = 7 * 60;
const LEAVE_TYPE_BY_REASON: Record<string, string> = {
  'nghỉ phép năm': 'ANNUAL',
  'nghỉ không lương': 'UNPAID',
  'nghỉ bù do làm thêm / tăng ca': 'COMP',
};

type Pg = ReturnType<typeof createPostgresPool>;
interface Emp {
  id: string;
  userId: string;
  name: string;
}
interface Outcome {
  kind: 'TRIP' | 'LEAVE' | 'OT' | 'PUNCH' | 'ATTENDANCE';
  employee: string;
  detail: string;
  ok: boolean;
  error?: string;
}

const monthStart = (month: string) => `${month}-01T00:00`;
const monthEndExclusive = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return formatLocalMinutes(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) / 60000);
};
/** Mốc kết thúc đúng 00:00 ngày mùng 1 của đơn công tác hoặc nghỉ thuộc về tháng trước: lùi về 23:59 để đơn nằm trong một tháng. */
const clampEnd = (value: string) => (value.endsWith('T00:00') && value.slice(8, 10) === '01' ? formatLocalMinutes(localMinutes(value) - 1) : value);
const dateOf = (local: string) => local.slice(0, 10);
const hhmm = (local: string) => local.slice(11, 16);
const toOffsetIso = (local: string) => `${local}:00+07:00`;
const localOfIso = (iso: string) => {
  const s = new Date(iso).toLocaleString('sv-SE', { timeZone: TZ });
  return `${s.slice(0, 10)}T${s.slice(11, 16)}`;
};

async function loadSheet(): Promise<Array<Record<string, unknown>>> {
  const requireFromImport = createRequire(resolve(process.cwd(), '../../platform/data-import/package.json'));
  const ExcelJS = requireFromImport('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(process.env.HRM_1OFFICE_FILE as string);
  const sheet = workbook.worksheets[0];
  const header: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell: any, col: number) => {
    header[col] = String(cell.value ?? '').trim();
  });
  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow((row: any, n: number) => {
    if (n === 1) return;
    const record: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      const v = cell.value;
      record[header[col] as string] = v && typeof v === 'object' && 'result' in v ? v.result : v;
    });
    rows.push(record);
  });
  return rows;
}


const REAL_DAY_UNITS: Record<string, number> = { CT: 1, 'CT/2': 0.5, P: 1, 'P/2': 0.5, N: 0, KL: 0, 'KL/2': 0, x: 0, NB: 1, ON: 1 };
const excelUnits = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() in REAL_DAY_UNITS) return REAL_DAY_UNITS[value.trim()] as number;
  return null;
};

/** Đọc các ngày công của sheet TH trong bảng công 1Office: tên nhân viên, ngày (YYYY-MM-DD), mã hoặc số công. */
async function loadOneOfficeTimesheet(file: string): Promise<Array<{ name: string; date: string; code: unknown }>> {
  const requireFromImport = createRequire(resolve(process.cwd(), '../../platform/data-import/package.json'));
  const ExcelJS = requireFromImport('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('TH');
  const month = Number(sheet.getCell('G4').value);
  const year = Number(sheet.getCell('I4').value);
  const out: Array<{ name: string; date: string; code: unknown }> = [];
  for (let r = 8; r <= 60; r++) {
    const name = sheet.getCell(r, 2).value;
    if (typeof name !== 'string' || !name.trim()) continue;
    for (let c = 4; c <= 34; c++) {
      const day = c - 3;
      if (new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) continue;
      const raw = sheet.getCell(r, c).value;
      const code = raw && typeof raw === 'object' && 'result' in (raw as object) ? (raw as { result: unknown }).result : raw;
      out.push({ name: name.trim(), date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, code });
    }
  }
  return out;
}

export async function importOneOffice(pool: Pg, tenantId: string): Promise<{ outcomes: Outcome[]; skipped: string[] }> {
  const req = { headers: {} } as Request;
  const tx = <T>(work: (db: PoolClient) => Promise<T>) => hrmTransaction(pool as unknown as Pool, work);
  const outcomes: Outcome[] = [];
  const skipped: string[] = [];
  const say = (m: string) => process.stdout.write(`${m}\n`);

  const periods = await pool.query(
    `SELECT period_code, status, requests_closed_at FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND (status='LOCKED' OR requests_closed_at IS NOT NULL) AND to_char(from_date,'YYYY-MM') = ANY($2)`,
    [tenantId, MONTHS],
  );
  if (periods.rows.length) throw new Error(`Có tháng đã chốt công hoặc chốt đơn: ${periods.rows.map((p: any) => p.period_code).join(', ')}. Dừng.`);

  // ---------------------------------------------------------------- Nhân viên
  const names = (process.env.HRM_1OFFICE_EMPLOYEES ? process.env.HRM_1OFFICE_EMPLOYEES.split(';') : DEFAULT_EMPLOYEES).map((n) => n.trim());
  const dbEmployees = (
    await pool.query(`SELECT id, user_id, full_name FROM core_schema.employees WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId])
  ).rows as Array<{ id: string; user_id: string; full_name: string }>;
  const empByName = new Map<string, Emp>();
  for (const n of names) {
    const found = dbEmployees.filter((e) => normalizeName(e.full_name) === normalizeName(n));
    if (found.length === 1) empByName.set(normalizeName(n), { id: found[0]!.id, userId: found[0]!.user_id, name: found[0]!.full_name });
    else skipped.push(`${n}: ${found.length ? 'trùng tên trong DB' : 'không có trong DB'}`);
  }
  say(`Nhân viên ghép được: ${empByName.size}/${names.length}`);

  // ---------------------------------------------------------------- Dọn dữ liệu tự sinh
  const lo = monthStart(MONTHS[0] as string).slice(0, 10);
  const hi = monthEndExclusive(MONTHS[MONTHS.length - 1] as string).slice(0, 10);
  if (process.env.HRM_1OFFICE_CLEANUP === 'yes') {
    const counts: Record<string, number> = {};
    await tx(async (db) => {
      const del = async (label: string, sql: string) => {
        counts[label] = (await db.query(sql, [tenantId, lo, hi])).rowCount ?? 0;
      };
      const free = (table: string, col: string) => `NOT EXISTS (SELECT 1 FROM hrm_schema.timesheets t WHERE t.${col} = ${table}.id)`;
      await del('attendance_events', `DELETE FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND work_date >= $2::date AND work_date < $3::date`);
      await del('attendance_corrections', `DELETE FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND request_date >= $2::date AND request_date < $3::date`);
      await del('attendances', `DELETE FROM hrm_schema.attendances WHERE tenant_id=$1 AND work_date >= $2::date AND work_date < $3::date AND ${free('attendances', 'attendance_id')}`);
      const leaveIds = (
        await db.query(
          `SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND from_date < $3::date AND to_date >= $2::date AND ${free('leave_requests', 'leave_request_id')}`,
          [tenantId, lo, hi],
        )
      ).rows.map((r: any) => r.id);
      counts.leave_request_days = (await db.query(`DELETE FROM hrm_schema.leave_request_days WHERE request_id = ANY($1::uuid[])`, [leaveIds])).rowCount ?? 0;
      counts.leave_carryover_usage = (await db.query(`DELETE FROM hrm_schema.leave_carryover_usage WHERE request_id = ANY($1::uuid[])`, [leaveIds])).rowCount ?? 0;
      counts.leave_transactions = (await db.query(`DELETE FROM hrm_schema.leave_transactions WHERE reference_request_id = ANY($1::uuid[])`, [leaveIds])).rowCount ?? 0;
      counts.leave_requests = (await db.query(`DELETE FROM hrm_schema.leave_requests WHERE id = ANY($1::uuid[])`, [leaveIds])).rowCount ?? 0;
      await del('ot_requests', `DELETE FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND work_date >= $2::date AND work_date < $3::date AND ${free('ot_requests', 'ot_request_id')}`);
      await del(
        'business_trip_requests',
        `DELETE FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND from_date < $3::date AND to_date >= $2::date AND ${free('business_trip_requests', 'business_trip_request_id')}`,
      );
    });
    say(`Đã xóa dữ liệu tự sinh ${lo} đến ${hi}: ${JSON.stringify(counts)}`);
  }

  // ---------------------------------------------------------------- Giới hạn OT
  if (process.env.HRM_1OFFICE_RELAX_OT_LIMITS === 'yes') {
    const relaxed = await pool.query(
      `UPDATE hrm_schema.policy_versions v
          SET config_json = v.config_json || '{"dailyLimitMinutes":1440,"weeklyLimitMinutes":10080,"monthlyLimitMinutes":44640,"yearlyLimitMinutes":525600}'::jsonb
         FROM hrm_schema.policies p
        WHERE p.id = v.policy_id AND p.tenant_id = $1 AND p.policy_type = 'OT'`,
      [tenantId],
    );
    say(`Đã nâng giới hạn OT của ${relaxed.rowCount} phiên bản chính sách (chỉ dùng cho tenant dev khi nhập dữ liệu cũ).`);
  }

  // ---------------------------------------------------------------- Danh mục
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
  const reasonId = async (kind: string, code: string) => {
    const r = await one(`SELECT id FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$2 AND code=$3`, [tenantId, kind, code]);
    if (!r) throw new Error(`Thiếu lý do ${kind}/${code} trong danh mục`);
    return r.id as string;
  };
  const otReason = await reasonId('OVERTIME', 'OT_WORK');
  const tripReason = await reasonId('BUSINESS_TRIP', 'R493D9082');
  const leaveTypes = new Map<string, string>();
  for (const code of new Set(Object.values(LEAVE_TYPE_BY_REASON))) {
    const t = await one(`SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL`, [tenantId, code]);
    if (!t) throw new Error(`Thiếu loại nghỉ ${code}`);
    leaveTypes.set(code, t.id as string);
  }
  // Nghỉ bù chưa có quỹ riêng (giai đoạn 2): không kiểm số dư phép năm cho loại này khi nhập.
  await pool.query(`UPDATE hrm_schema.leave_types SET deduct_balance=false WHERE tenant_id=$1 AND code='COMP'`, [tenantId]);

  const actor = (await one(`SELECT created_by AS id FROM hrm_schema.policies WHERE tenant_id=$1 AND created_by IS NOT NULL LIMIT 1`, [tenantId]))?.id as string | undefined;
  if (!actor) throw new Error('Không tìm thấy người dùng quản trị để ghi người tạo và người duyệt');
  const principal = { userId: actor, permissions: ['hrm.manage'] };

  // Ngày lễ thử nghiệm
  if (process.env.HRM_1OFFICE_CANCEL_TEST_HOLIDAYS === 'yes') {
    const fake = (
      await pool.query(
        `SELECT id, name FROM hrm_schema.company_holidays WHERE tenant_id=$1 AND status='ACTIVE' AND name ILIKE 'Lễ ảo%' AND from_date < $3::date AND to_date >= $2::date`,
        [tenantId, lo, hi],
      )
    ).rows as Array<{ id: string; name: string }>;
    for (const h of fake) await tx((db) => cancelHoliday(db, tenantId, actor, h.id, 'Ngày lễ thử nghiệm tự sinh, không có trong lịch của 1Office'));
    say(`Đã hủy ${fake.length} ngày lễ thử nghiệm: ${fake.map((h) => h.name).join('; ')}`);
  }

  const ctx = (who: { userId: string; permissions: string[] }, employeeId: string) =>
    ({
      has: () => true,
      getRequestContext: async (_r: Request, requested?: string) => ({ pool, tenantId, employeeId: requested ?? employeeId, principal: who }),
      scoped: async (_r: Request, _p: string, requested?: string) => ({ pool, tenantId, employeeId: requested, principal: who }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      // Nhập hộ dữ liệu cũ: ghi đơn như do chính nhân viên tạo (không đánh dấu tạo hộ).
      getProxyRequestContext: async (_r: Request, requested?: string) => ({ pool, tenantId, employeeId: requested ?? employeeId, principal: who, onBehalf: undefined }),
      resolveEmployee: async () => ({ employeeId }),
      procedureAvailable: async () => false,
    }) as any;
  const bridge = { startOrResume: async () => undefined } as any;
  const leaves = new HrmLeaveController(ctx(principal, actor), bridge, testApprovalPolicy());
  const requests = new HrmRequestController(ctx(principal, actor), bridge, testApprovalPolicy());

  const attempt = async (kind: Outcome['kind'], employee: string, detail: string, work: () => Promise<unknown>) => {
    try {
      await work();
      outcomes.push({ kind, employee, detail, ok: true });
    } catch (e: any) {
      outcomes.push({ kind, employee, detail, ok: false, error: String(e?.response?.message ?? e?.message ?? e).slice(0, 300) });
    }
  };

  // ---------------------------------------------------------------- Đọc file
  const rows = await loadSheet();
  const explicitPunches = new Map<string, { kind: 'IN' | 'OUT'; at: string }[]>(); // `${employeeId}|${date}`
  const trips: Array<{ emp: Emp; range: LocalRange; text: string }> = [];
  const leavesTodo: Array<{ emp: Emp; range: LocalRange; type: string; text: string }> = [];
  const overtimes: Array<{ emp: Emp; range: LocalRange; text: string }> = [];
  for (const row of rows) {
    const emp = empByName.get(normalizeName(String(row['Họ và tên'] ?? '')));
    if (!emp) continue;
    const kind = String(row['Loại đơn'] ?? '');
    const detail = row['Chi tiết ngày'];
    const note = String(row['Mô tả'] ?? '').trim();
    if (kind === 'Đơn công tác') {
      const range = parseTripRange(detail);
      if (!range) continue;
      for (const part of splitRangeByMonths(range, MONTHS)) trips.push({ emp, range: { from: part.from, to: clampEnd(part.to) }, text: note });
    } else if (kind === 'Đơn xin nghỉ') {
      const range = parseLeaveRange(detail);
      const type = LEAVE_TYPE_BY_REASON[String(row['Lý do'] ?? '').trim().toLowerCase()];
      if (!range || !type) {
        if (range && splitRangeByMonths(range, MONTHS).length) outcomes.push({ kind: 'LEAVE', employee: emp.name, detail: `${detail} (${row['Lý do']})`, ok: false, error: 'Lý do nghỉ chưa có loại nghỉ tương ứng' });
        continue;
      }
      for (const part of splitRangeByMonths(range, MONTHS)) leavesTodo.push({ emp, range: { from: part.from, to: clampEnd(part.to) }, type, text: note });
    } else if (kind === 'Đơn làm thêm') {
      for (const block of parseOvertimeBlocks(detail))
        for (const part of splitBlockByMonth(block))
          if (MONTHS.includes(part.periodMonth)) overtimes.push({ emp, range: { from: part.block.start, to: part.block.end }, text: note });
    } else if (kind === 'Đơn checkin/out') {
      const at = parsePunchAt(detail);
      if (!at || !MONTHS.includes(at.slice(0, 7))) continue;
      const key = `${emp.id}|${dateOf(at)}`;
      explicitPunches.set(key, [...(explicitPunches.get(key) ?? []), { kind: Number(hhmm(at).slice(0, 2)) < 12 ? 'IN' : 'OUT', at }]);
    }
  }
  say(`Đọc file: công tác ${trips.length}, nghỉ ${leavesTodo.length}, làm thêm ${overtimes.length} ca, ngày có chấm công bổ sung ${explicitPunches.size}`);

  // ---------------------------------------------------------------- Tạo đơn
  for (const t of trips)
    await attempt('TRIP', t.emp.name, `${t.range.from} đến ${t.range.to}`, async () => {
      const created = await requests.createBusinessTripRequest(req, {
        employeeId: t.emp.id,
        reasonId: tripReason,
        destination: (t.text || 'Công tác').slice(0, 250),
        businessTripType: 'DOMESTIC',
        fromAt: t.range.from,
        toAt: t.range.to,
        allowOt: true,
      } as any);
      await tx((db) => approveBusinessTrip(db, tenantId, actor, created.data.id));
    });
  for (const l of leavesTodo)
    await attempt('LEAVE', l.emp.name, `${l.type} ${l.range.from} đến ${l.range.to}`, async () => {
      const created = await leaves.createLeaveRequest(req, {
        employeeId: l.emp.id,
        leaveTypeId: leaveTypes.get(l.type),
        fromAt: l.range.from,
        toAt: l.range.to,
      } as any);
      await tx((db) => transitionLeave(db, tenantId, actor, created.data.id, 'APPROVED'));
    });
  // 1Office cho làm thêm ngay trong lúc công tác (kể cả cùng giờ); hệ thống chặn đơn làm thêm trùng giờ công tác. Khi bị chặn vì lý do
  // đó, tạo đơn trong một giao dịch có ẩn tạm các đơn công tác đã duyệt của nhân viên (vẫn qua đủ các kiểm tra còn lại).
  const overlapMessage = /công tác|chồng|trùng/i;
  for (const o of overtimes)
    await attempt('OT', o.emp.name, `${o.range.from} đến ${o.range.to}`, async () => {
      try {
        const created = await requests.createOtRequest(req, { employeeId: o.emp.id, reasonId: otReason, fromAt: o.range.from, toAt: o.range.to } as any);
        await tx((db) => approveOvertime(db, tenantId, actor, created.data.id));
      } catch (e: any) {
        if (!overlapMessage.test(String(e?.response?.message ?? e?.message ?? ''))) throw e;
        await tx(async (db) => {
          const hidden = (
            await db.query(
              `UPDATE hrm_schema.business_trip_requests SET status='CANCELLED' WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' RETURNING id`,
              [tenantId, o.emp.id],
            )
          ).rows.map((r: any) => r.id);
          const created = await createOvertime(
            db,
            tenantId,
            { employeeId: o.emp.id, fromAt: o.range.from, toAt: o.range.to },
            { reasonId: otReason, reasonName: 'Theo yêu cầu công việc', paid: true, description: o.text || null, rateMultiplier: null },
          );
          await approveOvertime(db, tenantId, actor, created.id);
          await db.query(`UPDATE hrm_schema.business_trip_requests SET status='APPROVED' WHERE id = ANY($1::uuid[])`, [hidden]);
        });
      }
    });

  // ---------------------------------------------------------------- Dựng chấm công
  const punch = (e: Emp, kind: 'IN' | 'OUT', at: string) =>
    ingestEvent(pool as unknown as Pool, tenantId, e.userId, {
      employeeId: e.id,
      kind,
      occurredAt: toOffsetIso(at),
      source: 'BIOMETRIC_DEVICE',
      externalEventId: randomUUID(),
    });
  const days: string[] = [];
  for (let d = Date.parse(`${lo}T00:00:00Z`); d < Date.parse(`${hi}T00:00:00Z`); d += 86400000) days.push(new Date(d).toISOString().slice(0, 10));
  for (const e of empByName.values()) {
    const cover = (
      await pool.query(
        `SELECT from_at, to_at, from_date::text AS from_date, to_date::text AS to_date FROM hrm_schema.leave_requests
          WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND deleted_at IS NULL AND from_date < $4::date AND to_date >= $3::date
         UNION ALL
         SELECT from_at, to_at, from_date::text, to_date::text FROM hrm_schema.business_trip_requests
          WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND from_date < $4::date AND to_date >= $3::date`,
        [tenantId, e.id, lo, hi],
      )
    ).rows.map((r: any) => {
      const from = r.from_at ? localMinutes(localOfIso(new Date(r.from_at).toISOString())) : localMinutes(`${r.from_date}T00:00`);
      const to = r.to_at ? localMinutes(localOfIso(new Date(r.to_at).toISOString())) : localMinutes(`${r.to_date}T00:00`) + 1440;
      return [from, to] as [number, number];
    });
    let written = 0;
    // Lấy ca từng ngày trên một kết nối duy nhất.
    const db = await pool.connect();
    try {
      for (const day of days) {
        const shift = await shiftForDate(db, tenantId, e.id, day, TZ);
        const explicit = explicitPunches.get(`${e.id}|${day}`) ?? [];
        let remaining: Array<[number, number]> = [];
        if (shift) {
          const start = localMinutes(localOfIso(shift.window.start));
          const end = localMinutes(localOfIso(shift.window.end));
          remaining = [[start, end]];
          for (const [cs, ce] of cover)
            remaining = remaining.flatMap(([s, en]) => (ce <= s || cs >= en ? [[s, en] as [number, number]] : [[s, Math.min(en, cs)], [Math.max(s, ce), en]].filter(([a, b]) => (b as number) > (a as number)) as Array<[number, number]>));
        }
        const total = remaining.reduce((a, [s, en]) => a + (en - s), 0);
        const events: Array<{ kind: 'IN' | 'OUT'; at: string }> = [];
        if (total >= 30) {
          events.push({ kind: 'IN', at: formatLocalMinutes(remaining[0]![0]) }, { kind: 'OUT', at: formatLocalMinutes(remaining[remaining.length - 1]![1]) });
        }
        for (const x of explicit) {
          const i = events.findIndex((ev) => ev.kind === x.kind);
          if (i >= 0) events[i] = x;
          else events.push(x);
        }
        for (const ev of events)
          await attempt('ATTENDANCE', e.name, `${ev.kind} ${ev.at}`, async () => {
            await punch(e, ev.kind, ev.at);
            written++;
          });
      }
    } finally {
      db.release();
    }
    say(`Chấm công ${e.name}: ${written} lượt`);
  }
  return { outcomes, skipped };
}

suite('nhập đơn từ 1Office và dựng lại chấm công', () => {
  it('nhập vào tenant DEV', async () => {
    const pool = createPostgresPool(realUrl as string);
    try {
      const tenantRows = (await pool.query(`SELECT DISTINCT tenant_id FROM core_schema.employees`)).rows;
      const tenantId = process.env.HRM_1OFFICE_TENANT ?? (tenantRows.length === 1 ? (tenantRows[0].tenant_id as string) : '');
      if (!tenantId) throw new Error('DB có nhiều tenant: đặt HRM_1OFFICE_TENANT');
      const { outcomes, skipped } = await importOneOffice(pool, tenantId);
      const summary: Record<string, { ok: number; failed: number }> = {};
      for (const o of outcomes) {
        const s = (summary[o.kind] ??= { ok: 0, failed: 0 });
        if (o.ok) s.ok++;
        else s.failed++;
      }
      process.stdout.write(`Kết quả: ${JSON.stringify(summary)}\nBỏ qua: ${JSON.stringify(skipped)}\n`);
      const reasons = new Map<string, number>();
      for (const o of outcomes.filter((x) => !x.ok)) reasons.set(`${o.kind}: ${o.error}`, (reasons.get(`${o.kind}: ${o.error}`) ?? 0) + 1);
      for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) process.stdout.write(`  ${n} x ${k}\n`);
      if (process.env.HRM_1OFFICE_REPORT) await writeFile(process.env.HRM_1OFFICE_REPORT, JSON.stringify({ summary, skipped, outcomes }, null, 1), 'utf8');
    } finally {
      await pool.end();
    }
  }, 3_600_000);
});

const reconcileSuite = enabled && reconcileFiles.length ? describe : describe.skip;
reconcileSuite('đối chiếu bảng công ERP với bảng công 1Office', () => {
  it('so từng ngày công', async () => {
    const pool = createPostgresPool(realUrl as string);
    try {
      const tenantId = (await pool.query(`SELECT DISTINCT tenant_id FROM core_schema.employees LIMIT 1`)).rows[0].tenant_id as string;
      const names = (process.env.HRM_1OFFICE_EMPLOYEES ? process.env.HRM_1OFFICE_EMPLOYEES.split(';') : DEFAULT_EMPLOYEES).map((n) => n.trim());
      const dbEmployees = (await pool.query(`SELECT id, full_name FROM core_schema.employees WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId])).rows as Array<{ id: string; full_name: string }>;
      const wanted = dbEmployees.filter((e) => names.some((n) => normalizeName(n) === normalizeName(e.full_name)));
      const report: Record<string, { match: number; total: number; diffs: string[] }> = {};
      const categories: Record<string, number> = {};
      for (const file of reconcileFiles) {
        const sheet = await loadOneOfficeTimesheet(file);
        const month = sheet[0]?.date.slice(0, 7) as string;
        const from = `${month}-01`;
        const to = formatLocalMinutes(localMinutes(monthEndExclusive(month)) - 1440).slice(0, 10);
        const board = await hrmTransaction(pool as unknown as Pool, (db) =>
          loadBoard(db, tenantId, { from, to, employeeIds: wanted.map((e) => e.id), today: '2026-11-06' }),
        );
        for (const emp of board.employees) {
          const full = wanted.find((w) => w.id === emp.employeeId)?.full_name as string;
          const key = `${month} ${full}`;
          const entry = (report[key] = { match: 0, total: 0, diffs: [] });
          for (const row of sheet.filter((x) => normalizeName(x.name) === normalizeName(full))) {
            const expected = excelUnits(row.code);
            if (expected === null) continue;
            const day = (emp.days as Record<string, any>)[row.date];
            const actual = day ? Number(day.workdayUnits ?? 0) : 0;
            entry.total++;
            if (Math.abs(actual - expected) < 0.01) entry.match++;
            else {
              entry.diffs.push(`${row.date.slice(8)}: 1Office ${String(row.code)} ERP ${actual} (${day?.status ?? '-'})`);
              const sunday = new Date(`${row.date}T00:00:00Z`).getUTCDay() === 0;
              const cat =
                String(row.code).startsWith('CT') && sunday && actual === 0
                  ? 'công tác chủ nhật: 1Office tính công, ERP coi là ngày nghỉ tuần'
                  : row.code === 'CT/2' && actual === 1
                    ? 'công tác sáng thứ 7: 1Office tính nửa công, ERP tính một công'
                    : row.code === 'x' || row.code === 0
                      ? 'thiếu hoặc không chấm công ở 1Office, ERP dựng đủ công'
                      : 'khác';
              categories[cat] = (categories[cat] ?? 0) + 1;
            }
          }
        }
      }
      let match = 0;
      let total = 0;
      for (const [k, v] of Object.entries(report)) {
        match += v.match;
        total += v.total;
        process.stdout.write(`${k}: ${v.match}/${v.total}${v.diffs.length ? ' | lệch ' + v.diffs.slice(0, 12).join(', ') : ''}
`);
      }
      process.stdout.write(`TỔNG ngày công khớp: ${match}/${total}
Nhóm lệch: ${JSON.stringify(categories, null, 1)}
`);
    } finally {
      await pool.end();
    }
  }, 600_000);
});
