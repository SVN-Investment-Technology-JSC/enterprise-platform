/**
 * Báo cáo HRM (trang Báo cáo): đơn từ, nghỉ phép đã dùng, làm thêm giờ, công tác theo khoảng ngày, phòng ban, nhân viên.
 * Chỉ đọc. Máy chủ trả mọi cột có thể xuất; giao diện chọn cột và tạo file Excel.
 */
import { BadRequestException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  HRM_REPORT_MAX_ROWS,
  HRM_REPORT_REQUEST_KINDS,
  type HrmReportCell,
  type HrmReportColumn,
  type HrmReportFilters,
  type HrmReportKind,
  type HrmReportOptions,
  type HrmReportRequestKind,
  type HrmReportResult,
} from '@enterprise-platform/contracts-hrm';

type Db = Pick<Pool | PoolClient, 'query'>;
type Row = Record<string, unknown>;

const TZ = `'Asia/Ho_Chi_Minh'`;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  PEER_CONFIRMED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  CANCELED: 'Đã hủy',
  WITHDRAWN: 'Đã rút',
};

const KIND_LABEL: Record<HrmReportRequestKind, string> = {
  leave: 'Đơn xin nghỉ',
  ot: 'Đơn làm thêm giờ',
  business_trip: 'Đơn công tác',
  shift_change: 'Đơn đổi ca',
  correction: 'Đơn giải trình công',
};

const UNIT_LABEL: Record<string, string> = { DAYS: 'Ngày', HOURS: 'Giờ' };

export const statusLabel = (status: unknown): string => STATUS_LABEL[String(status ?? '')] ?? String(status ?? '');

const col = (key: string, label: string, defaultOn = true, type: HrmReportColumn['type'] = 'text'): HrmReportColumn => ({
  key,
  label,
  defaultOn,
  type,
});

const EMPLOYEE_COLUMNS: readonly HrmReportColumn[] = [
  col('employeeName', 'Họ và tên'),
  col('employeeCode', 'Mã NV'),
  col('department', 'Phòng ban'),
  col('position', 'Vị trí', false),
];

const APPROVAL_COLUMNS: readonly HrmReportColumn[] = [
  col('status', 'Trạng thái'),
  col('currentAssignee', 'Người đang duyệt', false),
  col('approver', 'Người duyệt', false),
  col('approvedAt', 'Ngày duyệt', false, 'date'),
  col('createdAt', 'Ngày tạo', false, 'date'),
  col('createdBy', 'Người tạo hộ', false),
];

