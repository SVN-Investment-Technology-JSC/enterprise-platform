import type {
  CreateHrmPersonnelDecisionPayload,
  HrmManagerMode,
  HrmPersonnelDecision,
  HrmPersonnelDecisionStatus,
  HrmPersonnelDecisionType,
  HrmSubordinateMode,
} from '@enterprise-platform/contracts-hrm';

export const DECISION_TYPE_LABELS: Record<HrmPersonnelDecisionType, string> = {
  APPOINT: 'Bổ nhiệm',
  PROMOTE: 'Thăng chức',
  TRANSFER: 'Điều chuyển',
  CONCURRENT: 'Kiêm nhiệm',
  DISMISS: 'Miễn nhiệm',
  CHANGE_MANAGER: 'Đổi quản lý trực tiếp',
};

export const DECISION_STATUS_LABELS: Record<
  HrmPersonnelDecisionStatus,
  string
> = {
  DRAFT: 'Nháp',
  APPROVED: 'Đã duyệt',
  APPLY_PENDING: 'Chờ áp dụng',
  APPLIED: 'Đã áp dụng',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const DECISION_STATUS_TONES: Record<
  HrmPersonnelDecisionStatus,
  string
> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPLY_PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPLIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const APPLY_STEP_LABELS: Record<string, string> = {
  core: 'Chức danh (Core)',
  manager: 'Quản lý trực tiếp',
  subordinates: 'Cấp dưới',
  salary: 'Lương',
};

export const DECISION_TYPES = Object.keys(
  DECISION_TYPE_LABELS,
) as HrmPersonnelDecisionType[];
export const DECISION_STATUSES = Object.keys(
  DECISION_STATUS_LABELS,
) as HrmPersonnelDecisionStatus[];

const POSITION_TYPES: readonly HrmPersonnelDecisionType[] = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
];
const IMPACT_TYPES: readonly HrmPersonnelDecisionType[] = [
  'TRANSFER',
  'PROMOTE',
  'APPOINT',
  'DISMISS',
  'CHANGE_MANAGER',
];

/** Loại quyết định có đổi chức danh (cần chức danh mới và tài khoản liên kết). */
export function isPositionChanging(type: HrmPersonnelDecisionType): boolean {
  return POSITION_TYPES.includes(type);
}

export function showsTargetPosition(type: HrmPersonnelDecisionType): boolean {
  return isPositionChanging(type);
}

/** Bảng tác động chỉ hiện khi nhân viên đang là quản lý của ai đó. */
export function showsImpactTable(
  type: HrmPersonnelDecisionType,
  subordinateCount: number,
): boolean {
  return IMPACT_TYPES.includes(type) && subordinateCount > 0;
}

export function defaultManagerMode(
  type: HrmPersonnelDecisionType,
): HrmManagerMode {
  return type === 'CHANGE_MANAGER' ? 'SET' : 'KEEP';
}

export interface DecisionFormState {
  decisionType: HrmPersonnelDecisionType;
  employeeId: string;
  effectiveDate: string;
  reason: string;
  toPositionNodeId: string;
  managerMode: HrmManagerMode;
  toManagerEmployeeId: string;
  subordinateMode: HrmSubordinateMode;
  subordinateTargetEmployeeId: string;
  salaryChanged: boolean;
  toSalaryGradeId: string;
  toSalaryStepId: string;
  toSalaryType: 'GROSS' | 'NET';
  toBaseSalary: string;
}

export function emptyDecisionForm(employeeId = ''): DecisionFormState {
  return {
    decisionType: 'TRANSFER',
    employeeId,
    effectiveDate: '',
    reason: '',
    toPositionNodeId: '',
    managerMode: 'KEEP',
    toManagerEmployeeId: '',
    subordinateMode: 'KEEP',
    subordinateTargetEmployeeId: '',
    salaryChanged: false,
    toSalaryGradeId: '',
    toSalaryStepId: '',
    toSalaryType: 'GROSS',
    toBaseSalary: '',
  };
}

export function decisionToForm(d: HrmPersonnelDecision): DecisionFormState {
  return {
    decisionType: d.decisionType,
    employeeId: d.employeeId,
    effectiveDate: d.effectiveDate.slice(0, 10),
    reason: d.reason,
    toPositionNodeId: d.toPositionNodeId ?? '',
    managerMode: d.managerMode,
    toManagerEmployeeId: d.toManagerEmployeeId ?? '',
    subordinateMode: d.subordinateMode,
    subordinateTargetEmployeeId: d.subordinateTargetEmployeeId ?? '',
    salaryChanged: d.salaryChanged,
    toSalaryGradeId: d.toSalaryGradeId ?? '',
    toSalaryStepId: d.toSalaryStepId ?? '',
    toSalaryType: d.toSalaryType ?? 'GROSS',
    toBaseSalary: d.toBaseSalary != null ? String(d.toBaseSalary) : '',
  };
}

export interface DecisionValidationContext {
  hasAccount?: boolean;
  subordinateCount?: number;
}

