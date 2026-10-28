'use client';

import {
  Activity,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Car,
  ClipboardCheck,
  Clock,
  FilePlus,
  FileText,
  Home,
  Loader2,
  Search,
  ShieldCheck,
  Sliders,
  TrendingUp,
  User,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import type { HrmEmployeeProfile } from '@enterprise-platform/contracts-hrm';
import {
  hrmEmployeeOptions,
  hrmFetch,
  type EmployeeOption,
} from '../hrm-api';
import {
  ATTENDANCE_MONITOR_PERMISSIONS,
  useHrmPermissions,
} from '../hrm-permissions';

/** Nơi kết quả tìm nhanh dẫn tới */
export type HrmQuickSearchTarget =
  | { readonly kind: 'page'; readonly href: string }
  | {
      readonly kind: 'employee';
      readonly employeeId: string;
      readonly employeeCode: string;
      readonly fullName: string;
    }
  | {
      readonly kind: 'position';
      readonly positionId: string;
      readonly positionName: string;
    }
  | {
      readonly kind: 'request-type';
      readonly code: string;
      readonly name: string;
    };

export interface HrmQuickSearchProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPick: (target: HrmQuickSearchTarget) => void;
}

interface ResultRow {
  readonly key: string;
  readonly group: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly hint?: string;
  readonly target: HrmQuickSearchTarget;
}

interface PageItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly hint?: string;
  readonly icon: LucideIcon;
  readonly permissions?: readonly HrmAction[];
}

