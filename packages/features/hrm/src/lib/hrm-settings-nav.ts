/**
 * Trung tâm cấu hình HRM: các mục cấu hình gom theo chức năng. Mỗi mục trỏ tới một tab của trang gộp `/settings`
 * (`view` là id trong `HRM_HUBS['/settings']`, `tab` là tab con của màn hình đó nếu có). Quyền xem mục lấy từ chính tab
 * của trang gộp, riêng nhóm thiết bị chấm công cần thêm quyền thiết bị.
 */
import type { HrmAction } from '@enterprise-platform/contracts-identity';

export type SettingsIcon =
  | 'leave'
  | 'reason'
  | 'rules'
  | 'calendar'
  | 'gps'
  | 'device'
  | 'schedule'
  | 'shift'
  | 'request'
  | 'approval'
  | 'payroll'
  | 'integration'
  | 'permission';

export interface SettingsEntry {
  /** Duy nhất trong toàn bộ mục cấu hình. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: SettingsIcon;
  /** Id tab của `HRM_HUBS['/settings']`. */
  readonly view: string;
  /** Tab con của màn hình (nếu có), đặt vào `?tab=`. */
  readonly tab?: string;
  /** Quyền thêm so với quyền của tab trang gộp (có BẤT KỲ quyền nào là thấy). */
  readonly permissions?: readonly HrmAction[];
}

export interface SettingsGroup {
  readonly id: string;
  /** Nhãn nhóm ở thanh bên (viết hoa khi hiển thị). */
  readonly navLabel: string;
  /** Tên thẻ ở trang tổng quan. */
  readonly title: string;
  readonly description: string;
  readonly icon: SettingsIcon;
  readonly entries: readonly SettingsEntry[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'leave',
    navLabel: 'Nghỉ phép',
    title: 'Nghỉ phép',
    description: 'Cách tính phép năm, phép thâm niên, ứng phép và các tác vụ định kỳ.',
    icon: 'leave',
    entries: [
      {
        id: 'leave-policy',
        label: 'Chính sách phép năm',
        description: 'Thiết lập nguyên tắc tính phép, thâm niên, ứng phép',
        icon: 'leave',
        view: 'leave',
      },
    ],
  },
  {
    id: 'time',
    navLabel: 'Chấm công',
    title: 'Chấm công & thiết bị',
    description: 'GPS, IP, thiết bị, quy tắc vào/ra và lịch ngày làm / OFF / lễ.',
    icon: 'rules',
    entries: [
      {
        id: 'time-rules',
        label: 'Quy định chấm công',
        description: 'Thiết lập quy tắc chấm công, điều kiện hợp lệ',
        icon: 'rules',
        view: 'time',
        tab: 'rules',
        permissions: ['hrm.time.configure'],
      },
      {
        id: 'time-calendar',
        label: 'Lịch làm / OFF / Lễ',
        description: 'Quản lý lịch làm việc, ngày nghỉ, ngày lễ',
        icon: 'calendar',
        view: 'time',
        tab: 'calendar',
        permissions: ['hrm.time.configure'],
      },
      {
        id: 'time-sites',
        label: 'Địa điểm GPS',
        description: 'Quản lý địa điểm làm việc theo GPS',
        icon: 'gps',
        view: 'time',
        tab: 'sites',
        permissions: ['hrm.time.configure'],
      },
      {
        id: 'time-devices',
        label: 'Thiết bị',
        description: 'Quản lý thiết bị chấm công, máy chấm, app',
        icon: 'device',
        view: 'time',
        tab: 'devices',
        permissions: ['hrm.device.manage'],
      },
      {
        id: 'auto-attendance',
        label: 'Chấm công tự động',
        description: 'Bật hoặc tắt tự sinh giờ vào/ra theo ca cho từng thứ trong tuần, không cần phân ca lại',
        icon: 'rules',
        view: 'auto-attendance',
        permissions: ['hrm.time.configure'],
      },
    ],
  },
  {
    id: 'schedule',
    navLabel: 'Lịch làm việc',
    title: 'Lịch làm việc',
    description: 'Gán ca theo nhân viên, lịch tuần/tháng, mẫu ca và lịch định kỳ.',
    icon: 'schedule',
    entries: [
      {
        id: 'schedules',
        label: 'Phân ca',
        description: 'Thiết lập và quản lý các ca làm việc theo nhân viên',
        icon: 'schedule',
        view: 'schedules',
      },
      {
        id: 'shifts',
        label: 'Danh mục ca',
        description: 'Quản lý danh mục ca, mẫu ca và quy tắc tính',
        icon: 'shift',
        view: 'shifts',
      },
      {
        id: 'standard-work',
        label: 'Công chuẩn',
        description: 'Công chuẩn của bảng công theo từng tháng: động theo lịch ca hoặc cố định số ngày công',
        icon: 'calendar',
        view: 'standard-work',
      },
    ],
  },
  {
    id: 'request',
    navLabel: 'Đơn từ & phê duyệt',
    title: 'Đơn từ & quy trình',
    description: 'Loại đơn, lý do của từng loại đơn (gồm lý do nghỉ) và các bước phê duyệt.',
    icon: 'request',
    entries: [
      {
        id: 'request-reasons',
        label: 'Loại đơn & lý do',
        description: 'Quản lý loại đơn và danh mục lý do (gồm lý do nghỉ) của từng loại',
        icon: 'request',
        view: 'request-reasons',
      },
      {
        id: 'approval',
        label: 'Quy trình duyệt',
        description: 'Thiết lập quy trình phê duyệt đơn từ',
        icon: 'approval',
        view: 'approval',
      },
    ],
  },
  {
    id: 'payroll',
    navLabel: 'Lương',
    title: 'Lương',
    description: 'Cấu hình lương, OT và các khoản chi trả.',
    icon: 'payroll',
    entries: [
      {
        id: 'payroll',
        label: 'Lương & OT',
        description: 'Cấu hình lương, phụ cấp, OT và các khoản chi trả',
        icon: 'payroll',
        view: 'payroll',
      },
    ],
  },
  {
    id: 'system',
    navLabel: 'Hệ thống',
    title: 'Hệ thống',
    description: 'Vận hành, tích hợp, quyền và vai trò.',
    icon: 'integration',
    entries: [
      {
        id: 'operations',
        label: 'Vận hành & tích hợp',
        description: 'Tích hợp dữ liệu, thiết bị và vận hành hệ thống',
        icon: 'integration',
        view: 'operations',
      },
      {
        id: 'permissions',
        label: 'Quyền và vai trò',
        description: 'Phân quyền truy cập và vai trò trong hệ thống',
        icon: 'permission',
        view: 'permissions',
      },
    ],
  },
];