/** Trả về danh sách lỗi (rỗng nếu hợp lệ). */
export function validateDecisionForm(
  form: DecisionFormState,
  ctx: DecisionValidationContext = {},
): string[] {
  const errors: string[] = [];
  if (!form.employeeId) errors.push('Chọn nhân viên.');
  if (!form.effectiveDate) errors.push('Nhập ngày hiệu lực.');
  if (!form.reason.trim()) errors.push('Nhập lý do / căn cứ.');
  if (showsTargetPosition(form.decisionType) && !form.toPositionNodeId) {
    errors.push('Chọn chức danh mới.');
  }
  if (isPositionChanging(form.decisionType) && ctx.hasAccount === false) {
    errors.push(
      'Nhân viên chưa liên kết tài khoản, không thể bổ nhiệm vào chức danh ở Core.',
    );
  }
  if (form.decisionType === 'CHANGE_MANAGER' && form.managerMode === 'KEEP') {
    errors.push('Chọn gán hoặc bỏ quản lý trực tiếp.');
  }
  if (form.managerMode === 'SET') {
    if (!form.toManagerEmployeeId) errors.push('Chọn quản lý trực tiếp mới.');
    else if (form.toManagerEmployeeId === form.employeeId)
      errors.push('Nhân viên không thể tự quản lý chính mình.');
  }
  if (
    showsImpactTable(form.decisionType, ctx.subordinateCount ?? 0) &&
    form.subordinateMode === 'REASSIGN'
  ) {
    if (!form.subordinateTargetEmployeeId)
      errors.push('Chọn người nhận cấp dưới.');
    else if (form.subordinateTargetEmployeeId === form.employeeId)
      errors.push('Người nhận cấp dưới phải khác nhân viên đang xử lý.');
  }
  if (form.salaryChanged) {
    if (!form.toSalaryGradeId) errors.push('Chọn ngạch lương.');
    if (!form.toSalaryStepId) errors.push('Chọn bậc lương.');
    if (!form.toSalaryType) errors.push('Chọn loại lương.');
    const base = Number(form.toBaseSalary);
    if (!form.toBaseSalary || !Number.isFinite(base) || base <= 0)
      errors.push('Nhập lương cơ bản hợp lệ.');
  }
  return errors;
}

export function buildDecisionPayload(
  form: DecisionFormState,
  ctx: DecisionValidationContext = {},
): CreateHrmPersonnelDecisionPayload {
  const impact = showsImpactTable(form.decisionType, ctx.subordinateCount ?? 0);
  const reassign = impact && form.subordinateMode === 'REASSIGN';
  return {
    decisionType: form.decisionType,
    employeeId: form.employeeId,
    effectiveDate: form.effectiveDate,
    reason: form.reason.trim(),
    toPositionNodeId: showsTargetPosition(form.decisionType)
      ? form.toPositionNodeId || null
      : null,
    managerMode: form.managerMode,
    toManagerEmployeeId:
      form.managerMode === 'SET' ? form.toManagerEmployeeId : null,
    subordinateMode: reassign ? 'REASSIGN' : 'KEEP',
    subordinateTargetEmployeeId: reassign
      ? form.subordinateTargetEmployeeId
      : null,
    salaryChanged: form.salaryChanged,
    toSalaryGradeId: form.salaryChanged ? form.toSalaryGradeId : null,
    toSalaryStepId: form.salaryChanged ? form.toSalaryStepId : null,
    toSalaryType: form.salaryChanged ? form.toSalaryType : null,
    toBaseSalary: form.salaryChanged ? Number(form.toBaseSalary) : null,
  };
}

export interface DecisionRowActions {
  edit: boolean;
  cancel: boolean;
  approve: boolean;
  reject: boolean;
  retry: boolean;
}

export function decisionRowActions(
  status: HrmPersonnelDecisionStatus,
  perms: { manage: boolean; approve: boolean },
): DecisionRowActions {
  const draft = status === 'DRAFT';
  return {
    edit: draft && perms.manage,
    cancel: draft && perms.manage,
    approve: draft && perms.approve,
    reject: draft && perms.approve,
    retry: status === 'APPLY_PENDING' && perms.approve,
  };
}

export function formatMoney(v?: number | null): string {
  return v == null ? '----' : `${Number(v).toLocaleString('vi-VN')} đ`;
}

export function formatDateVn(v?: string | null): string {
  if (!v) return '----';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Tóm tắt "từ → đến" cho bảng danh sách. */
export function decisionSummary(d: HrmPersonnelDecision): string {
  const parts: string[] = [];
  if (isPositionChanging(d.decisionType) || d.toPositionName) {
    parts.push(
      `${d.fromPositionName ?? '----'} → ${d.toPositionName ?? '----'}`,
    );
  }
  if (d.managerMode !== 'KEEP') {
    parts.push(
      `QL: ${d.fromManagerName ?? '----'} → ${
        d.managerMode === 'CLEAR' ? 'Không có' : (d.toManagerName ?? '----')
      }`,
    );
  }
  if (d.salaryChanged) {
    parts.push(
      `Lương: ${formatMoney(d.fromBaseSalary)} → ${formatMoney(d.toBaseSalary)}`,
    );
  }
  return parts.join(' | ') || '----';
}
