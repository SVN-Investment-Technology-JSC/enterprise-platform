'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { HrmTabHub, type HrmHubTab } from '../ui/hrm-tab-hub';
import { SettingsCenter } from '../ui/settings-center';
import { HRM_HUBS, type HrmHubPath } from '../hrm-hub-tabs';

/** Mỗi tab là một gói riêng, chỉ tải khi mở tab: vào trang nào chỉ biên dịch và tải đúng màn hình đó. */
function lazyScreen(loader: () => Promise<{ default: ComponentType }>): ComponentType {
  return dynamic(loader, {
    loading: () => (
      <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        Đang tải…
      </div>
    ),
  });
}

const MyTimesheetScreen = lazyScreen(() => import('./my-timesheet-screen'));
const ProfileScreen = lazyScreen(() => import('./profile-screen'));
const PayslipsScreen = lazyScreen(() => import('./payslips-screen'));
const EmployeesScreen = lazyScreen(() => import('./employees-screen'));
const PersonnelDecisionsScreen = lazyScreen(() => import('./personnel-decisions-screen'));
const LeaveBalancesScreen = lazyScreen(() => import('./leave-balances-screen'));
const LeaveAdjustmentHistoryScreen = lazyScreen(() => import('./leave-adjustment-history-screen'));
const WorkScheduleScreen = lazyScreen(() => import('./work-schedule-screen'));
const TimesheetsScreen = lazyScreen(() => import('./timesheets-screen'));
const AttendanceDataScreen = lazyScreen(() => import('./attendance-data-screen'));
const ShiftsScreen = lazyScreen(() => import('./shifts-screen'));
const TimesheetStandardScreen = lazyScreen(() => import('./timesheet-standard-screen'));
const AutoAttendanceScreen = lazyScreen(() => import('./auto-attendance-screen'));
const PayrollScreen = lazyScreen(() => import('./payroll-screen'));
const AdvancesScreen = lazyScreen(() => import('./advances-screen'));
const TimeSettingsScreen = lazyScreen(() => import('./time-settings-screen'));
const PayrollSettingsScreen = lazyScreen(() => import('./payroll-settings-screen'));
const LeaveSettingsScreen = lazyScreen(() => import('./leave-settings-screen'));
const RequestReasonsScreen = lazyScreen(() => import('./request-reasons-screen'));
const ApprovalConfigScreen = lazyScreen(() => import('./approval-config-screen'));
const OperationsScreen = lazyScreen(() => import('./operations-screen'));
const HrmPermissionsScreen = lazyScreen(() => import('./hrm-permissions-screen'));
const FleetScheduleScreen = lazyScreen(() => import('./fleet-schedule-screen'));
const FleetVehiclesScreen = lazyScreen(() => import('./fleet-vehicles-screen'));
const FleetDriversScreen = lazyScreen(() => import('./fleet-drivers-screen'));

/** Gắn màn hình vào từng tab; nhãn và quyền lấy từ `HRM_HUBS`. */
const SCREENS: Record<HrmHubPath, Record<string, ComponentType>> = {
  '/my-work': { timesheet: MyTimesheetScreen },
  '/profile': { profile: ProfileScreen, payslips: PayslipsScreen },
  '/employees': {
    employees: EmployeesScreen,
    decisions: PersonnelDecisionsScreen,
  },
  '/leave': { balances: LeaveBalancesScreen, adjustments: LeaveAdjustmentHistoryScreen },
  '/timekeeping': {
    timesheets: TimesheetsScreen,
    data: AttendanceDataScreen,
  },
  '/payroll': { runs: PayrollScreen, advances: AdvancesScreen },
  '/fleet': { schedule: FleetScheduleScreen, vehicles: FleetVehiclesScreen, drivers: FleetDriversScreen },
  '/settings': {
    leave: LeaveSettingsScreen,
    time: TimeSettingsScreen,
    schedules: WorkScheduleScreen,
    shifts: ShiftsScreen,
    'standard-work': TimesheetStandardScreen,
    'auto-attendance': AutoAttendanceScreen,
    payroll: PayrollSettingsScreen,
    'request-reasons': RequestReasonsScreen,
    approval: ApprovalConfigScreen,
    operations: OperationsScreen,
    permissions: HrmPermissionsScreen,
  },
};

function tabsOf(path: HrmHubPath): HrmHubTab[] {
  return HRM_HUBS[path].map((tab) => ({ ...tab, Screen: SCREENS[path][tab.id] }));
}

/** Công của tôi: bảng công tháng của chính mình (chấm công thực hiện trên ứng dụng di động). */
export const MyWorkHub = () => <HrmTabHub tabs={tabsOf('/my-work')} />;
/** Hồ sơ và phiếu lương của tôi. */
export const MyProfileHub = () => <HrmTabHub tabs={tabsOf('/profile')} tabsInHeader />;
/** Nhân sự: hồ sơ nhân viên và mọi thứ gắn với nhân viên. */
export const PeopleHub = () => <HrmTabHub tabs={tabsOf('/employees')} />;
/** Phép năm: quỹ phép của nhân viên, chính sách phép năm và lý do nghỉ. */
export const LeaveHub = () => <HrmTabHub tabs={tabsOf('/leave')} />;
/** Bảng công: bảng công tháng của nhân viên và dữ liệu chấm công. Phân ca và danh mục ca nằm trong Cấu hình. */
export const TimekeepingHub = () => <HrmTabHub tabs={tabsOf('/timekeeping')} tabsInHeader />;
/** Lương và chi trả: bảng lương, ứng và thu hồi. */
export const PayrollHub = () => <HrmTabHub tabs={tabsOf('/payroll')} tabsInHeader />;
/** Lịch xe công ty: lịch đặt xe, danh mục xe và tài xế. */
export const FleetHub = () => <HrmTabHub tabs={tabsOf('/fleet')} tabsInHeader />;
/** Trung tâm cấu hình: thanh bên theo nhóm chức năng và trang tổng quan. */
export const SettingsHub = () => <SettingsCenter screens={SCREENS['/settings']} />;
