import type { DirectoryOrgNode, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { withDescendantUnits } from './org-units';

/**
 * Bộ lọc dự án nhiều điều kiện (trang Dự án và trang Báo cáo).
 *
 * Bộ lọc gồm một từ khoá và các nhóm điều kiện: điều kiện trong cùng nhóm là VÀ, giữa các nhóm là HOẶC (nút
 * "Hoặc"). Chạy ở trình duyệt trên danh sách dự án đã tải — trang Dự án vốn tải trọn danh sách.
 */

export type FilterFieldType = 'text' | 'date' | 'select' | 'number';

/** Trường lọc được của dự án. */
export const PROJECT_FILTER_FIELDS = [
  { key: 'name', label: 'Tên dự án', type: 'text' },
  { key: 'code', label: 'Mã dự án', type: 'text' },
  { key: 'projectType', label: 'Nhóm dự án', type: 'select' },
  { key: 'orgUnitId', label: 'Phòng ban phụ trách', type: 'select' },
  { key: 'status', label: 'Trạng thái', type: 'select' },
  { key: 'tagIds', label: 'Nhãn', type: 'select' },
  { key: 'customerId', label: 'Khách hàng', type: 'select' },
  { key: 'ownerUserId', label: 'Chủ nhiệm', type: 'select' },
  { key: 'startDate', label: 'Bắt đầu', type: 'date' },
  { key: 'endDate', label: 'Kết thúc', type: 'date' },
  { key: 'createdAt', label: 'Ngày tạo', type: 'date' },
  { key: 'updatedAt', label: 'Ngày cập nhật', type: 'date' },
  { key: 'progressPercent', label: 'Tiến độ (%)', type: 'number' },
  { key: 'overdueItems', label: 'Số việc quá hạn', type: 'number' },
] as const satisfies readonly { key: string; label: string; type: FilterFieldType }[];

export type ProjectFilterFieldKey = (typeof PROJECT_FILTER_FIELDS)[number]['key'];

/** Phép so sánh theo kiểu trường, đúng thứ tự hiện trong danh sách. `needs` là số ô giá trị cần nhập. */
export const FILTER_OPERATORS = {
  text: [
    { key: 'contains', label: 'chứa', needs: 1 },
    { key: 'not_contains', label: 'không chứa', needs: 1 },
    { key: 'equals', label: 'bằng', needs: 1 },
    { key: 'starts_with', label: 'bắt đầu bằng', needs: 1 },
    { key: 'empty', label: 'không áp dụng', needs: 0 },
  ],
  select: [
    { key: 'in', label: 'thuộc', needs: 1 },
    { key: 'not_in', label: 'không thuộc', needs: 1 },
    { key: 'empty', label: 'không áp dụng', needs: 0 },
  ],
  number: [
    { key: 'eq', label: 'bằng', needs: 1 },
    { key: 'gt', label: 'lớn hơn', needs: 1 },
    { key: 'lt', label: 'nhỏ hơn', needs: 1 },
    { key: 'between', label: 'trong khoảng', needs: 2 },
  ],
  date: [
    { key: 'eq', label: 'bằng', needs: 1 },
    { key: 'before', label: 'trước ngày', needs: 1 },
    { key: 'after', label: 'sau ngày', needs: 1 },
    { key: 'after_today', label: 'sau ngày hiện tại', needs: 0 },
    { key: 'before_today', label: 'trước hiện tại', needs: 0 },
    { key: 'between', label: 'trong khoảng', needs: 2 },
    { key: 'today', label: 'là hôm nay', needs: 0 },
    { key: 'this_week', label: 'trong tuần hiện tại', needs: 0 },
    { key: 'this_month', label: 'trong tháng hiện tại', needs: 0 },
    { key: 'this_year', label: 'trong năm hiện tại', needs: 0 },
    { key: 'last_week', label: 'trong tuần trước', needs: 0 },
    { key: 'last_month', label: 'trong tháng trước', needs: 0 },
    { key: 'last_year', label: 'trong năm trước', needs: 0 },
    { key: 'empty', label: 'không áp dụng', needs: 0 },
  ],
} as const satisfies Record<FilterFieldType, readonly { key: string; label: string; needs: 0 | 1 | 2 }[]>;

/** Một điều kiện: trường, phép so sánh và giá trị (chuỗi, hoặc danh sách id với trường chọn). */
export interface FilterCondition {
  readonly id: string;
  readonly field: ProjectFilterFieldKey;
  readonly operator: string;
  readonly value?: string;
  readonly value2?: string;
  readonly values?: readonly string[];
}

export interface ProjectFilter {
  readonly keyword: string;
  /** Các nhóm điều kiện; nối với nhau bằng HOẶC, điều kiện trong một nhóm nối bằng VÀ. */
  readonly groups: readonly (readonly FilterCondition[])[];
}

export const EMPTY_PROJECT_FILTER: ProjectFilter = { keyword: '', groups: [] };

export function fieldOf(key: ProjectFilterFieldKey) {
  return PROJECT_FILTER_FIELDS.find((field) => field.key === key) ?? PROJECT_FILTER_FIELDS[0];
}

export function operatorsOf(key: ProjectFilterFieldKey) {
  return FILTER_OPERATORS[fieldOf(key).type];
}

/** Điều kiện đã đủ giá trị để áp dụng chưa; điều kiện còn thiếu bị bỏ qua thay vì lọc ra rỗng. */
export function conditionReady(condition: FilterCondition): boolean {
  const operator = operatorsOf(condition.field).find((entry) => entry.key === condition.operator);
  if (!operator) return false;
  if (operator.needs === 0) return true;
  if (fieldOf(condition.field).type === 'select') return (condition.values?.length ?? 0) > 0;
  if (operator.needs === 2) return Boolean(condition.value?.trim() && condition.value2?.trim());
  return Boolean(condition.value?.trim());
}

/** Số điều kiện đang có hiệu lực (kể cả từ khoá), để hiện trên nút lọc. */
export function activeConditionCount(filter: ProjectFilter): number {
  return (
    (filter.keyword.trim() ? 1 : 0) +
    filter.groups.reduce((sum, group) => sum + group.filter(conditionReady).length, 0)
  );
}

/** Ngữ cảnh khi lọc: hôm nay (giờ máy người dùng) và cây tổ chức để "thuộc phòng ban" tính cả phòng con. */
export interface FilterContext {
  readonly today: Date;
  readonly orgNodes: readonly DirectoryOrgNode[];
}

/** Bỏ dấu để gõ "dich vu" vẫn khớp "Dịch vụ". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Ngày `YYYY-MM-DD` của một giá trị: ngày thuần giữ nguyên, mốc ISO đổi về ngày theo giờ máy. */
function dayOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : dayKey(date);
}

