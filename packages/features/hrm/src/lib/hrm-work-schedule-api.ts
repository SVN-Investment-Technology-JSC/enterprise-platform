/**
 * Lời gọi API phân ca làm việc (/api/hrm/v1/...). Dùng chung hrmFetch (CSRF, cookie, lỗi 401/403)
 * và không tạo danh mục ca riêng: ca lấy từ GET /shifts.
 */
import type {
  CreateHolidayRequest,
  HrmApplyScheduleRequest,
  HrmApplyScheduleResult,
  HrmCancelScheduleRequest,
  HrmCopyScheduleRequest,
  HrmHoliday,
  HrmOrgUnitOption,
  HrmScheduleAuditEntry,
  HrmScheduleGrid,
  HrmScheduleListRow,
  HrmScheduleRule,
  HrmSchedulePlanSummary,
  HrmSchedulePreview,
  HrmScheduleTemplate,
  HrmShiftDefinition,
  SaveScheduleTemplateRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from './hrm-api';
import type {
  AnyApplyResult,
  AnySchedulePreview,
  ScheduleExportRow,
} from './hrm-work-schedule-model';

export const SCHEDULE_PAGE_SIZE = 50;

export interface ScheduleFilters {
  from: string;
  to: string;
  unitId: string;
  includeChildUnits: boolean;
  q: string;
  unassignedOnly: boolean;
  employeeId?: string;
}

export function buildScheduleQuery(
  filters: ScheduleFilters,
  extra: { page?: number; pageSize?: number } = {},
): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.unitId) {
    params.set('unitId', filters.unitId);
    params.set('includeChildUnits', filters.includeChildUnits ? 'true' : 'false');
  }
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.unassignedOnly) params.set('coverage', 'unassigned');
  if (extra.page) params.set('page', String(extra.page));
  if (extra.pageSize) params.set('pageSize', String(extra.pageSize));
  return params.toString();
}

export const fetchScheduleGrid = (filters: ScheduleFilters, page: number) =>
  hrmFetch<HrmScheduleGrid>(
    `/work-schedules/grid?${buildScheduleQuery(filters, { page, pageSize: SCHEDULE_PAGE_SIZE })}`,
  );

export const fetchScheduleList = (filters: ScheduleFilters, page: number) =>
  hrmFetch<{
    data: HrmScheduleListRow[];
    meta: { total: number; page: number; pageSize: number };
  }>(
    `/work-schedules/list?${buildScheduleQuery(filters, { page, pageSize: SCHEDULE_PAGE_SIZE })}`,
  );

export const fetchScheduleExport = (filters: ScheduleFilters) =>
  hrmFetch<{ data: ScheduleExportRow[] }>(
    `/work-schedules/export?${buildScheduleQuery({ ...filters, unassignedOnly: false })}`,
  );

export const fetchScheduleAudit = (params: {
  employeeId?: string;
  batchId?: string;
  limit?: number;
}) => {
  const query = new URLSearchParams();
  if (params.employeeId) query.set('employeeId', params.employeeId);
  if (params.batchId) query.set('batchId', params.batchId);
  query.set('limit', String(params.limit ?? 100));
  return hrmFetch<{ data: HrmScheduleAuditEntry[] }>(
    `/work-schedules/audit?${query.toString()}`,
  );
};

/** Danh mục ca dùng chung với màn Quản lý ca. Chỉ ca ACTIVE mới được gán. */
export const fetchShifts = () => hrmFetch<{ data: HrmShiftDefinition[] }>('/shifts');
export const fetchUnits = () => hrmFetch<{ data: HrmOrgUnitOption[] }>('/shift-units');

const post = <T>(path: string, body: unknown) =>
  hrmFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const previewSchedule = (body: HrmApplyScheduleRequest) =>
  post<{ data: AnySchedulePreview }>('/work-schedules/preview', body);
export const applySchedule = (body: HrmApplyScheduleRequest) =>
  post<{ data: AnyApplyResult }>('/work-schedules', body);

export interface CancelScheduleResult {
  employeeCount: number;
  dayCount: number;
  keptProtected: number;
  batchId: string | null;
}
export const cancelSchedule = (body: HrmCancelScheduleRequest) =>
  post<{ data: CancelScheduleResult }>('/work-schedules/cancel', body);

export interface CopyScheduleResult {
  summary: HrmSchedulePlanSummary;
  requiresConfirmation: boolean;
  confirmReasons: string[];
  batchId: string | null;
}
export const copySchedule = (body: HrmCopyScheduleRequest) =>
  post<{ data: CopyScheduleResult }>('/work-schedules/copy', body);

// Lịch định kỳ (không có ngày kết thúc)
export const fetchRules = (params: {
  status?: 'ACTIVE' | 'CANCELLED';
  scopeType?: 'EMPLOYEE' | 'UNIT' | 'COMPANY';
  unitId?: string;
  employeeId?: string;
  activeOn?: string;
}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const qs = query.toString();
  return hrmFetch<{ data: HrmScheduleRule[] }>(`/work-schedules/rules${qs ? `?${qs}` : ''}`);
};
export const endRule = (id: string, body: { endDate: string; reason?: string }) =>
  post<{ data: { id: string; effectiveFrom: string; effectiveTo: string | null } }>(
    `/work-schedules/rules/${id}/end`,
    body,
  );
export const cancelRule = (id: string, body: { reason?: string } = {}) =>
  post<{ data: { id: string } }>(`/work-schedules/rules/${id}/cancel`, body);

// Mẫu lịch tuần
export const fetchTemplates = () =>
  hrmFetch<{ data: HrmScheduleTemplate[] }>('/work-schedule-templates');
export const createTemplate = (body: SaveScheduleTemplateRequest) =>
  post<{ data: HrmScheduleTemplate }>('/work-schedule-templates', body);
export const updateTemplate = (id: string, body: SaveScheduleTemplateRequest) =>
  hrmFetch<{ data: HrmScheduleTemplate }>(`/work-schedule-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const copyTemplate = (id: string, body: { code: string; name: string }) =>
  post<{ data: HrmScheduleTemplate }>(`/work-schedule-templates/${id}/copy`, body);
export const deactivateTemplate = (id: string) =>
  post<{ data: { id: string } }>(`/work-schedule-templates/${id}/deactivate`, {});
export const reapplyTemplate = (
  id: string,
  body: {
    fromDate: string;
    toDate: string;
    dryRun?: boolean;
    confirm?: boolean;
    reason?: string;
  },
) =>
  post<{ data: HrmSchedulePreview | HrmApplyScheduleResult }>(
    `/work-schedule-templates/${id}/reapply`,
    body,
  );

// Lịch lễ / Tết
export type HrmHolidayRow = HrmHoliday & { shiftCode?: string | null };
export const fetchHolidays = (year: number, status?: 'ACTIVE' | 'CANCELLED') =>
  hrmFetch<{ data: HrmHolidayRow[] }>(
    `/work-schedule-holidays?year=${year}${status ? `&status=${status}` : ''}`,
  );
export const createHoliday = (body: CreateHolidayRequest) =>
  post<{ data: unknown }>('/work-schedule-holidays', body);
export const cancelHoliday = (id: string, reason: string) =>
  post<{ data: unknown }>(`/work-schedule-holidays/${id}/cancel`, { reason });

/** Danh sách nhân viên cho ô chọn (id, mã, tên). Dùng endpoint dùng chung với các màn khác. */
export { hrmEmployeeOptions } from './hrm-api';