/** Danh sách tất cả các trang và tab chức năng của phân hệ HRM */
const PAGES: readonly PageItem[] = [
  // Tổng quan & Cá nhân
  {
    id: 'dashboard',
    label: 'Bàn làm việc',
    href: '/',
    group: 'Trang',
    hint: 'Trang chủ HRM',
    icon: Home,
    permissions: ['hrm.self.read', 'hrm.dashboard.read'],
  },
  {
    id: 'attendance_monitor',
    label: 'Giám sát chấm công',
    href: '/attendance-monitor',
    group: 'Trang',
    hint: 'Theo dõi vào/ra',
    icon: Activity,
    permissions: ATTENDANCE_MONITOR_PERMISSIONS,
  },
  {
    id: 'approvals',
    label: 'Đơn từ cần xử lý',
    href: '/approvals',
    group: 'Trang',
    hint: 'Phê duyệt đơn',
    icon: ClipboardCheck,
    permissions: [
      'hrm.request.approve',
      'hrm.request.approve.all',
      'hrm.request.read',
      'hrm.request.manage',
      'hrm.advance.read',
    ],
  },
  {
    id: 'my_work',
    label: 'Công của tôi',
    href: '/my-work',
    group: 'Trang',
    hint: 'Bảng công cá nhân',
    icon: Clock,
    permissions: ['hrm.self.read'],
  },
  {
    id: 'requests',
    label: 'Đơn từ của tôi',
    href: '/requests',
    group: 'Trang',
    hint: 'Đơn xin nghỉ, OT...',
    icon: FileText,
    permissions: ['hrm.self.read'],
  },
  {
    id: 'profile',
    label: 'Hồ sơ cá nhân',
    href: '/profile',
    group: 'Trang',
    hint: 'Thông tin nhân sự',
    icon: UserCircle,
    permissions: ['hrm.self.read'],
  },
  {
    id: 'payslips',
    label: 'Phiếu lương',
    href: '/profile?view=payslips',
    group: 'Trang',
    hint: 'Bảng lương chi tiết',
    icon: TrendingUp,
    permissions: ['hrm.self.payslip'],
  },

  // Quản lý
  {
    id: 'employees',
    label: 'Danh sách nhân sự',
    href: '/employees',
    group: 'Trang',
    hint: 'Quản lý nhân viên',
    icon: Users,
    permissions: ['hrm.employee.read'],
  },
  {
    id: 'personnel_decisions',
    label: 'Quyết định nhân sự',
    href: '/employees?view=decisions',
    group: 'Trang',
    hint: 'Bổ nhiệm, điều chuyển',
    icon: FilePlus,
    permissions: ['hrm.appointment.read'],
  },
  {
    id: 'timekeeping',
    label: 'Bảng công tổng hợp',
    href: '/timekeeping',
    group: 'Trang',
    hint: 'Bảng chấm công',
    icon: CalendarClock,
    permissions: ['hrm.timesheet.read'],
  },
  {
    id: 'attendance_data',
    label: 'Dữ liệu chấm công gốc',
    href: '/timekeeping?view=data',
    group: 'Trang',
    hint: 'Máy chấm công, log vào/ra',
    icon: Activity,
    permissions: ['hrm.attendance.read'],
  },
  {
    id: 'leave',
    label: 'Phép năm và nghỉ bù',
    href: '/leave',
    group: 'Trang',
    hint: 'Quỹ phép nhân viên',
    icon: CalendarDays,
    permissions: ['hrm.leave.read'],
  },
  {
    id: 'leave_adjustments',
    label: 'Lịch sử điều chỉnh phép',
    href: '/leave?view=adjustments',
    group: 'Trang',
    hint: 'Biến động ngày phép',
    icon: CalendarDays,
    permissions: ['hrm.leave.read'],
  },
  {
    id: 'payroll',
    label: 'Bảng lương và chi trả',
    href: '/payroll',
    group: 'Trang',
    hint: 'Kỳ tính lương',
    icon: TrendingUp,
    permissions: ['hrm.payroll.read'],
  },
  {
    id: 'advances',
    label: 'Tạm ứng và thu hồi',
    href: '/payroll?view=advances',
    group: 'Trang',
    hint: 'Ứng lương nhân viên',
    icon: TrendingUp,
    permissions: ['hrm.advance.read'],
  },
  {
    id: 'fleet',
    label: 'Lịch xe và điều xe',
    href: '/fleet',
    group: 'Trang',
    hint: 'Lịch trình xe cơ quan',
    icon: Car,
    permissions: ['hrm.fleet.read'],
  },
  {
    id: 'fleet_vehicles',
    label: 'Danh mục phương tiện xe',
    href: '/fleet?view=vehicles',
    group: 'Trang',
    hint: 'Quản lý xe',
    icon: Car,
    permissions: ['hrm.fleet.manage'],
  },
  {
    id: 'fleet_drivers',
    label: 'Danh sách tài xế',
    href: '/fleet?view=drivers',
    group: 'Trang',
    hint: 'Đội ngũ lái xe',
    icon: Car,
    permissions: ['hrm.fleet.manage'],
  },

  // Cấu hình & Hệ thống
  {
    id: 'settings',
    label: 'Cấu hình nhân sự',
    href: '/settings',
    group: 'Trang',
    hint: 'Thiết lập HRM',
    icon: Sliders,
    permissions: [
      'hrm.time.configure',
      'hrm.leave.manage',
      'hrm.payroll.configure',
      'hrm.manage',
    ],
  },
  {
    id: 'settings_leave',
    label: 'Cấu hình chính sách phép năm',
    href: '/settings?tab=leave',
    group: 'Trang',
    hint: 'Quy chế nghỉ phép',
    icon: CalendarDays,
    permissions: ['hrm.leave.manage'],
  },
  {
    id: 'settings_time',
    label: 'Cấu hình chấm công',
    href: '/settings?tab=time',
    group: 'Trang',
    hint: 'Địa điểm, GPS, wifi',
    icon: Clock,
    permissions: ['hrm.time.configure'],
  },
  {
    id: 'settings_schedules',
    label: 'Phân ca làm việc',
    href: '/settings?tab=schedules',
    group: 'Trang',
    hint: 'Lịch phân ca',
    icon: CalendarClock,
    permissions: ['hrm.schedule.read'],
  },
  {
    id: 'settings_shifts',
    label: 'Danh mục ca làm việc',
    href: '/settings?tab=shifts',
    group: 'Trang',
    hint: 'Giờ vào, giờ ra',
    icon: Clock,
    permissions: ['hrm.shift.read', 'hrm.shift.manage'],
  },
  {
    id: 'settings_auto_attendance',
    label: 'Cấu hình chấm công tự động',
    href: '/settings?tab=auto-attendance',
    group: 'Trang',
    hint: 'Tự động tính công',
    icon: Activity,
    permissions: ['hrm.time.configure'],
  },
  {
    id: 'settings_payroll',
    label: 'Cấu hình lương và ngạch bậc',
    href: '/settings?tab=payroll',
    group: 'Trang',
    hint: 'Công thức & ngạch bậc',
    icon: TrendingUp,
    permissions: [
      'hrm.payroll.configure',
      'hrm.salary.read',
      'hrm.salary.manage',
    ],
  },
  {
    id: 'settings_request_reasons',
    label: 'Loại đơn và lý do nghỉ',
    href: '/settings?tab=request-reasons',
    group: 'Trang',
    hint: 'Danh mục đơn từ',
    icon: FileText,
    permissions: ['hrm.leave.manage'],
  },
  {
    id: 'settings_request_quota',
    label: 'Hạn mức đơn từ',
    href: '/settings?tab=request-quota',
    group: 'Trang',
    hint: 'Số ngày tối đa',
    icon: FileText,
    permissions: ['hrm.leave.manage'],
  },
  {
    id: 'settings_request_time_rules',
    label: 'Quy tắc thời gian đơn',
    href: '/settings?tab=request-time-rules',
    group: 'Trang',
    hint: 'Thời hạn tạo đơn',
    icon: Clock,
    permissions: ['hrm.leave.manage'],
  },
  {
    id: 'settings_approval',
    label: 'Cấu hình quy trình duyệt đơn',
    href: '/settings?tab=approval',
    group: 'Trang',
    hint: 'Luồng phê duyệt',
    icon: ClipboardCheck,
    permissions: ['hrm.automation.manage'],
  },
  {
    id: 'settings_operations',
    label: 'Vận hành và tích hợp',
    href: '/settings?tab=operations',
    group: 'Trang',
    hint: 'Tích hợp & nhật ký',
    icon: Sliders,
    permissions: [
      'hrm.automation.manage',
      'hrm.integration.manage',
      'hrm.audit.read',
    ],
  },
  {
    id: 'permissions',
    label: 'Phân quyền HRM',
    href: '/permissions',
    group: 'Trang',
    hint: 'Vai trò & quyền hạn',
    icon: ShieldCheck,
    permissions: ['hrm.manage'],
  },
];