/** Khoảng `[từ, đến]` (ngày) của các phép "trong tuần / tháng / năm hiện tại / trước". Tuần bắt đầu thứ Hai. */
function periodOf(operator: string, today: Date): [string, string] | undefined {
  const year = today.getFullYear();
  const month = today.getMonth();
  const monday = new Date(year, month, today.getDate() - ((today.getDay() + 6) % 7));
  switch (operator) {
    case 'this_week':
      return [dayKey(monday), dayKey(new Date(year, month, monday.getDate() + 6))];
    case 'last_week': {
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
      return [dayKey(start), dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))];
    }
    case 'this_month':
      return [dayKey(new Date(year, month, 1)), dayKey(new Date(year, month + 1, 0))];
    case 'last_month':
      return [dayKey(new Date(year, month - 1, 1)), dayKey(new Date(year, month, 0))];
    case 'this_year':
      return [`${year}-01-01`, `${year}-12-31`];
    case 'last_year':
      return [`${year - 1}-01-01`, `${year - 1}-12-31`];
    default:
      return undefined;
  }
}

function matchText(actual: string | undefined, condition: FilterCondition): boolean {
  if (condition.operator === 'empty') return !actual?.trim();
  const value = fold(condition.value?.trim() ?? '');
  const text = fold(actual ?? '');
  switch (condition.operator) {
    case 'contains':
      return text.includes(value);
    case 'not_contains':
      return !text.includes(value);
    case 'equals':
      return text.trim() === value;
    case 'starts_with':
      return text.startsWith(value);
    default:
      return true;
  }
}

