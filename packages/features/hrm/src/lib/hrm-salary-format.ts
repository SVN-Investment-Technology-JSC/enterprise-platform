/** Định dạng tiền VND; giá trị rỗng hoặc không hợp lệ hiển thị "----" (không bao giờ ném lỗi). */
export function formatMoneyVnd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '----';
  const n = Number(value);
  if (!Number.isFinite(n)) return '----';
  return `${n.toLocaleString('vi-VN')} đ`;
}

export const SALARY_TYPE_LABELS: Record<string, string> = {
  GROSS: 'Gross (trước thuế)',
  NET: 'Net (thực nhận)',
};

export const SALARY_PROFILE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Đang hiệu lực',
  SUPERSEDED: 'Đã thay thế',
  CANCELLED: 'Đã hủy',
};

export interface SalaryProfileForm {
  salaryGradeId: string;
  salaryStepId: string;
  salaryType: string;
  baseSalary: string;
  effectiveFrom: string;
  changeReason: string;
}

export interface SalaryProfilePayload {
  salaryGradeId: string | null;
  salaryStepId: string | null;
  salaryType: 'GROSS' | 'NET';
  baseSalary: number;
  currency: 'VND';
  effectiveFrom: string;
  changeReason: string;
}

/** Kiểm tra form hồ sơ lương và dựng body gửi POST /employees/:id/salary-profiles. */
export function buildSalaryProfilePayload(
  form: SalaryProfileForm,
): { ok: true; body: SalaryProfilePayload } | { ok: false; error: string } {
  if (form.baseSalary.trim() === '')
    return { ok: false, error: 'Nhập mức lương tháng.' };
  const base = Number(form.baseSalary);
  if (!Number.isFinite(base) || base < 0 || base > 1e12)
    return { ok: false, error: 'Mức lương không hợp lệ.' };
  if (!form.effectiveFrom)
    return { ok: false, error: 'Chọn ngày hiệu lực.' };
  if (form.changeReason.trim().length < 2)
    return { ok: false, error: 'Nhập căn cứ thay đổi (tối thiểu 2 ký tự).' };
  if (form.salaryStepId && !form.salaryGradeId)
    return { ok: false, error: 'Chọn ngạch trước khi chọn bậc.' };
  return {
    ok: true,
    body: {
      salaryGradeId: form.salaryGradeId || null,
      salaryStepId: form.salaryStepId || null,
      salaryType: form.salaryType === 'NET' ? 'NET' : 'GROSS',
      baseSalary: base,
      currency: 'VND',
      effectiveFrom: form.effectiveFrom,
      changeReason: form.changeReason.trim(),
    },
  };
}
