/**
 * Mô hình dữ liệu và hàm thuần cho mục "Địa điểm GPS" của nhóm "Chấm công": địa điểm (tọa độ, bán kính, IP tùy chọn), phòng
 * ban được gán (kế thừa xuống đơn vị con) và cài đặt kiểm tra vị trí chung.
 * Không chứa giao diện; tách ra để màn hình gọn và dễ kiểm thử.
 */
import { formatDateVn } from '../../personnel-decision-rules';

export type SiteAssignmentScope = 'COMPANY' | 'UNIT' | 'UNIT_EXCLUDE' | 'POSITION' | 'EMPLOYEE';

export interface SiteAssignment {
  id?: string;
  scope_type: SiteAssignmentScope;
  scope_id: string;
  scope_name?: string | null;
}

export interface UnitOption {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
}

/** Cài đặt kiểm tra vị trí khi chấm công của cả tenant. */
export interface LocationSettings {
  locationCheck: boolean;
  maxGpsAccuracyMeters: number;
  /** Tenant cũ chỉ kiểm IP bằng chính sách: chưa chuyển sang địa điểm. */
  legacyPolicy: boolean;
  configured: boolean;
}

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
    /** IP/CIDR của địa điểm; rỗng là không kiểm IP. */
    allowed_ips?: string[];
    assignments?: SiteAssignment[];
  }[];
  units?: UnitOption[];
  location?: LocationSettings;
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

export const today = () => new Date().toLocaleDateString('en-CA');

export const DAY_KIND_LABELS: Record<string, string> = {
  WORK: 'Làm việc',
  OFF: 'Nghỉ (OFF)',
  HOLIDAY: 'Lễ / Tết',
};

export type TimeSettingsTab = 'sites';

export const TIME_SETTINGS_TABS = [{ id: 'sites', label: 'Địa điểm GPS', permission: 'time' }] as const;

/** Tiêu đề, mô tả và tiền tố mã hành động nhật ký của từng mục (mỗi mục là một trang độc lập). */
export const SECTION_META: Record<
  TimeSettingsTab,
  { title: string; description: string; historyPrefixes: string[]; historyDescription: string }
> = {
  sites: {
    title: 'Địa điểm GPS',
    description: 'Khai báo địa điểm làm việc (GPS, kèm IP nếu cần) và phòng ban được chấm công tại đó',
    historyPrefixes: ['SITE_', 'LOCATION_'],
    historyDescription: 'Thay đổi địa điểm chấm công, phòng ban được gán và cài đặt kiểm tra vị trí, mới nhất ở trên.',
  },
};

const fold = (value: string) => value.toLocaleLowerCase('vi');

export function filterCalendar(rows: readonly CalendarRow[], search: string, kind: string): CalendarRow[] {
  const query = fold(search.trim());
  return rows.filter((row) => {
    if (kind !== 'ALL' && row.day_kind !== kind) return false;
    if (!query) return true;
    return [row.work_date, formatDateVn(row.work_date), row.name, DAY_KIND_LABELS[row.day_kind] ?? row.day_kind].some(
      (value) => fold(value).includes(query),
    );
  });
}

export function filterSites(rows: readonly SiteRow[], search: string, status: string): SiteRow[] {
  const query = fold(search.trim());
  return rows.filter((row) => {
    if (status === 'ACTIVE' && !row.active) return false;
    if (status === 'INACTIVE' && row.active) return false;
    if (!query) return true;
    return [row.name, String(row.latitude), String(row.longitude), ...(row.allowed_ips ?? [])].some((value) =>
      fold(value).includes(query),
    );
  });
}