function matchDate(actual: string | undefined, condition: FilterCondition, today: Date): boolean {
  const day = dayOf(actual);
  if (condition.operator === 'empty') return !day;
  if (!day) return false;
  const now = dayKey(today);
  switch (condition.operator) {
    case 'eq':
      return day === condition.value;
    case 'before':
      return day < (condition.value ?? '');
    case 'after':
      return day > (condition.value ?? '');
    case 'after_today':
      return day > now;
    case 'before_today':
      return day < now;
    case 'between': {
      const [from, to] = [condition.value ?? '', condition.value2 ?? ''].sort();
      return day >= (from ?? '') && day <= (to ?? '');
    }
    case 'today':
      return day === now;
    default: {
      const period = periodOf(condition.operator, today);
      return period ? day >= period[0] && day <= period[1] : true;
    }
  }
}

function matchNumber(actual: number, condition: FilterCondition): boolean {
  const value = Number(condition.value);
  switch (condition.operator) {
    case 'eq':
      return actual === value;
    case 'gt':
      return actual > value;
    case 'lt':
      return actual < value;
    case 'between': {
      const [low, high] = [value, Number(condition.value2)].sort((a, b) => a - b);
      return actual >= (low ?? 0) && actual <= (high ?? 0);
    }
    default:
      return true;
  }
}

function matchSelect(actual: readonly string[], condition: FilterCondition, context: FilterContext): boolean {
  if (condition.operator === 'empty') return actual.length === 0;
  let wanted = new Set(condition.values ?? []);
  // "Thuộc phòng ban" tính cả các phòng con của phòng được chọn.
  if (condition.field === 'orgUnitId') wanted = withDescendantUnits(context.orgNodes, [...wanted]);
  const hit = actual.some((value) => wanted.has(value));
  return condition.operator === 'not_in' ? !hit : hit;
}

function matchCondition(project: ProjectSummary, condition: FilterCondition, context: FilterContext): boolean {
  if (!conditionReady(condition)) return true;
  switch (condition.field) {
    case 'name':
    case 'code':
      return matchText(project[condition.field], condition);
    case 'startDate':
    case 'endDate':
    case 'createdAt':
    case 'updatedAt':
      return matchDate(project[condition.field], condition, context.today);
    case 'progressPercent':
    case 'overdueItems':
      return matchNumber(project[condition.field] ?? 0, condition);
    case 'tagIds':
      return matchSelect(project.tagIds ?? [], condition, context);
    case 'projectType':
      // Dự án chưa phân nhóm khớp lựa chọn "Chưa phân nhóm" (giá trị rỗng).
      return condition.operator === 'empty'
        ? !project.projectType
        : matchSelect([project.projectType ?? ''], condition, context);
    default: {
      const value = project[condition.field];
      return matchSelect(value ? [value] : [], condition, context);
    }
  }
}

/** Dự án có khớp bộ lọc không. Bộ lọc rỗng (không từ khoá, không điều kiện đủ giá trị) khớp mọi dự án. */
export function matchProjectFilter(
  project: ProjectSummary,
  filter: ProjectFilter,
  context: FilterContext,
): boolean {
  const keyword = fold(filter.keyword.trim());
  if (keyword) {
    const haystack = fold([project.code, project.name, project.description ?? '', project.projectType ?? ''].join(' '));
    if (!haystack.includes(keyword)) return false;
  }
  const groups = filter.groups.filter((group) => group.some(conditionReady));
  if (groups.length === 0) return true;
  return groups.some((group) => group.every((condition) => matchCondition(project, condition, context)));
}