export const ALL_SETTINGS_ENTRIES: readonly SettingsEntry[] = SETTINGS_GROUPS.flatMap((g) => g.entries);

/** Đường dẫn của một mục (không gồm phần gốc `/settings`): `?view=...&tab=...`. */
export function settingsEntryQuery(entry: SettingsEntry): string {
  return `?view=${entry.view}${entry.tab ? `&tab=${entry.tab}` : ''}`;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

/** Lọc mục theo từ khoá, bỏ dấu tiếng Việt, khớp tên, mô tả hoặc tên nhóm. */
export function filterSettingsEntries<T extends SettingsEntry>(entries: readonly T[], keyword: string): T[] {
  const needle = fold(keyword);
  if (!needle) return [...entries];
  return entries.filter((entry) => {
    const group = SETTINGS_GROUPS.find((g) => g.entries.some((e) => e.id === entry.id));
    return fold(`${entry.label} ${entry.description} ${group?.navLabel ?? ''}`).includes(needle);
  });
}

/**
 * Mục đang mở theo `?view=&tab=`: trùng cả view và tab thì lấy mục đó; trùng view mà tab lạ hoặc thiếu thì lấy mục đầu của
 * view. Không có `view` (hoặc view không thuộc mục nào được phép) thì trả về `undefined` (trang tổng quan).
 */
export function resolveSettingsEntry<T extends SettingsEntry>(
  entries: readonly T[],
  view: string | null,
  tab: string | null,
): T | undefined {
  if (!view) return undefined;
  // Liên kết cũ: lý do nghỉ từng là tab của màn phép năm (rồi một màn riêng); nay là lý do của loại đơn Đơn xin nghỉ.
  if ((view === 'leave' && tab === 'reasons') || view === 'leave-reasons') view = 'request-reasons';
  const sameView = entries.filter((e) => e.view === view);
  return sameView.find((e) => e.tab === tab) ?? sameView[0];
}
