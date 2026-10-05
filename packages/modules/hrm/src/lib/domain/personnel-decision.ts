/**
 * Quy tắc thuần của quyết định nhân sự và quan hệ báo cáo. Không đọc DB: service
 * nạp dữ liệu rồi gọi các hàm này, nên kiểm thử được không cần Postgres.
 */

export const DECISION_TYPES = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
  'DISMISS',
  'CHANGE_MANAGER',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Các loại giao một chức danh mới ở Core. */
const ASSIGNING_TYPES: readonly DecisionType[] = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
];

export function isAssigningType(type: DecisionType): boolean {
  return ASSIGNING_TYPES.includes(type);
}

/** Loại cần gọi Core: giao chức danh mới hoặc kết thúc phân công (miễn nhiệm). */
export function needsCoreAction(type: DecisionType): boolean {
  return isAssigningType(type) || type === 'DISMISS';
}

/** Bổ nhiệm, thăng chức, điều chuyển thay thế chức danh chính; kiêm nhiệm thì không. */
export function replacesPrimaryPosition(type: DecisionType): boolean {
  return type === 'APPOINT' || type === 'PROMOTE' || type === 'TRANSFER';
}

export interface DecisionShape {
  readonly decisionType: DecisionType;
  readonly employeeId: string;
  readonly toPositionNodeId?: string | null;
  readonly managerMode: 'KEEP' | 'SET' | 'CLEAR';
  readonly toManagerEmployeeId?: string | null;
  readonly subordinateMode: 'KEEP' | 'REASSIGN';
  readonly subordinateTargetEmployeeId?: string | null;
  readonly salaryChanged: boolean;
  readonly toSalaryGradeId?: string | null;
  readonly toSalaryStepId?: string | null;
  readonly toSalaryType?: 'GROSS' | 'NET' | null;
  readonly toBaseSalary?: number | null;
}

/** Trả về các lỗi nghiệp vụ theo thứ tự hiển thị; rỗng là hợp lệ. */
export function decisionShapeErrors(input: DecisionShape): string[] {
  const errors: string[] = [];
  const type = input.decisionType;
  if (isAssigningType(type) && !input.toPositionNodeId)
    errors.push('Cần chọn chức danh được bổ nhiệm.');
  if (!isAssigningType(type) && input.toPositionNodeId)
    errors.push('Loại quyết định này không đổi chức danh.');
  if (type === 'CHANGE_MANAGER' && input.managerMode === 'KEEP')
    errors.push('Quyết định đổi người quản lý phải chọn người quản lý mới hoặc bỏ người quản lý.');
  if (type === 'CHANGE_MANAGER' && input.salaryChanged)
    errors.push('Quyết định đổi người quản lý không thay đổi lương.');
  if (input.managerMode === 'SET') {
    if (!input.toManagerEmployeeId) errors.push('Cần chọn người quản lý trực tiếp mới.');
    else if (input.toManagerEmployeeId === input.employeeId)
      errors.push('Nhân viên không thể là người quản lý của chính mình.');
  }
  if (input.managerMode !== 'SET' && input.toManagerEmployeeId)
    errors.push('Chỉ chọn người quản lý khi chế độ là gán người quản lý mới.');
  if (input.subordinateMode === 'REASSIGN') {
    if (!input.subordinateTargetEmployeeId)
      errors.push('Cần chọn người nhận cấp dưới.');
    else if (input.subordinateTargetEmployeeId === input.employeeId)
      errors.push('Người nhận cấp dưới phải khác nhân viên trong quyết định.');
  }
  if (input.subordinateMode !== 'REASSIGN' && input.subordinateTargetEmployeeId)
    errors.push('Chỉ chọn người nhận cấp dưới khi chuyển cấp dưới.');
  if (input.salaryChanged) {
    const salary = input.toBaseSalary;
    if (salary === null || salary === undefined || !Number.isFinite(salary) || salary < 0 || salary > 1e12)
      errors.push('Mức lương mới không hợp lệ.');
    if (input.toSalaryType !== 'GROSS' && input.toSalaryType !== 'NET')
      errors.push('Cần chọn loại lương (GROSS hoặc NET).');
    if (input.toSalaryStepId && !input.toSalaryGradeId)
      errors.push('Chọn bậc lương thì phải chọn ngạch lương.');
  } else if (
    input.toSalaryGradeId ||
    input.toSalaryStepId ||
    input.toBaseSalary !== null && input.toBaseSalary !== undefined
  ) {
    errors.push('Cần bật "Thay đổi lương" để nhập thông tin lương mới.');
  }
  return errors;
}

/**
 * Gán `employeeId` báo cáo cho `newManagerId` có tạo vòng không?
 * `managerOf` là quan hệ quản lý đang hiệu lực (nhân viên → người quản lý).
 * Đi ngược chuỗi từ người quản lý mới; gặp lại `employeeId` là vòng lặp.
 */
export function wouldCreateCycle(
  managerOf: ReadonlyMap<string, string | null | undefined>,
  employeeId: string,
  newManagerId: string,
  maxDepth = 100,
): boolean {
  if (employeeId === newManagerId) return true;
  const seen = new Set<string>([newManagerId]);
  let cursor = managerOf.get(newManagerId);
  let depth = 0;
  while (cursor && depth++ < maxDepth) {
    if (cursor === employeeId) return true;
    if (seen.has(cursor)) return false; // vòng sẵn có không liên quan tới nhân viên này
    seen.add(cursor);
    cursor = managerOf.get(cursor);
  }
  return false;
}

/** Số quyết định kế tiếp theo năm, ví dụ QDNS-2026-0007. */
export function nextDecisionNumber(
  year: number,
  existing: readonly string[],
): string {
  const prefix = `QDNS-${year}-`;
  let max = 0;
  for (const value of existing) {
    if (!value.startsWith(prefix)) continue;
    const n = Number(value.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Trừ một ngày khỏi chuỗi YYYY-MM-DD (UTC, không lệch múi giờ). */
export function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
