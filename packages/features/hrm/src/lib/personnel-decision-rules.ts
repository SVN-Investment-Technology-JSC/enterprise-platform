import type {
  CreateHrmPersonnelDecisionPayload,
  HrmPersonnelDecision,
  HrmPersonnelDecisionStatus,
  HrmPersonnelDecisionType,
} from '@enterprise-platform/contracts-hrm';

/** Nhãn đủ mọi loại, kể cả `CHANGE_MANAGER` của dữ liệu cũ (không còn chọn được khi tạo mới). */
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
  RECORDED: 'Đã ghi nhận',
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
  RECORDED: 'bg-teal-50 text-teal-700 border-teal-200',
};

/**
 * Các bước áp dụng của một quyết định. Quyết định không còn gán quản lý hay chuyển cấp dưới; hai bước đó chỉ hiện
 * với quyết định cũ còn mang chúng.
 */
export function applyStepLabels(
  d: Pick<HrmPersonnelDecision, 'managerMode' | 'subordinateMode'>,
): [string, string][] {
  const steps: [string, string][] = [['core', 'Chức danh (Core)']];
  if (d.managerMode !== 'KEEP') steps.push(['manager', 'Quản lý trực tiếp (cũ)']);
  if (d.subordinateMode === 'REASSIGN') steps.push(['subordinates', 'Cấp dưới (cũ)']);
  steps.push(['salary', 'Lương']);
  return steps;
}

/** Loại quyết định chọn được khi tạo mới. */
export const DECISION_TYPES: HrmPersonnelDecisionType[] = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
  'DISMISS',
];
export const DECISION_STATUSES = Object.keys(
  DECISION_STATUS_LABELS,
) as HrmPersonnelDecisionStatus[];

const POSITION_TYPES: readonly HrmPersonnelDecisionType[] = [
  'APPOINT',
  'PROMOTE',
  'TRANSFER',
  'CONCURRENT',
];
/** Loại quyết định có đổi chức danh (cần chức danh mới và tài khoản liên kết). */
export function isPositionChanging(type: HrmPersonnelDecisionType): boolean {
  return POSITION_TYPES.includes(type);
}

export function showsTargetPosition(type: HrmPersonnelDecisionType): boolean {
  return isPositionChanging(type);
}

export interface DecisionFormState {
  decisionType: HrmPersonnelDecisionType;
  employeeId: string;
  effectiveDate: string;
  reason: string;
  toPositionNodeId: string;
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
    salaryChanged: d.salaryChanged,
    toSalaryGradeId: d.toSalaryGradeId ?? '',
    toSalaryStepId: d.toSalaryStepId ?? '',
    toSalaryType: d.toSalaryType ?? 'GROSS',
    toBaseSalary: d.toBaseSalary != null ? String(d.toBaseSalary) : '',
  };
}

export interface DecisionValidationContext {
  hasAccount?: boolean;
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
): CreateHrmPersonnelDecisionPayload {
  return {
    decisionType: form.decisionType,
    employeeId: form.employeeId,
    effectiveDate: form.effectiveDate,
    reason: form.reason.trim(),
    toPositionNodeId: showsTargetPosition(form.decisionType)
      ? form.toPositionNodeId || null
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
  const editable = draft || status === 'RECORDED';
  return {
    edit: editable && perms.manage,
    cancel: editable && perms.manage,
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

// ---------------------------------------------------------------------------
// Nhóm quyết định theo phòng ban
// ---------------------------------------------------------------------------

export const NO_UNIT_LABEL = 'Chưa xác định đơn vị';

/** Đơn vị của một quyết định: đơn vị sau khi áp dụng, không có thì đơn vị trước đó. */
export function decisionUnitOf(d: Pick<HrmPersonnelDecision, 'toUnitName' | 'fromUnitName'>): string {
  return (d.toUnitName ?? '').trim() || (d.fromUnitName ?? '').trim() || NO_UNIT_LABEL;
}

/** Quyết định còn dở dang: nháp, đã duyệt chưa áp dụng, đang chờ áp dụng. */
export const isOpenDecision = (status: HrmPersonnelDecisionStatus): boolean =>
  status === 'DRAFT' || status === 'APPROVED' || status === 'APPLY_PENDING';

export interface DecisionUnitGroup {
  readonly unit: string;
  readonly rows: readonly HrmPersonnelDecision[];
  readonly open: number;
  readonly applied: number;
}

/**
 * Nhóm quyết định theo đơn vị (phòng ban): các nhóm sắp theo tên tiếng Việt, nhóm "Chưa xác định" ở cuối;
 * trong nhóm, quyết định mới (ngày hiệu lực lớn hơn) lên trước.
 */
export function groupDecisionsByUnit(rows: readonly HrmPersonnelDecision[]): DecisionUnitGroup[] {
  const map = new Map<string, HrmPersonnelDecision[]>();
  for (const row of rows) {
    const unit = decisionUnitOf(row);
    const list = map.get(unit);
    if (list) list.push(row);
    else map.set(unit, [row]);
  }
  return [...map.entries()]
    .sort(([a], [b]) =>
      a === NO_UNIT_LABEL ? 1 : b === NO_UNIT_LABEL ? -1 : a.localeCompare(b, 'vi'),
    )
    .map(([unit, list]) => {
      const sorted = [...list].sort(
        (x, y) => y.effectiveDate.localeCompare(x.effectiveDate) || y.decisionNo.localeCompare(x.decisionNo),
      );
      return {
        unit,
        rows: sorted,
        open: sorted.filter((d) => isOpenDecision(d.status)).length,
        applied: sorted.filter((d) => d.status === 'APPLIED').length,
      };
    });
}

export interface DecisionStats {
  readonly total: number;
  readonly open: number;
  readonly applied: number;
  readonly closed: number;
  readonly units: number;
}

/** Số liệu tổng quan: tổng, đang xử lý, đã áp dụng, đã từ chối hoặc hủy, số đơn vị có quyết định. */
export function decisionStats(rows: readonly HrmPersonnelDecision[]): DecisionStats {
  return {
    total: rows.length,
    open: rows.filter((d) => isOpenDecision(d.status)).length,
    applied: rows.filter((d) => d.status === 'APPLIED').length,
    closed: rows.filter((d) => d.status === 'REJECTED' || d.status === 'CANCELLED').length,
    units: new Set(rows.map(decisionUnitOf)).size,
  };
}
