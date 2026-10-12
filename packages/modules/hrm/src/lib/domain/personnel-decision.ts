/**
 * Quy tắc thuần của quyết định nhân sự. Không đọc DB: service nạp dữ liệu rồi gọi
 * các hàm này, nên kiểm thử được không cần Postgres.
 *
 * Quyết định không gán quản lý trực tiếp: quản lý lấy từ "Báo cáo cho" của chức danh
 * trên Core, không có thì Tổng giám đốc.
 */

export const DECISION_TYPES = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
  'DISMISS',
] as const;
/**
 * Loại `CHANGE_MANAGER` không còn được tạo mới; chỉ còn trong dữ liệu cũ (bảng vẫn cho phép giá trị này)
 * nên các hàm đọc/áp dụng vẫn nhận ra nó.
 */
export const LEGACY_DECISION_TYPES = ['CHANGE_MANAGER'] as const;
export type DecisionType =
  | (typeof DECISION_TYPES)[number]
  | (typeof LEGACY_DECISION_TYPES)[number];

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