/** Lối tắt thao tác nhanh tạo đơn */
const QUICK_ACTIONS: readonly {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly keywords: string;
}[] = [
  {
    id: 'act_leave',
    label: 'Tạo đơn xin nghỉ phép',
    href: '/requests?create=LEAVE',
    hint: 'Nghỉ phép năm, nghỉ ốm, việc riêng',
    icon: FilePlus,
    keywords: 'tao don xin nghi phep nam om viec rieng ngay phep',
  },
  {
    id: 'act_ot',
    label: 'Tạo đơn làm thêm giờ (OT)',
    href: '/requests?create=OT',
    hint: 'Tăng ca ngày thường, nghỉ lễ',
    icon: FilePlus,
    keywords: 'tao don lam them gio tang ca overtime ot ngay le cuoi tuan',
  },
  {
    id: 'act_trip',
    label: 'Tạo đơn xin đi công tác',
    href: '/requests?create=BUSINESS_TRIP',
    hint: 'Công tác nội bộ, ngoại tỉnh',
    icon: FilePlus,
    keywords: 'tao don xin di cong tac business trip cong tac phi',
  },
  {
    id: 'act_shift_change',
    label: 'Tạo đơn xin đổi ca làm việc',
    href: '/requests?create=SHIFT_CHANGE',
    hint: 'Đổi ca với đồng nghiệp',
    icon: FilePlus,
    keywords: 'tao don xin doi ca lam viec shift change ca truc',
  },
  {
    id: 'act_correction',
    label: 'Tạo đơn giải trình chấm công',
    href: '/requests?create=ATTENDANCE_CORRECTION',
    hint: 'Quên chấm công, bổ sung giờ vào/ra',
    icon: FilePlus,
    keywords: 'tao don giai trinh cham cong quen cham bo sung check in check out',
  },
  {
    id: 'act_advance',
    label: 'Tạo đơn tạm ứng lương',
    href: '/requests?create=SALARY_ADVANCE',
    hint: 'Tạm ứng thu nhập trong tháng',
    icon: FilePlus,
    keywords: 'tao don tam ung luong ung tien advance',
  },
];