/** Tách ô nhập IP (mỗi dòng hoặc cách nhau bằng dấu phẩy/khoảng trắng) thành danh sách, bỏ ô trống và trùng. */
export function parseIpText(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

export const formatIpText = (ips: readonly string[] | undefined) => (ips ?? []).join('\n');

/** Tóm tắt IP của địa điểm cho danh sách: không khai báo thì ghi rõ là không kiểm IP. */
export function ipSummary(ips: readonly string[] | undefined): string {
  const list = ips ?? [];
  if (list.length === 0) return 'Không kiểm IP';
  return list.length <= 2 ? list.join(', ') : `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
}

/** Tenant đã gán địa điểm cho ai chưa: chưa thì máy chủ cho mọi nhân viên dùng mọi địa điểm đang dùng. */
export const tenantHasAssignments = (sites: readonly SiteRow[]) => sites.some((s) => (s.assignments ?? []).length > 0);

/** Đơn vị và mọi đơn vị con của nó (đã kế thừa), để người dùng thấy gán một phòng thì phạm vi lan tới đâu. */
export function descendantUnitIds(units: readonly UnitOption[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++)
    for (const unit of units) if (unit.parentId === out[i] && !out.includes(unit.id)) out.push(unit.id);
  return out;
}

/** Dấu gán địa điểm trên cây phòng ban: toàn công ty, đơn vị được gán, đơn vị ngoại lệ (loại trừ). */
export interface UnitMarks {
  companyWide: boolean;
  unitIds: readonly string[];
  excludedUnitIds: readonly string[];
}

/** Đơn vị có chấm công tại địa điểm không: theo dấu gần nhất khi đi từ chính nó lên các đơn vị cha, không có dấu thì theo toàn công ty. */
export function unitCovered(units: readonly UnitOption[], marks: UnitMarks, id: string): boolean {
  const byId = new Map(units.map((u) => [u.id, u]));
  const included = new Set(marks.unitIds);
  const excluded = new Set(marks.excludedUnitIds);
  const seen = new Set<string>();
  for (let cur: string | null | undefined = id; cur && !seen.has(cur); cur = byId.get(cur)?.parentId) {
    seen.add(cur);
    if (excluded.has(cur)) return false;
    if (included.has(cur)) return true;
  }
  return marks.companyWide;
}

/** Bỏ các dấu thừa (dấu trùng với kết quả kế thừa từ cha), giữ nguyên kết quả của từng đơn vị. */
export function normalizeMarks(units: readonly UnitOption[], marks: UnitMarks): UnitMarks {
  const known = new Set(units.map((u) => u.id));
  let current: UnitMarks = {
    companyWide: marks.companyWide,
    unitIds: marks.unitIds.filter((id) => known.has(id)),
    excludedUnitIds: marks.excludedUnitIds.filter((id) => known.has(id) && !marks.unitIds.includes(id)),
  };
  // Duyệt từ đơn vị gần gốc xuống để dấu của cha được xét trước.
  const depth = (id: string) => {
    let d = 0;
    for (let cur = units.find((u) => u.id === id)?.parentId; cur && d < 50; cur = units.find((u) => u.id === cur)?.parentId) d++;
    return d;
  };
  const ordered = [...current.unitIds, ...current.excludedUnitIds].sort((a, b) => depth(a) - depth(b));
  for (const id of ordered) {
    const isInclude = current.unitIds.includes(id);
    const without: UnitMarks = {
      ...current,
      unitIds: current.unitIds.filter((x) => x !== id),
      excludedUnitIds: current.excludedUnitIds.filter((x) => x !== id),
    };
    if (unitCovered(units, without, id) === isInclude) current = without;
  }
  return current;
}

/** Tick hoặc bỏ tick một đơn vị: áp cho cả nhánh con (xóa ngoại lệ bên dưới) và chỉ giữ dấu khi khác với kế thừa từ cha. */
export function toggleUnit(units: readonly UnitOption[], marks: UnitMarks, id: string, checked: boolean): UnitMarks {
  const subtree = new Set(descendantUnitIds(units, id));
  const base: UnitMarks = {
    ...marks,
    unitIds: marks.unitIds.filter((x) => !subtree.has(x)),
    excludedUnitIds: marks.excludedUnitIds.filter((x) => !subtree.has(x)),
  };
  const parentId = units.find((u) => u.id === id)?.parentId ?? null;
  const inherited = parentId ? unitCovered(units, base, parentId) : base.companyWide;
  if (checked === inherited) return base;
  return checked
    ? { ...base, unitIds: [...base.unitIds, id] }
    : { ...base, excludedUnitIds: [...base.excludedUnitIds, id] };
}

export interface UnitTreeNode {
  key: string;
  title: string;
  children: UnitTreeNode[];
}

/** Cây đơn vị cho ô chọn; có `query` thì chỉ giữ nhánh có tên hoặc mã khớp (kèm các đơn vị cha của chúng). */
export function buildUnitTree(units: readonly UnitOption[], query = ''): UnitTreeNode[] {
  const needle = query.trim().toLowerCase();
  const ids = new Set(units.map((u) => u.id));
  const childrenOf = new Map<string | null, UnitOption[]>();
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), u]);
  }
  const visited = new Set<string>();
  const build = (u: UnitOption): UnitTreeNode | null => {
    if (visited.has(u.id)) return null;
    visited.add(u.id);
    const children = (childrenOf.get(u.id) ?? []).map(build).filter((n): n is UnitTreeNode => n !== null);
    const self = !needle || `${u.name} ${u.code}`.toLowerCase().includes(needle);
    if (!self && children.length === 0) return null;
    return { key: u.id, title: `${u.name} (${u.code})`, children };
  };
  return (childrenOf.get(null) ?? []).map(build).filter((n): n is UnitTreeNode => n !== null);
}

/** Mọi khóa của cây, để mở rộng toàn bộ khi đang tìm kiếm. */
export function treeKeys(nodes: readonly UnitTreeNode[]): string[] {
  return nodes.flatMap((n) => [n.key, ...treeKeys(n.children)]);
}

/** Phạm vi áp dụng của một địa điểm, dạng câu ngắn cho danh sách. */
export function describeAssignments(site: SiteRow, anyAssignments: boolean): string {
  const list = site.assignments ?? [];
  if (list.length === 0) return anyAssignments ? 'Chưa gán cho ai' : 'Mọi nhân viên (chưa gán riêng)';
  const excluded = list.filter((a) => a.scope_type === 'UNIT_EXCLUDE').map((a) => a.scope_name || 'Đơn vị');
  const except = excluded.length
    ? `, trừ ${excluded.slice(0, 2).join(', ')}${excluded.length > 2 ? ` +${excluded.length - 2}` : ''}`
    : '';
  if (list.some((a) => a.scope_type === 'COMPANY')) return `Toàn công ty${except}`;
  const units = list.filter((a) => a.scope_type === 'UNIT').map((a) => a.scope_name || 'Đơn vị');
  const positions = list.filter((a) => a.scope_type === 'POSITION').length;
  const employees = list.filter((a) => a.scope_type === 'EMPLOYEE').length;
  const parts = [
    units.length ? `${units.slice(0, 2).join(', ')}${units.length > 2 ? ` +${units.length - 2}` : ''} (gồm đơn vị con${except})` : '',
    positions ? `${positions} chức danh` : '',
    employees ? `${employees} nhân viên` : '',
  ].filter(Boolean);
  return parts.join('; ');
}
