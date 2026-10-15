/**
 * Gom các thao tác của một nhóm quyền thành bảng "đối tượng × mức quyền" chỉ bằng cách đọc khóa thao tác
 * (`hrm.leave.approve.all` = đối tượng `leave`, mức "duyệt toàn tenant"). Thao tác không khớp mẫu nào vào cột "Khác"
 * nên không bao giờ bị mất; thêm thao tác mới theo mẫu cũ là tự vào đúng ô.
 */

export type MatrixLevel = 'read' | 'manage' | 'approve' | 'approveAll' | 'other';

export const MATRIX_COLUMNS: readonly { level: MatrixLevel; title: string; hint: string }[] = [
  { level: 'read', title: 'Chỉ xem', hint: 'Xem dữ liệu, không sửa' },
  { level: 'manage', title: 'Quản lý', hint: 'Tạo, sửa, xóa' },
  { level: 'approve', title: 'Duyệt trong phạm vi', hint: 'Chỉ đơn của người mình phụ trách' },
  { level: 'approveAll', title: 'Duyệt toàn tenant', hint: 'Đơn của mọi người' },
  { level: 'other', title: 'Thao tác riêng', hint: 'Không thuộc 4 mức trên' },
];

/** Tên hiển thị của đối tượng; đối tượng mới chưa có tên thì hiện đúng khóa (xem `objectTitle`). */
const OBJECT_TITLES: Readonly<Record<string, string>> = {
  self: 'Cá nhân',
  employee: 'Hồ sơ nhân viên',
  appointment: 'Bổ nhiệm',
  dashboard: 'Báo cáo tổng quan',
  shift: 'Ca làm',
  schedule: 'Lịch làm việc',
  attendance: 'Chấm công',
  time: 'Cấu hình thời gian',
  device: 'Thiết bị chấm công',
  leave: 'Nghỉ phép',
  request: 'Đơn từ chung',
  ot: 'Tăng ca',
  trip: 'Công tác',
  custom: 'Đơn tùy chỉnh',
  profile: 'Hồ sơ cá nhân',
  advance: 'Tạm ứng',
  timesheet: 'Bảng công',
  salary: 'Lương cơ bản',
  dependent: 'Người phụ thuộc',
  payroll: 'Bảng lương',
  automation: 'Tự động hóa',
  integration: 'Tích hợp',
  audit: 'Nhật ký kiểm toán',
  transaction: 'Giao dịch kho',
};

export function objectTitle(object: string): string {
  if (object === '') return 'Chung';
  return OBJECT_TITLES[object] ?? object;
}

export interface MatrixItem {
  readonly key: string;
  readonly label: string;
}

export interface MatrixRow {
  readonly object: string;
  readonly title: string;
  readonly cells: Readonly<Record<MatrixLevel, readonly MatrixItem[]>>;
}

export interface ActionMatrix {
  /** Chỉ các cột có ít nhất một thao tác. */
  readonly columns: readonly (typeof MATRIX_COLUMNS)[number][];
  readonly rows: readonly MatrixRow[];
}

const SUFFIXES: readonly [string, MatrixLevel][] = [
  ['.approve.all', 'approveAll'],
  ['.approve', 'approve'],
  ['.read', 'read'],
  ['.manage', 'manage'],
];

/** Tách khóa thành đối tượng và mức quyền, bỏ tiền tố module (đoạn đầu của khóa). */
export function classifyAction(key: string): { object: string; level: MatrixLevel } {
  const dot = key.indexOf('.');
  const rest = dot >= 0 ? key.slice(dot + 1) : key;
  if (rest === 'read' || rest === 'manage') return { object: '', level: rest };
  for (const [suffix, level] of SUFFIXES)
    if (rest.endsWith(suffix)) return { object: rest.slice(0, -suffix.length), level };
  const first = rest.split('.')[0];
  return { object: rest.includes('.') ? first : rest, level: 'other' };
}

export function buildActionMatrix(items: readonly MatrixItem[]): ActionMatrix {
  const rows = new Map<string, Record<MatrixLevel, MatrixItem[]>>();
  for (const item of items) {
    const { object, level } = classifyAction(item.key);
    let row = rows.get(object);
    if (!row) {
      row = { read: [], manage: [], approve: [], approveAll: [], other: [] };
      rows.set(object, row);
    }
    row[level].push(item);
  }
  return {
    columns: MATRIX_COLUMNS.filter(({ level }) => [...rows.values()].some((row) => row[level].length > 0)),
    rows: [...rows.entries()].map(([object, cells]) => ({ object, title: objectTitle(object), cells })),
  };
}
