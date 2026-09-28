/**
 * Đánh giá điều kiện rẽ nhánh — hàm thuần, dùng chung cho server (quyết định
 * thật) và UI (xem trước, cảnh báo chồng lấn), để hai bên không bao giờ hiểu
 * một điều kiện theo hai cách.
 */
import type {
  ProcedureAttributeDefinition,
  ProcedureAttributeRef,
  ProcedureAttributeType,
  ProcedureAttributeValue,
  ProcedureBranchDefinition,
  ProcedureBranchResult,
  ProcedureConditionGroup,
  ProcedureConditionOperator,
  ProcedureConditionRule,
  ProcedureDecisionInput,
  ProcedureGatewayDefinition,
} from './procedure-flow.types.js';

/**
 * Cận trên của "trong khoảng" với số/tiền/phần trăm có được tính vào không.
 *
 * Đang để `false` — khoảng nửa mở [từ; đến): "từ 100 triệu đến 1 tỷ" nghĩa là
 * ≥ 100.000.000 và < 1.000.000.000, nên hai nhánh liền kề không bao giờ cùng
 * nhận một giá trị biên. Chờ chốt (Q1); đổi ở đúng một chỗ này.
 */
export const PROCEDURE_BETWEEN_INCLUDES_UPPER = false;

export const PROCEDURE_OPERATORS_BY_TYPE: Readonly<
  Record<ProcedureAttributeType, readonly ProcedureConditionOperator[]>
> = {
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  money: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  percent: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  select: ['is', 'is_not', 'in', 'empty', 'not_empty'],
  boolean: ['is', 'empty', 'not_empty'],
  date: ['before', 'after', 'date_between', 'empty', 'not_empty'],
  text: ['empty', 'not_empty'],
  file: ['empty', 'not_empty'],
  user: ['empty', 'not_empty'],
};

export const PROCEDURE_OPERATOR_LABELS: Readonly<Record<ProcedureConditionOperator, string>> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'trong khoảng',
  is: 'là',
  is_not: 'không là',
  in: 'thuộc một trong',
  before: 'trước ngày',
  after: 'sau ngày',
  date_between: 'trong khoảng ngày',
  empty: 'trống',
  not_empty: 'có giá trị',
};

const NUMERIC_TYPES: readonly ProcedureAttributeType[] = ['number', 'money', 'percent'];

export function isNumericAttributeType(type: ProcedureAttributeType): boolean {
  return NUMERIC_TYPES.includes(type);
}

/**
 * Giá trị của luật là danh sách mã (toán tử 'in').
 *
 * `Array.isArray` không thu hẹp được kiểu `readonly string[]` trong union, nên
 * cần type guard riêng.
 */
export function isCodeList(input: unknown): input is readonly string[] {
  return Array.isArray(input);
}

export function operatorNeedsValue(operator: ProcedureConditionOperator): boolean {
  return operator !== 'empty' && operator !== 'not_empty';
}

export function operatorNeedsUpperBound(operator: ProcedureConditionOperator): boolean {
  return operator === 'between' || operator === 'date_between';
}

/** Khoá lưu giá trị trong `ProcedureInstance.attributeValues`. */
export function attributeValueKey(ref: ProcedureAttributeRef): string {
  return ref.scope === 'process' ? `process:${ref.code}` : `step:${ref.stepId}:${ref.code}`;
}

export function sameAttributeRef(left: ProcedureAttributeRef, right: ProcedureAttributeRef): boolean {
  return attributeValueKey(left) === attributeValueKey(right);
}

export function isBlankAttributeValue(value: ProcedureAttributeValue | undefined): boolean {
  if (!value) return true;
  switch (value.type) {
    case 'text':
    case 'select':
    case 'date':
    case 'user':
      return !value.value.trim();
    case 'file':
      return value.value.length === 0;
    case 'number':
    case 'money':
    case 'percent':
      return !Number.isFinite(value.value);
    case 'boolean':
      return false;
  }
}

function asNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function asDate(input: unknown): string | undefined {
  return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : undefined;
}

/**
 * Một luật có thoả với giá trị đã nhập không.
 *
 * Giá trị trống chỉ thoả `empty`; mọi phép so sánh khác đều là `false`, để một
 * trường chưa nhập rơi về nhánh mặc định thay vì lọt nhầm vào nhánh "< X".
 */