export const REPORT_COLUMNS: Record<HrmReportKind, readonly HrmReportColumn[]> = {
  requests: [
    ...EMPLOYEE_COLUMNS,
    col('kind', 'Loại đơn'),
    col('subType', 'Loại / lý do'),
    col('startDate', 'Ngày bắt đầu', true, 'date'),
    col('endDate', 'Ngày kết thúc', true, 'date'),
    col('detail', 'Chi tiết thời gian', false),
    col('description', 'Mô tả'),
    col('projectCode', 'Mã dự án liên quan', false),
    col('projectName', 'Dự án liên quan', false),
    ...APPROVAL_COLUMNS,
  ],
  'leave-usage': [
    ...EMPLOYEE_COLUMNS,
    col('leaveType', 'Loại phép'),
    col('unit', 'Đơn vị'),
    col('requestCount', 'Số đơn', true, 'number'),
    col('used', 'Đã dùng trong kỳ', true, 'number'),
    col('pending', 'Đang chờ duyệt', false, 'number'),
    col('openingBalance', 'Tồn đầu năm', false, 'number'),
    col('accrued', 'Đã tích lũy trong năm', false, 'number'),
    col('usedYear', 'Đã dùng cả năm', false, 'number'),
    col('remaining', 'Còn lại', true, 'number'),
  ],
  leave: [
    ...EMPLOYEE_COLUMNS,
    col('leaveType', 'Loại phép'),
    col('startDate', 'Từ ngày', true, 'date'),
    col('endDate', 'Đến ngày', true, 'date'),
    col('detail', 'Chi tiết thời gian', false),
    col('duration', 'Số ngày/giờ', true, 'number'),
    col('description', 'Lý do'),
    ...APPROVAL_COLUMNS,
  ],
  overtime: [
    ...EMPLOYEE_COLUMNS,
    col('startDate', 'Từ ngày', true, 'date'),
    col('endDate', 'Đến ngày', true, 'date'),
    col('description', 'Mô tả'),
    col('windows', 'Thời gian làm thêm'),
    col('hours', 'Số giờ làm thêm'),
    col('totalHours', 'Tổng số giờ', true, 'number'),
    col('otType', 'Loại làm thêm', false),
    col('projectCode', 'Mã dự án liên quan', false),
    col('projectName', 'Dự án liên quan'),
    ...APPROVAL_COLUMNS,
  ],
  'business-trips': [
    ...EMPLOYEE_COLUMNS,
    col('description', 'Mô tả'),
    col('reasonName', 'Lý do công tác'),
    col('destination', 'Nơi công tác', false),
    col('startDate', 'Từ ngày', true, 'date'),
    col('endDate', 'Đến ngày', true, 'date'),
    col('days', 'Số ngày', true, 'number'),
    col('projectCode', 'Mã dự án liên quan'),
    col('projectName', 'Dự án liên quan'),
    ...APPROVAL_COLUMNS,
  ],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Khoảng ngày tối đa một báo cáo: đủ cho cả năm, tránh quét nhiều năm một lần. */
const MAX_RANGE_DAYS = 400;

/** Kiểm tra và chuẩn hóa bộ lọc từ query; lỗi trả thông báo tiếng Việt. */
export function parseReportFilters(input: {
  from?: string;
  to?: string;
  departmentIds?: string;
  employeeIds?: string;
  statuses?: string;
  requestKinds?: string;
  leaveTypeIds?: string;
}): HrmReportFilters {
  const from = input.from ?? '';
  const to = input.to ?? '';
  if (!DATE.test(from) || !DATE.test(to)) throw new BadRequestException('Cần chọn khoảng ngày hợp lệ (từ ngày, đến ngày)');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) throw new BadRequestException('Đến ngày phải sau hoặc bằng từ ngày');
  if (days > MAX_RANGE_DAYS) throw new BadRequestException(`Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày`);
  const list = (value: string | undefined): string[] =>
    (value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const uuids = (value: string | undefined, label: string): string[] => {
    const items = list(value);
    if (items.some((v) => !UUID.test(v))) throw new BadRequestException(`${label} không hợp lệ`);
    return items;
  };
  const statuses = list(input.statuses).map((s) => s.toUpperCase());
  if (statuses.some((s) => !/^[A-Z_]{2,30}$/.test(s))) throw new BadRequestException('Trạng thái không hợp lệ');
  const requestKinds = list(input.requestKinds) as HrmReportRequestKind[];
  if (requestKinds.some((k) => !HRM_REPORT_REQUEST_KINDS.includes(k))) throw new BadRequestException('Loại đơn không hợp lệ');
  return {
    from,
    to,
    departmentIds: uuids(input.departmentIds, 'Phòng ban'),
    employeeIds: uuids(input.employeeIds, 'Nhân viên'),
    statuses,
    requestKinds,
    leaveTypeIds: uuids(input.leaveTypeIds, 'Loại phép'),
  };
}

/** Giá trị người dùng chọn luôn đi qua tham số, không ghép vào câu SQL. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function employeeFilterSql(p: Params, f: HrmReportFilters): string {
  const parts: string[] = [];
  if (f.departmentIds?.length) parts.push(`ed.department_id = ANY(${p.add(f.departmentIds)}::uuid[])`);
  if (f.employeeIds?.length) parts.push(`ed.employee_id = ANY(${p.add(f.employeeIds)}::uuid[])`);
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

const approverSql = (alias: string) =>
  `(SELECT ap.full_name FROM hrm_schema.employee_directory ap
     WHERE ap.tenant_id = ${alias}.tenant_id AND (ap.employee_id = ${alias}.approved_by OR ap.user_id = ${alias}.approved_by) LIMIT 1)`;

/** Mã và tên dự án gắn với đơn (một hoặc nhiều id: đơn làm thêm nhiều khoảng). */
const projectSql = (idsExpr: string, kind: string, fallbackName = 'NULL') =>
  `(SELECT string_agg(DISTINCT l.project_code, ', ') FROM hrm_schema.request_project_links l
     WHERE l.tenant_id = r.tenant_id AND l.request_kind = '${kind}' AND l.request_id = ANY(${idsExpr}) AND l.status IS DISTINCT FROM 'REJECTED') AS project_code,
   COALESCE((SELECT string_agg(DISTINCT l.project_name, ', ') FROM hrm_schema.request_project_links l
     WHERE l.tenant_id = r.tenant_id AND l.request_kind = '${kind}' AND l.request_id = ANY(${idsExpr}) AND l.status IS DISTINCT FROM 'REJECTED'), ${fallbackName}) AS project_name`;

/** Ngày dạng dd/mm/yyyy ngay trong SQL: cột `date` qua Date của Node dễ lệch múi giờ. */
const day = (sql: string) => `to_char(${sql}, 'DD/MM/YYYY')`;
const dayVn = (sql: string) => `to_char(${sql} AT TIME ZONE ${TZ}, 'DD/MM/YYYY')`;

/** Đơn làm thêm giờ theo nhóm: đơn nhiều khoảng là một dòng, gom ngày, khung giờ và số giờ của các khoảng. */
const OT_GROUPS_SQL = `
  SELECT r.id, r.tenant_id, r.employee_id, r.status, r.reason, r.reason_name, r.created_at, r.approved_by, r.approved_at,
         r.current_assignee_name, r.on_behalf_by_name, r.ot_type, g.start_date, g.end_date, g.windows, g.hours, g.total_hours, g.ids
    FROM hrm_schema.ot_requests r
   CROSS JOIN LATERAL (
     SELECT min(x.work_date) AS start_date, max(x.work_date) AS end_date,
            string_agg('Từ ' || to_char(COALESCE(x.from_at AT TIME ZONE ${TZ}, x.work_date + x.start_time), 'HH24:MI')
                       || ' đến ' || to_char(COALESCE(x.to_at AT TIME ZONE ${TZ}, x.work_date + x.end_time), 'HH24:MI'),
                       E'\\n' ORDER BY COALESCE(x.from_at AT TIME ZONE ${TZ}, x.work_date + x.start_time), x.id) AS windows,
            string_agg(trim_scale(round(COALESCE(x.approved_minutes, x.planned_minutes) / 60.0, 2))::text, ', '
                       ORDER BY COALESCE(x.from_at AT TIME ZONE ${TZ}, x.work_date + x.start_time), x.id) AS hours,
            round(sum(COALESCE(x.approved_minutes, x.planned_minutes)) / 60.0, 2) AS total_hours,
            array_agg(x.id) AS ids
       FROM hrm_schema.ot_requests x
      WHERE x.tenant_id = r.tenant_id AND COALESCE(x.group_id, x.id) = r.id
   ) g
   WHERE r.tenant_id = $1 AND (r.group_id IS NULL OR r.group_id = r.id)`;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function employeeCells(r: Row) {
  return {
    employeeName: str(r.full_name),
    employeeCode: str(r.employee_code),
    department: str(r.department_name),
    position: str(r.position_name),
  };
}

function approvalCells(r: Row) {
  return {
    status: statusLabel(r.status),
    currentAssignee: str(r.current_assignee_name),
    approver: str(r.approver),
    approvedAt: str(r.approved_on),
    createdAt: str(r.created_on),
    createdBy: str(r.on_behalf_by_name),
  };
}

const EMP_COLS = `ed.full_name, ed.employee_code, ed.department_name, ed.position_name`;

function finish(kind: HrmReportKind, rows: Record<string, HrmReportCell>[], total: number): HrmReportResult {
  return { kind, columns: REPORT_COLUMNS[kind], rows, total, truncated: total > rows.length };
}

/** Chạy câu chọn kèm tổng số dòng khớp, giới hạn số dòng trả về. */
async function withTotal(db: Db, select: string, values: unknown[]): Promise<{ rows: Row[]; total: number }> {
  const res = await db.query<Row>(
    `WITH q AS (${select}) SELECT q.*, count(*) OVER () AS total_count FROM q LIMIT ${HRM_REPORT_MAX_ROWS}`,
    values,
  );
  return { rows: res.rows, total: res.rows[0] ? Number(res.rows[0].total_count) : 0 };
}

/** Cột chung của các nhánh đơn từ, theo đúng thứ tự cột của câu UNION. */
const approvalSelect = (alias: string) =>
  `${approverSql(alias)} AS approver, ${dayVn(`${alias}.approved_at`)} AS approved_on, ${dayVn(`${alias}.created_at`)} AS created_on`;

/** Tổng hợp đơn từ mọi loại (nghỉ, làm thêm, công tác, đổi ca, giải trình công), mỗi đơn một dòng. */
export async function loadRequestsReport(db: Db, tenant: string, f: HrmReportFilters): Promise<HrmReportResult> {
  const p = new Params();
  p.add(tenant);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const kinds = f.requestKinds?.length ? f.requestKinds : HRM_REPORT_REQUEST_KINDS;
  const parts: string[] = [];
  if (kinds.includes('leave'))
    parts.push(`
      SELECT 'leave', r.id, r.tenant_id, r.employee_id, r.from_date, r.to_date, r.status, lt.name, r.reason,
             CASE WHEN r.from_at IS NOT NULL THEN to_char(r.from_at AT TIME ZONE ${TZ}, 'HH24:MI DD/MM/YYYY') || ' - ' || to_char(r.to_at AT TIME ZONE ${TZ}, 'HH24:MI DD/MM/YYYY') END,
             r.current_assignee_name, r.on_behalf_by_name, ${approvalSelect('r')}, ${projectSql('ARRAY[r.id]', 'leave')}
        FROM hrm_schema.leave_requests r
        LEFT JOIN hrm_schema.leave_types lt ON lt.tenant_id = r.tenant_id AND lt.id = r.leave_type_id
       WHERE r.tenant_id = $1 AND r.deleted_at IS NULL`);
  if (kinds.includes('ot'))
    parts.push(`
      SELECT 'ot', r.id, r.tenant_id, r.employee_id, r.start_date, r.end_date, r.status, r.reason_name, r.reason, r.windows,
             r.current_assignee_name, r.on_behalf_by_name, ${approvalSelect('r')}, ${projectSql('r.ids', 'ot')}
        FROM (${OT_GROUPS_SQL}) r`);
  if (kinds.includes('business_trip'))
    parts.push(`
      SELECT 'business_trip', r.id, r.tenant_id, r.employee_id, r.from_date, r.to_date, r.status, r.reason_name, r.reason,
             NULLIF(concat_ws(', ', r.destination, r.transport_mode), ''),
             r.current_assignee_name, r.on_behalf_by_name, ${approvalSelect('r')}, ${projectSql('ARRAY[r.id]', 'business_trip', 'r.project_name')}
        FROM hrm_schema.business_trip_requests r WHERE r.tenant_id = $1`);
  if (kinds.includes('shift_change'))
    parts.push(`
      SELECT 'shift_change', r.id, r.tenant_id, r.employee_id, r.from_date, r.to_date, r.status, r.reason_name, r.reason, r.change_type,
             r.current_assignee_name, NULL, ${approvalSelect('r')}, NULL, NULL
        FROM hrm_schema.shift_change_requests r WHERE r.tenant_id = $1`);
  if (kinds.includes('correction'))
    parts.push(`
      SELECT 'correction', r.id, r.tenant_id, r.employee_id, r.request_date, r.request_date, r.status, r.reason_name, r.reason, NULL,
             r.current_assignee_name, r.on_behalf_by_name, ${approvalSelect('r')}, NULL, NULL
        FROM hrm_schema.attendance_corrections r WHERE r.tenant_id = $1`);
  const statusSql = f.statuses?.length ? ` AND u.status = ANY(${p.add(f.statuses)}::text[])` : '';
  const { rows, total } = await withTotal(
    db,
    `SELECT u.kind, u.id, u.status, u.sub_type, u.description, u.detail, u.current_assignee_name, u.on_behalf_by_name,
            u.approver, u.approved_on, u.created_on, u.project_code, u.project_name,
            ${day('u.start_date')} AS start_on, ${day('u.end_date')} AS end_on, ${EMP_COLS}
       FROM (${parts.join(' UNION ALL ')}) AS u(kind, id, tenant_id, employee_id, start_date, end_date, status, sub_type, description, detail,
              current_assignee_name, on_behalf_by_name, approver, approved_on, created_on, project_code, project_name)
       JOIN hrm_schema.employee_directory ed ON ed.tenant_id = u.tenant_id AND ed.employee_id = u.employee_id
      WHERE u.start_date <= ${to}::date AND u.end_date >= ${from}::date${employeeFilterSql(p, f)}${statusSql}
      ORDER BY u.start_date DESC, ed.full_name, u.id`,
    p.values,
  );
  return finish(
    'requests',
    rows.map((r) => ({
      ...employeeCells(r),
      kind: KIND_LABEL[r.kind as HrmReportRequestKind] ?? str(r.kind),
      subType: str(r.sub_type),
      startDate: str(r.start_on),
      endDate: str(r.end_on),
      detail: str(r.detail),
      description: str(r.description),
      projectCode: str(r.project_code),
      projectName: str(r.project_name),
      ...approvalCells(r),
    })),
    total,
  );
}

/**
 * Nghỉ phép đã sử dụng: mỗi dòng một nhân viên và một loại phép có đơn trong kỳ hoặc có quỹ năm của kỳ.
 * Số đã dùng tính theo đơn đã duyệt có ngày bắt đầu nằm trong kỳ; số dư lấy từ quỹ phép của năm của "đến ngày".
 */
export async function loadLeaveUsageReport(db: Db, tenant: string, f: HrmReportFilters): Promise<HrmReportResult> {
  const p = new Params();
  p.add(tenant);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const typeSql = f.leaveTypeIds?.length ? ` AND lt.id = ANY(${p.add(f.leaveTypeIds)}::uuid[])` : '';
  const { rows, total } = await withTotal(
    db,
    `SELECT ${EMP_COLS}, lt.name AS leave_type, lt.unit, COALESCE(u.cnt, 0) AS request_count, COALESCE(u.used, 0) AS used,
            COALESCE(u.pending, 0) AS pending, b.opening_balance, b.accrued, b.used AS used_year, b.remaining
       FROM hrm_schema.employee_directory ed
      CROSS JOIN hrm_schema.leave_types lt
       LEFT JOIN LATERAL (
         SELECT count(*) AS cnt,
                sum(r.duration) FILTER (WHERE r.status = 'APPROVED') AS used,
                sum(r.duration) FILTER (WHERE r.status IN ('PENDING', 'PEER_CONFIRMED')) AS pending
           FROM hrm_schema.leave_requests r
          WHERE r.tenant_id = ed.tenant_id AND r.employee_id = ed.employee_id AND r.leave_type_id = lt.id AND r.deleted_at IS NULL
            AND r.status IN ('APPROVED', 'PENDING', 'PEER_CONFIRMED') AND r.from_date BETWEEN ${from}::date AND ${to}::date
       ) u ON true
       LEFT JOIN hrm_schema.leave_balances b ON b.tenant_id = ed.tenant_id AND b.employee_id = ed.employee_id
            AND b.leave_type_id = lt.id AND b.year = EXTRACT(YEAR FROM ${to}::date)::int
      WHERE ed.tenant_id = $1 AND lt.tenant_id = $1 AND lt.deleted_at IS NULL AND ed.deleted_at IS NULL
        AND (COALESCE(u.cnt, 0) > 0 OR b.id IS NOT NULL)${typeSql}${employeeFilterSql(p, f)}
      ORDER BY ed.department_name NULLS LAST, ed.full_name, lt.name`,
    p.values,
  );
  return finish(
    'leave-usage',
    rows.map((r) => ({
      ...employeeCells(r),
      leaveType: str(r.leave_type),
      unit: UNIT_LABEL[str(r.unit)] ?? str(r.unit),
      requestCount: num(r.request_count),
      used: num(r.used),
      pending: num(r.pending),
      openingBalance: num(r.opening_balance),
      accrued: num(r.accrued),
      usedYear: num(r.used_year),
      remaining: num(r.remaining),
    })),
    total,
  );
}

/** Danh sách đơn nghỉ phép trong kỳ (chi tiết từng đơn). */
export async function loadLeaveReport(db: Db, tenant: string, f: HrmReportFilters): Promise<HrmReportResult> {
  const p = new Params();
  p.add(tenant);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const statusSql = f.statuses?.length ? ` AND r.status = ANY(${p.add(f.statuses)}::text[])` : '';
  const typeSql = f.leaveTypeIds?.length ? ` AND r.leave_type_id = ANY(${p.add(f.leaveTypeIds)}::uuid[])` : '';
  const { rows, total } = await withTotal(
    db,
    `SELECT r.status, r.reason, r.duration, r.current_assignee_name, r.on_behalf_by_name, lt.name AS leave_type,
            ${day('r.from_date')} AS start_on, ${day('r.to_date')} AS end_on,
            CASE WHEN r.from_at IS NOT NULL THEN to_char(r.from_at AT TIME ZONE ${TZ}, 'HH24:MI DD/MM/YYYY') || ' - ' || to_char(r.to_at AT TIME ZONE ${TZ}, 'HH24:MI DD/MM/YYYY') END AS detail,
            ${approvalSelect('r')}, ${EMP_COLS}
       FROM hrm_schema.leave_requests r
       JOIN hrm_schema.employee_directory ed ON ed.tenant_id = r.tenant_id AND ed.employee_id = r.employee_id
       LEFT JOIN hrm_schema.leave_types lt ON lt.tenant_id = r.tenant_id AND lt.id = r.leave_type_id
      WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.from_date <= ${to}::date AND r.to_date >= ${from}::date${statusSql}${typeSql}${employeeFilterSql(p, f)}
      ORDER BY r.from_date DESC, ed.full_name, r.id`,
    p.values,
  );
  return finish(
    'leave',
    rows.map((r) => ({
      ...employeeCells(r),
      leaveType: str(r.leave_type),
      startDate: str(r.start_on),
      endDate: str(r.end_on),
      detail: str(r.detail),
      duration: num(r.duration),
      description: str(r.reason),
      ...approvalCells(r),
    })),
    total,
  );
}

/** Đơn làm thêm giờ theo nhóm: mỗi đơn một dòng, kèm khung giờ từng ngày và tổng số giờ (theo mẫu báo cáo OT). */
export async function loadOvertimeReport(db: Db, tenant: string, f: HrmReportFilters): Promise<HrmReportResult> {
  const p = new Params();
  p.add(tenant);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const statusSql = f.statuses?.length ? ` AND r.status = ANY(${p.add(f.statuses)}::text[])` : '';
  const { rows, total } = await withTotal(
    db,
    `SELECT r.status, r.reason, r.ot_type, r.windows, r.hours, r.total_hours, r.current_assignee_name, r.on_behalf_by_name,
            ${day('r.start_date')} AS start_on, ${day('r.end_date')} AS end_on, ${approvalSelect('r')}, ${projectSql('r.ids', 'ot')}, ${EMP_COLS}
       FROM (${OT_GROUPS_SQL}) r
       JOIN hrm_schema.employee_directory ed ON ed.tenant_id = r.tenant_id AND ed.employee_id = r.employee_id
      WHERE r.start_date <= ${to}::date AND r.end_date >= ${from}::date${statusSql}${employeeFilterSql(p, f)}
      ORDER BY ed.full_name, r.start_date, r.id`,
    p.values,
  );
  return finish(
    'overtime',
    rows.map((r) => ({
      ...employeeCells(r),
      startDate: str(r.start_on),
      endDate: str(r.end_on),
      description: str(r.reason),
      windows: str(r.windows),
      hours: str(r.hours),
      totalHours: num(r.total_hours),
      otType: str(r.ot_type),
      projectCode: str(r.project_code),
      projectName: str(r.project_name),
      ...approvalCells(r),
    })),
    total,
  );
}

/** Đơn công tác trong kỳ (theo mẫu báo cáo công tác). */
export async function loadBusinessTripsReport(db: Db, tenant: string, f: HrmReportFilters): Promise<HrmReportResult> {
  const p = new Params();
  p.add(tenant);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const statusSql = f.statuses?.length ? ` AND r.status = ANY(${p.add(f.statuses)}::text[])` : '';
  const { rows, total } = await withTotal(
    db,
    `SELECT r.status, r.reason, r.reason_name, r.destination, r.days_count, r.current_assignee_name, r.on_behalf_by_name,
            ${day('r.from_date')} AS start_on, ${day('r.to_date')} AS end_on, ${approvalSelect('r')},
            ${projectSql('ARRAY[r.id]', 'business_trip', 'r.project_name')}, ${EMP_COLS}
       FROM hrm_schema.business_trip_requests r
       JOIN hrm_schema.employee_directory ed ON ed.tenant_id = r.tenant_id AND ed.employee_id = r.employee_id
      WHERE r.tenant_id = $1 AND r.from_date <= ${to}::date AND r.to_date >= ${from}::date${statusSql}${employeeFilterSql(p, f)}
      ORDER BY ed.full_name, r.from_date, r.id`,
    p.values,
  );
  return finish(
    'business-trips',
    rows.map((r) => ({
      ...employeeCells(r),
      description: str(r.reason),
      reasonName: str(r.reason_name),
      destination: str(r.destination),
      startDate: str(r.start_on),
      endDate: str(r.end_on),
      days: num(r.days_count),
      projectCode: str(r.project_code),
      projectName: str(r.project_name),
      ...approvalCells(r),
    })),
    total,
  );
}

export function loadReport(db: Db, tenant: string, kind: HrmReportKind, f: HrmReportFilters): Promise<HrmReportResult> {
  switch (kind) {
    case 'requests':
      return loadRequestsReport(db, tenant, f);
    case 'leave-usage':
      return loadLeaveUsageReport(db, tenant, f);
    case 'leave':
      return loadLeaveReport(db, tenant, f);
    case 'overtime':
      return loadOvertimeReport(db, tenant, f);
    case 'business-trips':
      return loadBusinessTripsReport(db, tenant, f);
  }
}

/** Phòng ban, nhân viên và loại phép để dựng bộ lọc; nhân viên đã xóa hồ sơ không có trong danh sách. */
export async function loadReportOptions(db: Db, tenant: string): Promise<HrmReportOptions> {
  const [people, types] = await Promise.all([
    db.query<Row>(
      `SELECT employee_id, employee_code, full_name, department_id, department_name
         FROM hrm_schema.employee_directory WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY full_name`,
      [tenant],
    ),
    db.query<Row>(
      `SELECT id, name FROM hrm_schema.leave_types WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [tenant],
    ),
  ]);
  const departments = new Map<string, string>();
  for (const r of people.rows) if (r.department_id) departments.set(str(r.department_id), str(r.department_name));
  return {
    departments: [...departments].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    employees: people.rows.map((r) => ({
      id: str(r.employee_id),
      code: str(r.employee_code),
      name: str(r.full_name),
      departmentId: r.department_id ? str(r.department_id) : null,
    })),
    leaveTypes: types.rows.map((r) => ({ id: str(r.id), name: str(r.name) })),
  };
}
