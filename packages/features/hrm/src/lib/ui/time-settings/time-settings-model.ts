/**
 * Mô hình dữ liệu và hàm thuần cho nhóm màn "Chấm công" (quy định chấm công, địa điểm GPS).
 * Không chứa giao diện; tách ra để màn hình gọn và dễ kiểm thử.
 */
import { formatDateVn } from '../../personnel-decision-rules';

export type Settings = {
  calendar: {
    id: string;
    work_date: string;
    name: string;
    day_kind: string;
    paid: boolean;
    updated_at: string;
  }[];
  sites: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
    active: boolean;
    updated_at: string;
  }[];
  versions: {
    id: string;
    version_no: number;
    effective_from: string;
    effective_to: string | null;
    config_json: Record<string, unknown>;
    status?: string;
    policy_code?: string;
    policy_name?: string;
  }[];
  holidayStatus?: {
    year: number;
    count: number;
    missing: boolean;
    warning: string | null;
    templateLabel: string;
  };
};
export type CalendarRow = Settings['calendar'][number];
export type SiteRow = Settings['sites'][number];
export type PolicyVersion = Settings['versions'][number];
export type EmployeeOption = { value: string; label: string };

export const today = () => new Date().toLocaleDateString('en-CA');

export const DAY_KIND_LABELS: Record<string, string> = {
  WORK: 'Làm việc',
  OFF: 'Nghỉ (OFF)',
  HOLIDAY: 'Lễ / Tết',
};

/** Đọc cấu hình chấp nhận cả khóa camelCase lẫn snake_case (dữ liệu seed). */
export const configFlag = (
  c: Record<string, unknown>,
  camel: string,
  snake: string,
) => Boolean(c[camel] ?? c[snake]);

export const versionEmployees = (v: PolicyVersion) =>
  Array.isArray(v.config_json.employeeIds)
    ? (v.config_json.employeeIds as string[])
    : [];

export type VersionState = 'Đang áp dụng' | 'Chưa hiệu lực' | 'Hết hiệu lực';
/** Trạng thái tính theo ngày, không dựa vào cột status. */
export function versionStatusLabel(v: PolicyVersion, day: string): VersionState {
  const from = v.effective_from.slice(0, 10);
  const to = v.effective_to?.slice(0, 10) ?? null;
  if (from > day) return 'Chưa hiệu lực';
  if (to && to < day) return 'Hết hiệu lực';
  return 'Đang áp dụng';
}

export const addDays = (date: string, delta: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/**
 * Phiên bản đang áp dụng cho TOÀN CÔNG TY tại `day` (phiên bản bắt đầu muộn nhất, rồi số phiên bản lớn nhất).
 * Phiên bản chạy thử cho một nhóm nhân viên không được coi là quy định chung.
 */
export function pickCurrentVersion(
  versions: readonly PolicyVersion[],
  day: string,
): PolicyVersion | null {
  const list = versions
    .filter(
      (v) =>
        versionStatusLabel(v, day) === 'Đang áp dụng' &&
        versionEmployees(v).length === 0,
    )
    .sort(
      (a, b) =>
        b.effective_from.localeCompare(a.effective_from) ||
        b.version_no - a.version_no,
    );
  return list[0] ?? null;
}

/** Số phiên bản đang hiệu lực nhưng chỉ áp dụng cho một nhóm nhân viên (chạy thử). */
export function countScopedInForce(
  versions: readonly PolicyVersion[],
  day: string,
): number {
  return versions.filter(
    (v) =>
      versionStatusLabel(v, day) === 'Đang áp dụng' &&
      versionEmployees(v).length > 0,
  ).length;
}

export const versionScopeLabel = (v: PolicyVersion) => {
  const ids = versionEmployees(v);
  return ids.length ? `${ids.length} nhân viên` : 'Toàn công ty';
};

export const versionRangeLabel = (v: PolicyVersion) =>
  `${formatDateVn(v.effective_from)} - ${v.effective_to ? formatDateVn(v.effective_to) : 'Chưa kết thúc'}`;

function allowedIps(c: Record<string, unknown>): string[] {
  const raw = c.allowedIps ?? c.allowed_ips;
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && x !== '')
    : [];
}
function gpsTolerance(c: Record<string, unknown>): number | null {
  const raw = c.maxGpsAccuracyMeters ?? c.max_gps_accuracy_meters;
  const n = Number(raw);
  return raw === undefined || raw === null || !Number.isFinite(n) ? null : n;
}

export interface RuleSummary {
  timezone: string;
  ip: string;
  gps: string;
  scope: string;
  range: string;
}

/** Tóm tắt một phiên bản từ `config_json` thật (không suy đoán giá trị thiếu). */
export function summarizeVersion(v: PolicyVersion): RuleSummary {
  const c = v.config_json ?? {};
  const ips = allowedIps(c);
  const tolerance = gpsTolerance(c);
  return {
    timezone: String(c.timezone ?? '') || 'Chưa cấu hình',
    ip: configFlag(c, 'requireIp', 'require_ip')
      ? ips.length
        ? `Bắt buộc: ${ips.join(', ')}`
        : 'Bắt buộc'
      : 'Không yêu cầu',
    gps: configFlag(c, 'requireGps', 'require_gps')
      ? tolerance !== null
        ? `Bắt buộc, dung sai ${tolerance} m`
        : 'Bắt buộc'
      : 'Không yêu cầu',
    scope: versionScopeLabel(v),
    range: versionRangeLabel(v),
  };
}