export function evaluateConditionRule(
  rule: ProcedureConditionRule,
  value: ProcedureAttributeValue | undefined,
): boolean {
  const blank = isBlankAttributeValue(value);
  if (rule.operator === 'empty') return blank;
  if (rule.operator === 'not_empty') return !blank;
  if (blank || !value) return false;

  switch (value.type) {
    case 'number':
    case 'money':
    case 'percent': {
      const actual = value.value;
      const target = asNumber(rule.value);
      if (target === undefined) return false;
      switch (rule.operator) {
        case 'eq':
          return actual === target;
        case 'neq':
          return actual !== target;
        case 'gt':
          return actual > target;
        case 'gte':
          return actual >= target;
        case 'lt':
          return actual < target;
        case 'lte':
          return actual <= target;
        case 'between': {
          const upper = asNumber(rule.valueTo);
          if (upper === undefined) return false;
          return (
            actual >= target &&
            (PROCEDURE_BETWEEN_INCLUDES_UPPER ? actual <= upper : actual < upper)
          );
        }
        default:
          return false;
      }
    }
    case 'select':
      switch (rule.operator) {
        case 'is':
          return value.value === rule.value;
        case 'is_not':
          return value.value !== rule.value;
        case 'in':
          return isCodeList(rule.value) && rule.value.includes(value.value);
        default:
          return false;
      }
    case 'boolean':
      return rule.operator === 'is' && value.value === rule.value;
    case 'date': {
      // YYYY-MM-DD so sánh được theo thứ tự chuỗi; không giờ, không múi giờ.
      const target = asDate(rule.value);
      if (!target) return false;
      switch (rule.operator) {
        case 'before':
          return value.value < target;
        case 'after':
          return value.value > target;
        case 'date_between': {
          // Khoảng ngày tính trọn hai đầu: "từ 01/10 đến 31/10" gồm cả ngày 31.
          const upper = asDate(rule.valueTo);
          return !!upper && value.value >= target && value.value <= upper;
        }
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

export type ProcedureAttributeLookup = (
  ref: ProcedureAttributeRef,
) => ProcedureAttributeValue | undefined;

export function evaluateConditionGroup(
  group: ProcedureConditionGroup | undefined,
  lookup: ProcedureAttributeLookup,
): { matched: boolean; rules: { ruleId: string; matched: boolean }[] } {
  const rules = (group?.rules ?? []).map((rule) => ({
    ruleId: rule.id,
    matched: evaluateConditionRule(rule, lookup(rule.attribute)),
  }));
  // Nhánh không phải mặc định mà không có luật nào thì không bao giờ khớp;
  // luật công bố đã chặn cấu hình này, đây chỉ là lưới an toàn.
  if (rules.length === 0) return { matched: false, rules };
  const matched =
    group?.combinator === 'or'
      ? rules.some((item) => item.matched)
      : rules.every((item) => item.matched);
  return { matched, rules };
}

export interface ProcedureBranchSelection {
  readonly branch: ProcedureBranchDefinition;
  readonly usedDefault: boolean;
  readonly branchResults: ProcedureBranchResult[];
  readonly inputs: ProcedureDecisionInput[];
}

/**
 * Chọn nhánh cho một gateway độc quyền: nhánh có điều kiện đầu tiên khớp (theo
 * thứ tự cấu hình), không khớp nhánh nào thì lấy nhánh mặc định.
 *
 * Vẫn đánh giá HẾT các nhánh chứ không dừng ở nhánh khớp đầu: log quyết định cần
 * cho người đọc thấy vì sao các nhánh khác bị loại.
 */
export function selectGatewayBranch(
  gateway: ProcedureGatewayDefinition,
  lookup: ProcedureAttributeLookup,
): ProcedureBranchSelection | undefined {
  const fallback = gateway.branches.find((branch) => branch.isDefault);
  const branchResults: ProcedureBranchResult[] = [];
  let chosen: ProcedureBranchDefinition | undefined;
  for (const branch of gateway.branches) {
    if (branch.isDefault) continue;
    const result = evaluateConditionGroup(branch.condition, lookup);
    branchResults.push({ branchId: branch.id, matched: result.matched, rules: result.rules });
    if (result.matched && !chosen) chosen = branch;
  }

  const branch = chosen ?? fallback;
  if (!branch) return undefined;

  const seen = new Set<string>();
  const inputs: ProcedureDecisionInput[] = [];
  for (const candidate of gateway.branches) {
    for (const rule of candidate.condition?.rules ?? []) {
      const key = attributeValueKey(rule.attribute);
      if (seen.has(key)) continue;
      seen.add(key);
      inputs.push({ ref: rule.attribute, value: lookup(rule.attribute) });
    }
  }

  return { branch, usedDefault: !chosen, branchResults, inputs };
}

// ------------------------------------------------------------------ Chồng lấn khoảng

/** Khoảng trên trục số; ngày được đổi sang số ngày. `undefined` = vô hạn. */
interface Interval {
  lo?: number;
  loInclusive: boolean;
  hi?: number;
  hiInclusive: boolean;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function ruleInterval(rule: ProcedureConditionRule): Interval | undefined {
  const num = asNumber(rule.value);
  const numTo = asNumber(rule.valueTo);
  const date = asDate(rule.value);
  const dateTo = asDate(rule.valueTo);
  switch (rule.operator) {
    case 'eq':
      return num === undefined ? undefined : { lo: num, loInclusive: true, hi: num, hiInclusive: true };
    case 'gt':
      return num === undefined ? undefined : { lo: num, loInclusive: false, hiInclusive: false };
    case 'gte':
      return num === undefined ? undefined : { lo: num, loInclusive: true, hiInclusive: false };
    case 'lt':
      return num === undefined ? undefined : { loInclusive: false, hi: num, hiInclusive: false };
    case 'lte':
      return num === undefined ? undefined : { loInclusive: false, hi: num, hiInclusive: true };
    case 'between':
      return num === undefined || numTo === undefined
        ? undefined
        : { lo: num, loInclusive: true, hi: numTo, hiInclusive: PROCEDURE_BETWEEN_INCLUDES_UPPER };
    case 'before':
      return date ? { loInclusive: false, hi: dayNumber(date), hiInclusive: false } : undefined;
    case 'after':
      return date ? { lo: dayNumber(date), loInclusive: false, hiInclusive: false } : undefined;
    case 'date_between':
      return date && dateTo
        ? { lo: dayNumber(date), loInclusive: true, hi: dayNumber(dateTo), hiInclusive: true }
        : undefined;
    default:
      return undefined;
  }
}

function intersect(left: Interval, right: Interval): Interval {
  let lo = left.lo;
  let loInclusive = left.loInclusive;
  if (right.lo !== undefined && (lo === undefined || right.lo > lo || (right.lo === lo && !right.loInclusive))) {
    lo = right.lo;
    loInclusive = right.loInclusive;
  }
  let hi = left.hi;
  let hiInclusive = left.hiInclusive;
  if (right.hi !== undefined && (hi === undefined || right.hi < hi || (right.hi === hi && !right.hiInclusive))) {
    hi = right.hi;
    hiInclusive = right.hiInclusive;
  }
  return { lo, loInclusive, hi, hiInclusive };
}

function isEmptyInterval(interval: Interval): boolean {
  if (interval.lo === undefined || interval.hi === undefined) return false;
  if (interval.lo > interval.hi) return true;
  return interval.lo === interval.hi && !(interval.loInclusive && interval.hiInclusive);
}

function contains(outer: Interval, inner: Interval): boolean {
  const loOk =
    outer.lo === undefined ||
    (inner.lo !== undefined &&
      (inner.lo > outer.lo || (inner.lo === outer.lo && (outer.loInclusive || !inner.loInclusive))));
  const hiOk =
    outer.hi === undefined ||
    (inner.hi !== undefined &&
      (inner.hi < outer.hi || (inner.hi === outer.hi && (outer.hiInclusive || !inner.hiInclusive))));
  return loOk && hiOk;
}

/**
 * Quy một nhánh về khoảng trên MỘT thuộc tính, nếu làm được.
 *
 * Chỉ phân tích dạng phổ biến: mọi luật cùng một thuộc tính số/ngày, nối bằng VÀ.
 * Dạng khác (HOẶC, nhiều thuộc tính, danh sách) trả `undefined` — không đoán.
 */
function branchInterval(
  branch: ProcedureBranchDefinition,
): { key: string; interval: Interval } | undefined {
  const rules = branch.condition?.rules ?? [];
  if (!rules.length) return undefined;
  if (branch.condition?.combinator === 'or' && rules.length > 1) return undefined;
  const key = attributeValueKey(rules[0].attribute);
  let interval: Interval = { loInclusive: false, hiInclusive: false };
  for (const rule of rules) {
    if (attributeValueKey(rule.attribute) !== key) return undefined;
    const next = ruleInterval(rule);
    if (!next) return undefined;
    interval = intersect(interval, next);
  }
  return { key, interval };
}

export interface ProcedureBranchOverlap {
  readonly branchId: string;
  readonly overlapsBranchId: string;
  /** True khi nhánh sau bị nhánh trước che hoàn toàn: nó không bao giờ được chọn. */
  readonly shadowed: boolean;
}

/**
 * Dò các nhánh có khoảng giá trị giao nhau.
 *
 * Không phải lỗi — gateway chọn nhánh khớp ĐẦU TIÊN nên chồng lấn vẫn có một kết
 * quả xác định — nhưng gần như luôn là cấu hình nhầm, nên báo cảnh báo.
 */
export function findBranchOverlaps(gateway: ProcedureGatewayDefinition): ProcedureBranchOverlap[] {
  const analysed = gateway.branches
    .filter((branch) => !branch.isDefault)
    .map((branch) => ({ branch, shape: branchInterval(branch) }));
  const overlaps: ProcedureBranchOverlap[] = [];
  for (let later = 0; later < analysed.length; later += 1) {
    const current = analysed[later];
    if (!current?.shape) continue;
    for (let earlier = 0; earlier < later; earlier += 1) {
      const previous = analysed[earlier];
      if (!previous?.shape || previous.shape.key !== current.shape.key) continue;
      const common = intersect(previous.shape.interval, current.shape.interval);
      if (isEmptyInterval(common)) continue;
      overlaps.push({
        branchId: current.branch.id,
        overlapsBranchId: previous.branch.id,
        shadowed: contains(previous.shape.interval, current.shape.interval),
      });
    }
  }
  return overlaps;
}

// ------------------------------------------------------------------ Hiển thị

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function formatAttributeValue(
  value: ProcedureAttributeValue | undefined,
  definition?: ProcedureAttributeDefinition,
): string {
  if (!value || isBlankAttributeValue(value)) return '(trống)';
  switch (value.type) {
    case 'money':
      return `${numberFormat.format(value.value)} đ`;
    case 'percent':
      return `${numberFormat.format(value.value)}%`;
    case 'number':
      return numberFormat.format(value.value);
    case 'date':
      return formatDate(value.value);
    case 'boolean':
      return value.value ? 'Có' : 'Không';
    case 'select':
      return definition?.options?.find((option) => option.code === value.value)?.label ?? value.value;
    case 'file':
      return `${value.value.length} tệp`;
    case 'user':
      return value.label ?? value.value;
    case 'text':
      return value.value;
  }
}

function formatOperand(
  input: ProcedureConditionRule['value'] | undefined,
  definition?: ProcedureAttributeDefinition,
): string {
  if (input === undefined) return '';
  if (isCodeList(input)) {
    return input
      .map((code) => definition?.options?.find((option) => option.code === code)?.label ?? code)
      .join(', ');
  }
  if (typeof input === 'number') {
    const suffix = definition?.type === 'money' ? ' đ' : definition?.type === 'percent' ? '%' : '';
    return `${numberFormat.format(input)}${suffix}`;
  }
  if (typeof input === 'boolean') return input ? 'Có' : 'Không';
  if (definition?.type === 'date') return formatDate(input);
  if (definition?.type === 'select') {
    return definition.options?.find((option) => option.code === input)?.label ?? input;
  }
  return input;
}

/** "Giá trị báo giá ≥ 100.000.000 đ và < 1.000.000.000 đ" — dùng cho UI và log. */
export function describeConditionRule(
  rule: ProcedureConditionRule,
  definition?: ProcedureAttributeDefinition,
): string {
  const name = definition?.name ?? rule.attribute.code;
  if (!operatorNeedsValue(rule.operator)) return `${name} ${PROCEDURE_OPERATOR_LABELS[rule.operator]}`;
  if (rule.operator === 'between') {
    const upper = PROCEDURE_BETWEEN_INCLUDES_UPPER ? '≤' : '<';
    return `${name} ≥ ${formatOperand(rule.value, definition)} và ${upper} ${formatOperand(
      rule.valueTo,
      definition,
    )}`;
  }
  if (rule.operator === 'date_between') {
    return `${name} từ ${formatOperand(rule.value, definition)} đến ${formatOperand(
      rule.valueTo,
      definition,
    )}`;
  }
  return `${name} ${PROCEDURE_OPERATOR_LABELS[rule.operator]} ${formatOperand(rule.value, definition)}`;
}
