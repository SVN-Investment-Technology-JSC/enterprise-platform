import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import * as XLSX from 'xlsx';

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

const dmy = (value: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/**
 * Xuất danh sách nhân sự ra tệp Excel (.xlsx): mỗi nhân viên một dòng, mỗi thông tin một cột có tiêu đề và độ rộng riêng
 * (CSV dễ bị Excel dồn vào một cột khi máy dùng dấu phân cách khác dấu phẩy). Cột và nhãn trạng thái dùng chung với bảng.
 */
export function downloadEmployeesXlsx(
  rows: readonly HrmEmployeeProfile[],
  statusLabels: Record<string, string>,
  fileName: string,
): void {
  const header = ['STT', ...EMPLOYEE_CSV_HEADERS];
  const body = rows.map((emp, index) => [
    index + 1,
    emp.employeeCode ?? '',
    emp.fullName ?? '',
    emp.email || emp.personalEmail || '',
    emp.position ?? '',
    emp.department ?? '',
    dmy(emp.joinDate),
    statusLabels[emp.employmentStatus] ?? emp.employmentStatus ?? '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const all = [header, ...body];
  ws['!cols'] = header.map((_, col) => ({
    wch: Math.min(
      45,
      Math.max(...all.map((row) => String(row[col] ?? '').length), 6) + 2,
    ),
  }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sach nhan vien');
  XLSX.writeFile(wb, fileName);
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

// ---------------------------------------------------------------------------
// Danh sách nhân sự: số liệu tổng quan, lọc theo đơn vị / chức danh, phân trang
// ---------------------------------------------------------------------------

/** Nhân viên còn hoạt động: mọi trạng thái trừ đã nghỉ việc và chấm dứt hợp đồng. */
export const isActiveEmployee = (emp: Pick<HrmEmployeeProfile, 'employmentStatus'>): boolean =>
  !['RESIGNED', 'TERMINATED'].includes(emp.employmentStatus);

export interface EmployeeStats {
  readonly total: number;
  readonly active: number;
  readonly inactive: number;
  /** Hồ sơ chưa hoàn thiện (mức hoàn thiện dưới 100%). */
  readonly incomplete: number;
  /** Số người vào làm trong tháng của `now`. */
  readonly joinedThisMonth: number;
  /** Tỷ lệ (làm tròn 1 số lẻ, đơn vị %) trên tổng số nhân viên. */
  readonly activePercent: number;
  readonly inactivePercent: number;
  readonly incompletePercent: number;
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

/** Số liệu tổng quan của danh sách nhân sự (đếm trên mọi hồ sơ đã tải, không phụ thuộc bộ lọc đang chọn). */
export function employeeStats(
  rows: readonly HrmEmployeeProfile[],
  includeSensitive: boolean,
  now: Date = new Date(),
): EmployeeStats {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const total = rows.length;
  const active = rows.filter(isActiveEmployee).length;
  const incomplete = rows.filter((e) => employeeCompleteness(e, includeSensitive) < 100).length;
  return {
    total,
    active,
    inactive: total - active,
    incomplete,
    joinedThisMonth: rows.filter((e) => String(e.joinDate ?? '').startsWith(month)).length,
    activePercent: pct(active, total),
    inactivePercent: pct(total - active, total),
    incompletePercent: pct(incomplete, total),
  };
}

/** Các giá trị khác nhau của một trường (đơn vị, chức danh), sắp theo tên, bỏ trống. */
export function distinctValues(
  rows: readonly HrmEmployeeProfile[],
  pick: (emp: HrmEmployeeProfile) => string | null | undefined,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const value = (pick(row) ?? '').trim();
    if (value) set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
}

/** Chữ cái đầu của hai từ cuối của họ tên (ảnh đại diện); thiếu tên thì lấy từ mã nhân viên. */
export function employeeInitials(emp: Pick<HrmEmployeeProfile, 'fullName' | 'employeeCode'>): string {
  const source = (emp.fullName ?? '').trim() || emp.employeeCode || '';
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'NV'
  );
}

/** Dải số trang hiển thị: luôn có trang đầu, trang cuối và các trang quanh trang hiện tại; chỗ cách quãng là null (dấu "…"). */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => wanted.add(p));
  if (page >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((p) => wanted.add(p));
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}