/** Các điều kiện đang bật của một phiên bản, dạng nhãn ngắn cho danh sách. */
export function conditionChips(v: PolicyVersion): string[] {
  const c = v.config_json ?? {};
  const out: string[] = [];
  if (configFlag(c, 'requireIp', 'require_ip')) out.push('IP');
  if (configFlag(c, 'requireGps', 'require_gps')) {
    const t = gpsTolerance(c);
    out.push(t !== null ? `GPS ${t} m` : 'GPS');
  }
  return out;
}

export type TimeSettingsTab = 'rules' | 'sites';

export const TIME_SETTINGS_TABS = [
  { id: 'rules', label: 'Quy định chấm công', permission: 'time' },
  { id: 'sites', label: 'Địa điểm GPS', permission: 'time' },
] as const;

/** Tiêu đề, mô tả và tiền tố mã hành động nhật ký của từng mục (mỗi mục là một trang độc lập). */
export const SECTION_META: Record<
  TimeSettingsTab,
  { title: string; description: string; historyPrefixes: string[]; historyDescription: string }
> = {
  rules: {
    title: 'Quy định chấm công',
    description: 'Thiết lập quy tắc chấm công, điều kiện hợp lệ',
    historyPrefixes: ['POLICY_VERSION_PUBLISHED'],
    historyDescription:
      'Các phiên bản chính sách đã ban hành (gồm cả nhóm chính sách khác dùng chung cơ chế phiên bản), mới nhất ở trên.',
  },
  sites: {
    title: 'Địa điểm GPS',
    description: 'Quản lý địa điểm làm việc theo GPS',
    historyPrefixes: ['SITE_'],
    historyDescription: 'Thay đổi địa điểm chấm công, mới nhất ở trên.',
  },
};

const fold = (value: string) => value.toLocaleLowerCase('vi');

export function filterCalendar(
  rows: readonly CalendarRow[],
  search: string,
  kind: string,
): CalendarRow[] {
  const query = fold(search.trim());
  return rows.filter((row) => {
    if (kind !== 'ALL' && row.day_kind !== kind) return false;
    if (!query) return true;
    return [
      row.work_date,
      formatDateVn(row.work_date),
      row.name,
      DAY_KIND_LABELS[row.day_kind] ?? row.day_kind,
    ].some((value) => fold(value).includes(query));
  });
}

export function filterSites(
  rows: readonly SiteRow[],
  search: string,
  status: string,
): SiteRow[] {
  const query = fold(search.trim());
  return rows.filter((row) => {
    if (status === 'ACTIVE' && !row.active) return false;
    if (status === 'INACTIVE' && row.active) return false;
    if (!query) return true;
    return [row.name, String(row.latitude), String(row.longitude)].some(
      (value) => fold(value).includes(query),
    );
  });
}

export interface PolicyFormState {
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
  scope: 'ALL' | 'EMPLOYEES';
  employeeIds: string[];
  timezone: string;
  requireIp: boolean;
  allowedIps: string;
  requireGps: boolean;
  maxGpsAccuracyMeters: number;
}

/** Giá trị ban đầu khi mở hộp thoại tạo phiên bản (giữ nguyên mặc định cũ). */
export const emptyPolicyForm = (): PolicyFormState => ({
  effectiveFrom: today(),
  effectiveTo: '',
  reason: '',
  scope: 'ALL',
  employeeIds: [],
  timezone: 'Asia/Ho_Chi_Minh',
  requireIp: false,
  allowedIps: '',
  requireGps: false,
  maxGpsAccuracyMeters: 100,
});

/** Phiên bản nào sẽ bị kết thúc / chặn khi ban hành khoảng hiệu lực mới (giống kiểm tra của máy chủ). */
export function previewPolicyImpact(
  versions: readonly PolicyVersion[],
  policy: Pick<
    PolicyFormState,
    'effectiveFrom' | 'effectiveTo' | 'scope' | 'employeeIds'
  >,
) {
  const from = policy.effectiveFrom;
  const to = policy.effectiveTo || null;
  const mine = policy.scope === 'EMPLOYEES' ? policy.employeeIds : [];
  const closing: string[] = [];
  const blocking: string[] = [];
  for (const v of versions) {
    // Bản nháp không tham gia kiểm tra chồng lấn (giống backend).
    if (v.status === 'DRAFT') continue;
    const theirs = versionEmployees(v);
    const collide =
      (!mine.length && !theirs.length) ||
      (mine.length > 0 && theirs.some((id) => mine.includes(id)));
    const vFrom = v.effective_from.slice(0, 10);
    const vTo = v.effective_to?.slice(0, 10) ?? null;
    const overlap = (!to || vFrom <= to) && (!vTo || from <= vTo);
    if (!collide || !overlap) continue;
    const label = `v${v.version_no} (${v.policy_name ?? v.policy_code ?? 'chính sách'}, ${formatDateVn(vFrom)} - ${vTo ? formatDateVn(vTo) : 'chưa kết thúc'})`;
    if (vFrom >= from || vTo) blocking.push(label);
    else
      closing.push(
        `${label} sẽ kết thúc ngày ${formatDateVn(addDays(from, -1))}`,
      );
  }
  return { closing, blocking };
}