const PER_GROUP = 6;

/** Bỏ dấu và chữ hoa, để gõ "nhan su" vẫn ra "Nhân sự" */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

interface RequestTypeItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
}

interface PositionItem {
  readonly position_id: string;
  readonly position_code?: string;
  readonly position_name: string;
  readonly unit_name?: string;
  readonly active_employee_count?: number;
}

/**
 * Hộp thoại tìm nhanh toàn phân hệ HRM.
 * Tham khảo và tương thích trải nghiệm của module Workspace:
 * - Kích hoạt bằng nút "Tìm nhanh" trên thanh menu bên hoặc phím tắt Ctrl+K (Cmd+K).
 * - Tìm kiếm trang chức năng, nhân viên, vị trí/chức danh, loại đơn và lối tắt thao tác nhanh.
 */
export function HrmQuickSearch({ open, onClose, onPick }: HrmQuickSearchProps) {
  const [mounted, setMounted] = useState(false);
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Dữ liệu từ server
  const [cachedEmployeeOptions, setCachedEmployeeOptions] = useState<
    readonly EmployeeOption[]
  >([]);
  const [serverEmployees, setServerEmployees] = useState<
    readonly HrmEmployeeProfile[]
  >([]);
  const [serverPositions, setServerPositions] = useState<
    readonly PositionItem[]
  >([]);
  const [requestTypes, setRequestTypes] = useState<
    readonly RequestTypeItem[]
  >([]);

  const permissions = useHrmPermissions();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setMounted(true), []);

  // Mở hộp thoại: làm mới dữ liệu và tự động focus ô tìm kiếm
  useEffect(() => {
    if (!open) return;
    setTerm('');
    setActive(0);
    setServerEmployees([]);
    setServerPositions([]);

    // Tải trước danh sách nhân viên cơ bản (cache 30s)
    hrmEmployeeOptions()
      .then(setCachedEmployeeOptions)
      .catch(() => setCachedEmployeeOptions([]));

    // Tải danh mục loại đơn nếu chưa có
    hrmFetch<{ data: RequestTypeItem[] }>('/request-types')
      .then((res) => setRequestTypes(res.data ?? []))
      .catch(() => setRequestTypes([]));

    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Hỏi server sau một nhịp gõ 200ms
  useEffect(() => {
    if (!open) return;
    const needle = term.trim();
    if (needle.length < 2) {
      setServerEmployees([]);
      setServerPositions([]);
      return;
    }

    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      const canReadEmployee = permissions.can('hrm.employee.read');

      const promises: [
        Promise<{ data: HrmEmployeeProfile[] }>,
        Promise<{ data: PositionItem[] }>,
      ] = [
        canReadEmployee
          ? hrmFetch<{ data: HrmEmployeeProfile[] }>(
              `/employees?search=${encodeURIComponent(needle)}&page_size=${PER_GROUP}`,
            ).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        canReadEmployee
          ? hrmFetch<{ data: PositionItem[] }>(
              `/positions?search=${encodeURIComponent(needle)}`,
            ).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ];

      Promise.all(promises)
        .then(([empRes, posRes]) => {
          if (!alive) return;
          setServerEmployees(empRes.data ?? []);
          setServerPositions((posRes.data ?? []).slice(0, 4));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, open, permissions]);

  // Tổng hợp danh sách kết quả
  const rows = useMemo<ResultRow[]>(() => {
    const needle = fold(term.trim());

    // 1. Trang & chức năng được cấp quyền
    const allowedPages = PAGES.filter(
      (page) => !page.permissions || permissions.any(page.permissions),
    );
    const pageRows = allowedPages
      .filter((page) => !needle || fold(page.label).includes(needle) || fold(page.hint || '').includes(needle))
      .slice(0, needle ? PER_GROUP : 8)
      .map(
        (page): ResultRow => ({
          key: `page:${page.id}`,
          group: 'Trang',
          icon: <page.icon size={15} aria-hidden />,
          label: page.label,
          hint: page.hint,
          target: { kind: 'page', href: page.href },
        }),
      );

    // 2. Thao tác nhanh (Tạo đơn từ)
    const actionRows = QUICK_ACTIONS.filter(
      (act) =>
        !needle ||
        fold(act.label).includes(needle) ||
        fold(act.hint).includes(needle) ||
        fold(act.keywords).includes(needle),
    )
      .slice(0, needle ? 4 : 4)
      .map(
        (act): ResultRow => ({
          key: `act:${act.id}`,
          group: 'Thao tác nhanh',
          icon: <act.icon size={15} aria-hidden />,
          label: act.label,
          hint: act.hint,
          target: { kind: 'page', href: act.href },
        }),
      );

    // Nếu không nhập từ khoá: hiện trang & thao tác nhanh
    if (!needle) {
      return [...pageRows, ...actionRows];
    }

    // 3. Nhân sự (kết hợp cache tức thì và kết quả server phong phú hơn)
    const seenEmpIds = new Set<string>();
    const employeeRows: ResultRow[] = [];

    // Ưu tiên kết quả từ server (có đầy đủ chức danh, email, v.v.)
    for (const emp of serverEmployees) {
      if (!seenEmpIds.has(emp.employeeId)) {
        seenEmpIds.add(emp.employeeId);
        employeeRows.push({
          key: `emp:${emp.employeeId}`,
          group: 'Nhân sự',
          icon: <User size={15} aria-hidden />,
          label: `${emp.employeeCode} · ${emp.fullName}`,
          hint: [emp.department, emp.position].filter(Boolean).join(' · '),
          target: {
            kind: 'employee',
            employeeId: emp.employeeId,
            employeeCode: emp.employeeCode,
            fullName: emp.fullName || '',
          },
        });
      }
    }

    // Bổ sung từ cache options nếu server chưa kịp trả về
    if (employeeRows.length < PER_GROUP) {
      const matchedOptions = cachedEmployeeOptions
        .filter((opt) => fold(opt.label).includes(needle) || fold(opt.department || '').includes(needle))
        .slice(0, PER_GROUP - employeeRows.length);

      for (const opt of matchedOptions) {
        if (!seenEmpIds.has(opt.value)) {
          seenEmpIds.add(opt.value);
          const parts = opt.label.split(' · ');
          const code = parts[0] || '';
          const name = parts[1] || opt.label;
          employeeRows.push({
            key: `emp:${opt.value}`,
            group: 'Nhân sự',
            icon: <User size={15} aria-hidden />,
            label: opt.label,
            hint: opt.department || undefined,
            target: {
              kind: 'employee',
              employeeId: opt.value,
              employeeCode: code,
              fullName: name,
            },
          });
        }
      }
    }

    // 4. Vị trí / Chức danh
    const positionRows = serverPositions.map(
      (pos): ResultRow => ({
        key: `pos:${pos.position_id}`,
        group: 'Chức danh / Vị trí',
        icon: <Briefcase size={15} aria-hidden />,
        label: `${pos.position_code ? `${pos.position_code} · ` : ''}${pos.position_name}`,
        hint: [pos.unit_name, pos.active_employee_count ? `${pos.active_employee_count} nhân sự` : '']
          .filter(Boolean)
          .join(' · '),
        target: {
          kind: 'position',
          positionId: pos.position_id,
          positionName: pos.position_name,
        },
      }),
    );

    // 5. Loại đơn & Lý do
    const typeRows = requestTypes
      .filter((t) => fold(t.name).includes(needle) || fold(t.code).includes(needle))
      .slice(0, 4)
      .map(
        (t): ResultRow => ({
          key: `req-type:${t.id || t.code}`,
          group: 'Loại đơn',
          icon: <FileText size={15} aria-hidden />,
          label: `Tạo đơn: ${t.name}`,
          hint: t.code,
          target: { kind: 'request-type', code: t.code, name: t.name },
        }),
      );

    return [
      ...pageRows,
      ...actionRows,
      ...employeeRows,
      ...positionRows,
      ...typeRows,
    ];
  }, [
    term,
    permissions,
    serverEmployees,
    cachedEmployeeOptions,
    serverPositions,
    requestTypes,
  ]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (row: ResultRow | undefined) => {
    if (!row) return;
    onPick(row.target);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 md:p-10 bg-slate-950/45 backdrop-blur-xs transition-opacity duration-150"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[75vh] mt-6 sm:mt-12 rounded-2xl bg-white shadow-2xl border border-slate-200/90 overflow-hidden text-slate-800"
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhanh"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Thanh nhập tìm kiếm */}
        <label className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 bg-white">
          <Search size={18} className="text-slate-400 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={term}
            placeholder="Tìm nhân sự, đơn từ, chức năng, ca làm việc…"
            aria-label="Từ khoá tìm nhanh"
            aria-controls="hrm-quick-search-results"
            aria-activedescendant={
              rows[active] ? `hrm-quick-search-${active}` : undefined
            }
            className="w-full bg-transparent text-sm sm:text-base text-slate-900 placeholder:text-slate-400 outline-none border-none"
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {loading ? (
            <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin text-blue-600" />
              Đang tìm…
            </span>
          ) : null}
        </label>

        {/* Danh sách kết quả */}
        <ul
          id="hrm-quick-search-results"
          ref={listRef}
          className="flex-1 m-0 p-2 overflow-y-auto list-none divide-y-0"
          role="listbox"
        >
          {rows.map((row, index) => {
            const isFirstOfGroup =
              index === 0 || rows[index - 1].group !== row.group;
            const isSelected = index === active;

            return (
              <li key={row.key} role="presentation">
                {isFirstOfGroup ? (
                  <span className="block px-3 pt-2.5 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    {row.group}
                  </span>
                ) : null}
                <button
                  id={`hrm-quick-search-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  className={`group flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/10 text-slate-900 font-medium'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(row)}
                >
                  <span
                    className={`size-7 rounded-md flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                    }`}
                  >
                    {row.icon}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[13.5px]">
                    {row.label}
                  </span>
                  {row.hint ? (
                    <span className="text-xs text-slate-400 shrink-0 truncate max-w-[220px]">
                      {row.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}

          {term.trim().length >= 2 && rows.length === 0 && !loading ? (
            <li className="py-10 text-center text-sm text-slate-400">
              Không tìm thấy trang, nhân sự hoặc chức năng nào khớp.
            </li>
          ) : null}
        </ul>

        {/* Thanh phím tắt hướng dẫn */}
        <p className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50/80 text-[11.5px] text-slate-500">
          <span>
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white shadow-2xs font-mono text-[10.5px]">
              ↑
            </kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white shadow-2xs font-mono text-[10.5px]">
              ↓
            </kbd>{' '}
            để chọn ·{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white shadow-2xs font-mono text-[10.5px]">
              Enter
            </kbd>{' '}
            để mở ·{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white shadow-2xs font-mono text-[10.5px]">
              Esc
            </kbd>{' '}
            để đóng
          </span>
          <span className="text-[11px] text-slate-400">Tìm kiếm HRM</span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
