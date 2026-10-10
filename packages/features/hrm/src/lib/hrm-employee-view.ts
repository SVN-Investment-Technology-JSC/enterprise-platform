import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';

/** Nhãn hiển thị khi API ẩn trường nhạy cảm (CCCD, MST, BHXH, tài khoản ngân hàng). */
export const SENSITIVE_HIDDEN_LABEL = 'Ẩn';
export const SENSITIVE_HINT = 'Bạn không có quyền xem thông tin nhạy cảm';

export interface SensitiveDisplay {
  text: string;
  /** true khi giá trị bị ẩn do thiếu quyền (hiển thị kèm gợi ý). */
  hidden: boolean;
  title?: string;
}

/**
 * Giá trị nhạy cảm có thể là null khi người xem thiếu quyền hrm.employee.sensitive.
 * - Có giá trị: hiển thị nguyên.
 * - Null và không có quyền: "Ẩn" kèm gợi ý.
 * - Null và có quyền: nhãn trống (chưa nhập).
 */
export function sensitiveDisplay(
  value: string | null | undefined,
  canSeeSensitive: boolean,
  emptyLabel = 'Chưa cập nhật',
): SensitiveDisplay {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text) return { text, hidden: false };
  if (!canSeeSensitive)
    return { text: SENSITIVE_HIDDEN_LABEL, hidden: true, title: SENSITIVE_HINT };
  return { text: emptyLabel, hidden: false };
}

/**
 * Mức hoàn thiện hồ sơ (0-100). Người không có quyền nhạy cảm không thấy CCCD, MST, tài khoản
 * nên chỉ tính trên các trường họ nhìn thấy, tránh điểm thấp giả.
 */
export function employeeCompleteness(
  emp: HrmEmployeeProfile,
  includeSensitive: boolean,
): number {
  const checks: [boolean, number][] = includeSensitive
    ? [
        [!!emp.fullName, 20],
        [!!emp.phone, 15],
        [!!emp.identityCardNumber, 20],
        [!!emp.taxCode, 15],
        [!!emp.bankAccountNumber, 15],
        [!!emp.emergencyContactName, 15],
      ]
    : [
        [!!emp.fullName, 25],
        [!!emp.phone, 20],
        [!!emp.dateOfBirth, 15],
        [!!(emp.email || emp.personalEmail), 15],
        [!!(emp.currentAddress || emp.permanentAddress), 10],
        [!!emp.emergencyContactName, 15],
      ];
  return checks.reduce((sum, [ok, score]) => sum + (ok ? score : 0), 0);
}

/** Bỏ dấu và hạ chữ thường để tìm kiếm tiếng Việt không dấu. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

/** Các cột xuất CSV: chỉ cột đang hiển thị trên bảng và không nhạy cảm. */
export const EMPLOYEE_CSV_HEADERS = [
  'Mã nhân viên',
  'Họ và tên',
  'Email',
  'Chức danh',
  'Phòng ban',
  'Ngày vào',
  'Trạng thái',
] as const;

/** Ô bắt đầu bằng ký tự công thức được thêm dấu nháy để Excel không thực thi. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildEmployeesCsv(
  rows: readonly HrmEmployeeProfile[],
  statusLabels: Record<string, string> = {},
): string {
  const lines = [
    EMPLOYEE_CSV_HEADERS.map(csvCell).join(','),
    ...rows.map((emp) =>
      [
        emp.employeeCode,
        emp.fullName,
        emp.email || emp.personalEmail,
        emp.position,
        emp.department,
        emp.joinDate ? String(emp.joinDate).slice(0, 10) : '',
        statusLabels[emp.employmentStatus] ?? emp.employmentStatus,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return lines.join('\r\n');
}

/** Tải tệp CSV ở phía trình duyệt (UTF-8 có BOM để Excel đọc đúng tiếng Việt). */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
