'use client';
import type { ComponentType } from 'react';
import { HrmTabHub, type HrmHubTab } from '../ui/hrm-tab-hub';
import { HRM_HUBS, type HrmHubPath } from '../hrm-hub-tabs';
import HrmCalendarScreen from './hrm-calendar-screen';
import AttendanceScreen from './attendance-screen';
import MyTimesheetScreen from './my-timesheet-screen';
import ProfileScreen from './profile-screen';
import PayslipsScreen from './payslips-screen';
import EmployeesScreen from './employees-screen';
import DependentsScreen from './dependents-screen';
import PersonnelDecisionsScreen from './personnel-decisions-screen';
import LeaveBalancesScreen from './leave-balances-screen';
import WorkScheduleScreen from './work-schedule-screen';
import TimesheetsScreen from './timesheets-screen';
import AttendanceDataScreen from './attendance-data-screen';
import ShiftsScreen from './shifts-screen';
import PayrollScreen from './payroll-screen';
import AdvancesScreen from './advances-screen';
import TimeSettingsScreen from './time-settings-screen';
import PayrollSettingsScreen from './payroll-settings-screen';
import LeaveSettingsScreen from './leave-settings-screen';
import RequestReasonsScreen from './request-reasons-screen';
import ApprovalConfigScreen from './approval-config-screen';
import OperationsScreen from './operations-screen';
import HrmPermissionsScreen from './hrm-permissions-screen';

/** Gắn màn hình vào từng tab; nhãn và quyền lấy từ `HRM_HUBS`. */
const SCREENS: Record<HrmHubPath, Record<string, ComponentType>> = {
  '/my-work': { calendar: HrmCalendarScreen, attendance: AttendanceScreen, timesheet: MyTimesheetScreen },
  '/profile': { profile: ProfileScreen, payslips: PayslipsScreen },
  '/employees': {
    employees: EmployeesScreen,
    dependents: DependentsScreen,
    decisions: PersonnelDecisionsScreen,
    leave: LeaveBalancesScreen,
  },
  '/timekeeping': {
    schedules: WorkScheduleScreen,
    timesheets: TimesheetsScreen,
    data: AttendanceDataScreen,
    shifts: ShiftsScreen,
  },
  '/payroll': { runs: PayrollScreen, advances: AdvancesScreen },
  '/settings': {
    time: TimeSettingsScreen,
    payroll: PayrollSettingsScreen,
    leave: LeaveSettingsScreen,
    'request-reasons': RequestReasonsScreen,
    approval: ApprovalConfigScreen,
    operations: OperationsScreen,
    permissions: HrmPermissionsScreen,
  },
};

function tabsOf(path: HrmHubPath): HrmHubTab[] {
  return HRM_HUBS[path].map((tab) => ({ ...tab, Screen: SCREENS[path][tab.id] }));
}

/** Công của tôi: lịch, chấm công, bảng công của chính mình. */
export const MyWorkHub = () => <HrmTabHub tabs={tabsOf('/my-work')} />;
/** Hồ sơ và phiếu lương của tôi. */
export const MyProfileHub = () => <HrmTabHub tabs={tabsOf('/profile')} />;
/** Nhân sự: hồ sơ nhân viên và mọi thứ gắn với nhân viên. */
export const PeopleHub = () => <HrmTabHub tabs={tabsOf('/employees')} />;
/** Chấm công và ca: phân ca, bảng công, dữ liệu chấm công, danh mục ca. */
export const TimekeepingHub = () => <HrmTabHub tabs={tabsOf('/timekeeping')} />;
/** Lương và chi trả: bảng lương, ứng và thu hồi. */
export const PayrollHub = () => <HrmTabHub tabs={tabsOf('/payroll')} />;
/** Cấu hình toàn module. */
export const SettingsHub = () => <HrmTabHub tabs={tabsOf('/settings')} />;
