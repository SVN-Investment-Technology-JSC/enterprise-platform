'use client';

import { TimeTextInput } from '../ui/time-text-input';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Edit,
  Eye,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  UserCheck,
  Users,
  Building2,
  ChevronRight,
  Sparkles,
  Filter,
  Settings2,
  X,
} from 'lucide-react';
import type {
  HrmEmployeeProfile,
  HrmShiftDefinition,
  HrmAttendance,
  HrmAttendanceCorrection,
} from '@enterprise-platform/contracts-hrm';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Input } from '../ui/input';
import { DatePickerInput } from '../ui/date-picker-input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { toast } from '../ui/toast';
import { SearchableSelect, type SearchableSelectOption, Popconfirm } from '@enterprise-platform/shared-ui';
import { computeShiftCoverage, computeShiftStandardHours } from '../hrm-shift-metrics';
import { UnitShiftPanel } from '../ui/unit-shift-panel';
import { MonthlyAttendanceMatrixTable, type MatrixLeaveRequest } from '../ui/monthly-attendance-matrix-table';

type SubTabKey = 'definitions' | 'roster' | 'raw_logs' | 'adjustments';

interface ExtendedShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  shiftCode?: string;
  shiftName?: string;
  startTime?: string;
  endTime?: string;
  employeeName?: string;
  employeeCode?: string;
}

function addMinutesToTime(time: string, minutes: number): string {
  const m = /^(d{2}):(d{2})/.exec(time || '');
  if (!m) return time;
  const total = (Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function csrfToken() {
  if (typeof document === 'undefined') return '';
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
}

export default function ShiftsPage() {
  const [activeTab, setActiveTab] = useState<SubTabKey>('definitions');

  // Master Data from DB
  const [shifts, setShifts] = useState<HrmShiftDefinition[]>([]);
  const [assignments, setAssignments] = useState<ExtendedShiftAssignment[]>([]);
  const [attendances, setAttendances] = useState<HrmAttendance[]>([]);
  const [corrections, setCorrections] = useState<HrmAttendanceCorrection[]>([]);
  const [employees, setEmployees] = useState<HrmEmployeeProfile[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<MatrixLeaveRequest[]>([]);

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [attendanceViewMode, setAttendanceViewMode] = useState<'MATRIX' | 'RAW_EVENTS' | 'PROCESSED'>('MATRIX');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [rosterViewMode, setRosterViewMode] = useState<'ORG_LEVEL' | 'INDIVIDUAL_EXCEPTIONS'>('ORG_LEVEL');
  const [selectedOrgUnit, setSelectedOrgUnit] = useState<string>('ALL');

  // Attendance Log Filters (Sub-tab 3)
  const [attFilterEmployeeId, setAttFilterEmployeeId] = useState<string>('ALL');
  const [attFilterStatus, setAttFilterStatus] = useState<string>('ALL');
  const [attFilterDateFrom, setAttFilterDateFrom] = useState<string>('');
  const [attFilterDateTo, setAttFilterDateTo] = useState<string>('');

  // Schedule Day Item Interface (Hỗ trợ 1 ngày N ca: Ca 1, Ca 2, Ca 3...)
  // Ví dụ: Ca 1: HC - Ca 2: Đêm; Hoặc: Ca 1: Sáng - Ca 2: Chiều - Ca 3: Tối
  interface DayShiftItem {
    shiftCode: string;
    shiftName: string;
    workHours: number;
    breakMinutes?: number;
  }

  // Department custom override map: key là deptName, value là object theo ngày
  const [deptShiftMap, setDeptShiftMap] = useState<Record<string, Record<string, {
    shifts?: DayShiftItem[];
    isOff?: boolean;
    isCustomOverride?: boolean;
  }>>>({});


  // Active Cell Popover State: Cho phép bấm trực tiếp vào giao điểm Hàng x Cột để mở Popover tại chỗ
  const [activeCellPopover, setActiveCellPopover] = useState<{
    deptName: string;
    dayIso: string;
    dayLabel: string;
    currentShifts: DayShiftItem[];
    currentIsOff: boolean;
    isCustomOverride: boolean;
  } | null>(null);

  // Modals & Drawers
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<HrmShiftDefinition | null>(null);
  const [selectedShiftForDrawer, setSelectedShiftForDrawer] = useState<HrmShiftDefinition | null>(null);
  const [isShiftDrawerOpen, setIsShiftDrawerOpen] = useState(false);

  // Quick Shift Assign Modal
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignTargetDept, setAssignTargetDept] = useState<string>('ALL');
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignEffectiveFrom, setAssignEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [assignEffectiveTo, setAssignEffectiveTo] = useState('');

  // Correction Drawer
  const [selectedCorrection, setSelectedCorrection] = useState<HrmAttendanceCorrection | null>(null);
  const [isCorrectionDrawerOpen, setIsCorrectionDrawerOpen] = useState(false);

  // New Shift Form State
  const [shiftForm, setShiftForm] = useState({
    code: '',
    name: '',
    startTime: '08:00',
    endTime: '17:30',
    breakMinutes: 90,
    breakStartTime: '12:00',
    breakEndTime: '13:30',
    crossMidnight: false,
    graceLateMinutes: 15,
    graceEarlyMinutes: 15,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const shiftCoverage = useMemo(
    () => computeShiftCoverage(assignments, employees.map((e) => e.employeeId), new Date().toISOString().slice(0, 10)),
    [assignments, employees],
  );

  // 1. Fetch Master Data from DB
  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [shiftsRes, assignRes, attRes, corrRes, empRes, leaveRes] = await Promise.all([
        fetch('/api/hrm/v1/shifts', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/shift-assignments', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/attendance', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/attendance-corrections', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/employees?page_size=100', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/leave-requests', { credentials: 'same-origin' }),
      ]);

      if (shiftsRes.ok) {
        const payload = await shiftsRes.json();
        const loadedShifts: HrmShiftDefinition[] = payload.data || [];
        setShifts(loadedShifts);
      }
      if (assignRes.ok) {
        const payload = await assignRes.json();
        setAssignments(payload.data || []);
      }
      if (attRes.ok) {
        const payload = await attRes.json();
        setAttendances(payload.data || []);
      }
      if (corrRes.ok) {
        const payload = await corrRes.json();
        setCorrections(payload.data || []);
      }
      if (empRes.ok) {
        const payload = await empRes.json();
        setEmployees(payload.data || []);
      }
      if (leaveRes.ok) {
        const payload = await leaveRes.json();
        setLeaveRequests(payload.data || []);
      }
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu Ca & Chấm công:', err);
      toast.add({
        title: 'Lỗi tải dữ liệu',
        description: 'Không thể kết nối đến máy chủ quản lý Ca & Chấm công.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Handle Save Shift (Create or Update)
  const handleSaveShift = async () => {
    if (!shiftForm.code.trim() || !shiftForm.name.trim()) {
      toast.add({
        title: 'Thiếu thông tin',
        description: 'Vui lòng nhập mã ca và tên ca làm việc.',
        type: 'warning',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const isEditing = !!editingShift;
      const url = isEditing ? `/api/hrm/v1/shifts/${editingShift.id}` : '/api/hrm/v1/shifts';
      const method = isEditing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...shiftForm,
          breakStartTime: shiftForm.breakMinutes > 0 ? shiftForm.breakStartTime : null,
          breakEndTime: shiftForm.breakMinutes > 0 ? shiftForm.breakEndTime : null,
        }),
      });

      if (res.ok) {
        toast.add({
          title: isEditing ? 'Đã cập nhật ca làm việc' : 'Tạo ca làm việc thành công',
          description: `Ca [${shiftForm.code}] ${shiftForm.name} đã được lưu thành công vào CSDL.`,
          type: 'success',
        });
        setIsAddShiftOpen(false);
        setEditingShift(null);
        await loadAllData();
      } else {
        const errPayload = await res.json().catch(() => ({}));
        toast.add({
          title: 'Lưu thất bại',
          description: errPayload.message || 'Mã ca đã tồn tại hoặc dữ liệu không hợp lệ.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi lưu ca làm việc:', err);
      toast.add({
        title: 'Lỗi kết nối',
        description: 'Không thể gửi yêu cầu đến máy chủ.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Edit Shift Dialog
  const handleOpenEditShift = (shift: HrmShiftDefinition) => {
    setEditingShift(shift);
    setShiftForm({
      code: shift.code,
      name: shift.name,
      startTime: shift.startTime?.slice(0, 5) || '08:00',
      endTime: shift.endTime?.slice(0, 5) || '17:30',
      breakMinutes: shift.breakMinutes ?? 0,
      breakStartTime: shift.breakStartTime?.slice(0, 5) || '12:00',
      breakEndTime:
        shift.breakEndTime?.slice(0, 5) ||
        addMinutesToTime(shift.breakStartTime?.slice(0, 5) || '12:00', shift.breakMinutes ?? 0),
      crossMidnight: shift.crossMidnight || false,
      graceLateMinutes: shift.graceLateMinutes ?? 10,
      graceEarlyMinutes: shift.graceEarlyMinutes ?? 5,
      status: shift.status || 'ACTIVE',
    });
    setIsAddShiftOpen(true);
  };

  // Handle Quick Shift Assignment
  const handleCreateAssignment = async () => {
    if (!assignEmployeeId || !assignShiftId || !assignEffectiveFrom) {
      toast.add({
        title: 'Thiếu thông tin',
        description: 'Vui lòng chọn nhân viên, ca làm việc và ngày hiệu lực.',
        type: 'warning',
      });
      return;
    }

    if (assignEffectiveTo && assignEffectiveTo < assignEffectiveFrom) {
      toast.add({
        title: 'Thời gian không hợp lệ',
        description: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu hiệu lực.',
        type: 'warning',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/hrm/v1/employees/${assignEmployeeId}/shift-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          shiftId: assignShiftId,
          effectiveFrom: assignEffectiveFrom,
          effectiveTo: assignEffectiveTo || null,
          source: 'MANUAL',
        }),
      });

      if (res.ok) {
        toast.add({
          title: 'Phân ca thành công',
          description: 'Đã gán ca làm việc cho nhân viên thành công.',
          type: 'success',
        });
        setIsAssignModalOpen(false);
        setAssignEmployeeId('');
        setAssignShiftId('');
        await loadAllData();
      } else {
        const errPayload = await res.json().catch(() => ({}));
        const errorMsg =
          errPayload.message ||
          (errPayload.error && typeof errPayload.error === 'object' ? errPayload.error.message : errPayload.error) ||
          (errPayload.code === 'HRM_SHIFT_ASSIGNMENT_OVERLAP'
            ? 'Khoảng thời gian gán ca bị chồng lấn với ca làm việc hiện hữu của nhân viên.'
            : 'Khoảng thời gian gán ca bị chồng lấn với ca hiện hữu.');
        toast.add({
          title: 'Phân ca không thành công',
          description: errorMsg,
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi phân ca:', err);
      toast.add({
        title: 'Lỗi máy chủ',
        description: 'Không thể kết nối đến hệ thống phân ca.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approve Attendance Correction
  const handleApproveCorrection = async (id: string) => {
    try {
      const res = await fetch(`/api/hrm/v1/attendance-corrections/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
      });

      if (res.ok) {
        toast.add({
          title: 'Đã phê duyệt điều chỉnh công',
          description: 'Bản ghi công đã được cập nhật trực tiếp vào bảng công tổng hợp.',
          type: 'success',
        });
        setIsCorrectionDrawerOpen(false);
        await loadAllData();
      } else {
        toast.add({
          title: 'Duyệt thất bại',
          description: 'Không thể phê duyệt đơn giải trình này.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi phê duyệt giải trình:', err);
      toast.add({
        title: 'Lỗi kết nối',
        description: 'Không thể kết nối đến máy chủ.',
        type: 'error',
      });
    }
  };

  // Reject Attendance Correction
  const handleRejectCorrection = async (id: string) => {
    try {
      const res = await fetch(`/api/hrm/v1/attendance-corrections/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Không đủ điều kiện phê duyệt hoặc sai bằng chứng' }),
      });

      if (res.ok) {
        toast.add({
          title: 'Đã từ chối đơn giải trình',
          description: 'Đơn đã chuyển sang trạng thái REJECTED.',
          type: 'info',
        });
        setIsCorrectionDrawerOpen(false);
        await loadAllData();
      } else {
        toast.add({
          title: 'Từ chối thất bại',
          description: 'Không thể cập nhật trạng thái đơn.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi từ chối giải trình:', err);
    }
  };

  // Filtered Shifts List
  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.code.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [shifts, searchTerm, statusFilter]);

  // Employee Select Options for SearchableSelect (Filtered by assignTargetDept to handle 1000+ employees smoothly)
  const employeeSelectOptions: SearchableSelectOption[] = useMemo(() => {
    const list = assignTargetDept === 'ALL'
      ? employees
      : employees.filter((emp) => emp.department === assignTargetDept);

    return list.map((emp) => ({
      value: emp.employeeId,
      label: `${emp.fullName || 'Nhân viên'} (${emp.employeeCode})`,
      description: `${emp.department || 'Chưa gán phòng'} • ${emp.position || 'Nhân viên'}`,
    }));
  }, [employees, assignTargetDept]);

  // All Employee Select Options for Attendance Log Filter (Sub-tab 3)
  const allEmployeeSelectOptions: SearchableSelectOption[] = useMemo(() => {
    return [
      { value: 'ALL', label: '' },
      ...employees.map((emp) => ({
        value: emp.employeeId,
        label: `${emp.fullName || 'Nhân viên'} (${emp.employeeCode})`,
        description: `${emp.department || 'Chưa gán phòng'} • ${emp.position || 'Nhân viên'}`,
      })),
    ];
  }, [employees]);

  // Filtered Attendances List (Sub-tab 3)
  const filteredAttendances = useMemo(() => {
    return attendances.filter((att) => {
      // 1. Employee filter
      if (attFilterEmployeeId !== 'ALL' && att.employeeId !== attFilterEmployeeId) {
        return false;
      }
      // 2. Status filter
      if (attFilterStatus !== 'ALL') {
        if (attFilterStatus === 'NO_CHECKOUT') {
          if (att.checkOutAt) return false;
        } else if (att.status !== attFilterStatus) {
          return false;
        }
      }
      // 3. Date range filter
      const workDateStr = String(att.workDate).slice(0, 10);
      if (attFilterDateFrom && workDateStr < attFilterDateFrom) {
        return false;
      }
      if (attFilterDateTo && workDateStr > attFilterDateTo) {
        return false;
      }
      return true;
    });
  }, [attendances, attFilterEmployeeId, attFilterStatus, attFilterDateFrom, attFilterDateTo]);

  // Shift Select Options for SearchableSelect
  const shiftSelectOptions: SearchableSelectOption[] = useMemo(() => {
    return shifts
      .filter((s) => s.status === 'ACTIVE')
      .map((s) => ({
        value: s.id,
        label: `[${s.code}] ${s.name}`,
        description: `${s.startTime?.slice(0, 5)} - ${s.endTime?.slice(0, 5)}${s.crossMidnight ? ' (Qua đêm)' : ''} • Nghỉ ${s.breakMinutes}p`,
      }));
  }, [shifts]);

  // Department Filter Options
  const departmentOptions: SearchableSelectOption[] = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.department) set.add(e.department);
    });
    return [
      { value: 'ALL', label: 'Tất cả phòng ban / chi nhánh' },
      ...Array.from(set).map((d) => ({ value: d, label: d })),
    ];
  }, [employees]);

  // Aggregate Departments with Employee Count for Org-level Roster
  const departmentHierarchyList = useMemo(() => {
    const map = new Map<string, { name: string; count: number; employees: HrmEmployeeProfile[] }>();
    employees.forEach((e) => {
      const deptName = e.department || 'Chưa phân bổ phòng ban';
      if (!map.has(deptName)) {
        map.set(deptName, { name: deptName, count: 0, employees: [] });
      }
      const item = map.get(deptName)!;
      item.count += 1;
      item.employees.push(e);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [employees]);

  // Ca thực tế của một phòng ban trong một ngày, gộp theo mã ca từ phân ca + danh mục ca.
  const deptDayShifts = useCallback(
    (deptEmployees: HrmEmployeeProfile[], dayIso: string): DayShiftItem[] => {
      const ids = new Set(deptEmployees.map((e) => e.employeeId));
      const counts = new Map<string, number>();
      for (const a of assignments) {
        if (a.status !== 'ACTIVE' || !ids.has(a.employeeId)) continue;
        if (a.effectiveFrom.slice(0, 10) > dayIso) continue;
        if (a.effectiveTo && a.effectiveTo.slice(0, 10) < dayIso) continue;
        counts.set(a.shiftId, (counts.get(a.shiftId) ?? 0) + 1);
      }
      const items: DayShiftItem[] = [];
      for (const [shiftId, count] of counts) {
        const sh = shifts.find((s) => s.id === shiftId);
        if (!sh) continue;
        const [sh1, sm1] = (sh.startTime || '00:00').split(':').map(Number);
        const [eh, em] = (sh.endTime || '00:00').split(':').map(Number);
        let minutes = eh * 60 + em - (sh1 * 60 + sm1) + (sh.crossMidnight ? 1440 : 0);
        minutes -= sh.breakMinutes ?? 0;
        items.push({
          shiftCode: sh.code,
          shiftName: `${sh.name} (${sh.startTime?.slice(0, 5)} - ${sh.endTime?.slice(0, 5)}) - ${count} NV`,
          workHours: Math.max(0, Math.round((minutes / 60) * 10) / 10),
          breakMinutes: sh.breakMinutes ?? 0,
        });
      }
      return items;
    },
    [assignments, shifts],
  );

  // Roster Matrix Computations (Generate current week days)
  const currentWeekDays = useMemo(() => {
    const today = new Date();
    const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday...
    const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMon);

    const days = [];
    const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      days.push({
        label: `${dayNames[i]} (${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')})`,
        iso,
        isWeekend: i >= 5,
        isToday: iso === today.toISOString().slice(0, 10),
      });
    }
    return days;
  }, []);

  // Filtered Employees for Roster
  const filteredRosterEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesDept = selectedDeptFilter === 'ALL' || emp.department === selectedDeptFilter;
      const name = emp.fullName || '';
      const code = emp.employeeCode || '';
      const matchesSearch =
        name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        code.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesDept && matchesSearch;
    });
  }, [employees, selectedDeptFilter, searchTerm]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#091426] tracking-tight">
              Quản lý Ca & Chấm công
            </h1>
            <Badge className="bg-blue-100 text-[#021E73] border-blue-200 text-xs font-semibold">
              HR Operations / C&B
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Quản lý vòng đời ca làm việc, bảng phân ca kíp (Roster), theo dõi log quẹt thẻ và xét duyệt giải trình công theo CSDL trực tiếp.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5 border-slate-200"
            onClick={() => {
              void loadAllData();
              toast.add({
                title: 'Đồng bộ dữ liệu',
                description: 'Đã tải dữ liệu mới nhất từ hệ thống máy chủ.',
                type: 'info',
              });
            }}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Đồng bộ DB</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5 border-slate-200 text-emerald-700 hover:text-emerald-800"
            onClick={() => {
              toast.add({
                title: 'Xuất biểu mẫu ca',
                description: 'Đang trích xuất dữ liệu ma trận ca và bảng công...',
                type: 'info',
              });
            }}
          >
            <Download className="size-3.5" />
            <span>Xuất Excel Roster</span>
          </Button>
        </div>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Tổng định nghĩa ca</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono">{shifts.length}</span>
              <span className="text-xs font-semibold text-blue-700">Mẫu ca</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-medium block mt-1">
              {shifts.filter((s) => s.status === 'ACTIVE').length} ca đang kích hoạt
            </span>
          </div>
          <div className="size-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Sliders className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Nhân sự đã phân ca</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600 font-mono">{shiftCoverage.assignedEmployees}</span>
              <span className="text-xs font-semibold text-slate-500 font-mono">/ {shiftCoverage.totalEmployees}</span>
            </div>
            <span className="text-[11px] text-slate-500 block mt-1">
              {shiftCoverage.coveragePercent}% độ phủ nhân sự
            </span>
          </div>
          <div className="size-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <Calendar className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Bản ghi công trong CSDL</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono">{attendances.length}</span>
              <span className="text-xs font-semibold text-slate-500">Lượt</span>
            </div>
            <span className="text-[11px] text-amber-600 font-medium block mt-1">
              {attendances.filter((a) => a.status === 'LATE' || a.status === 'EARLY_LEAVE').length} lượt đi muộn / về sớm
            </span>
          </div>
          <div className="size-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Clock className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Yêu cầu sửa công chờ duyệt</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#021E73] font-mono">
                {corrections.filter((c) => c.status === 'PENDING').length}
              </span>
              <span className="text-xs font-semibold text-blue-700">Đơn giải trình</span>
            </div>
            <span className="text-[11px] text-blue-700 font-medium block mt-1">Cần HR phê duyệt</span>
          </div>
          <div className="size-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#021E73] shrink-0">
            <Layers className="size-5" />
          </div>
        </div>
      </div>

      {/* 3. Horizontal Navigation Sub-tabs */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('definitions')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'definitions'
              ? 'border-[#021E73] text-[#021E73] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <Sliders className="size-4" />
            <span>1. Định nghĩa ca</span>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0 border-none">
              {shifts.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('roster')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'roster'
              ? 'border-[#021E73] text-[#021E73] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <Calendar className="size-4" />
            <span>2. Bảng phân ca (Roster theo Phòng ban)</span>
            <Badge className="bg-blue-50 text-blue-800 text-[10px] font-bold px-1.5 py-0 border border-blue-200">
              Kế thừa Core
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('raw_logs')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'raw_logs'
              ? 'border-[#021E73] text-[#021E73] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <Clock className="size-4" />
            <span>3. Log & Dữ liệu chấm công</span>
            <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0 border-none">
              {attendances.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('adjustments')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'adjustments'
              ? 'border-[#021E73] text-[#021E73] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <CheckCircle2 className="size-4" />
            <span>4. Bổ sung & Sửa công</span>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0 border-none">
              {corrections.filter((c) => c.status === 'PENDING').length} chờ duyệt
            </Badge>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 1: ĐỊNH NGHĨA CA (SHIFT DEFINITIONS)                   */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'definitions' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Tìm mã ca, tên ca làm việc..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Tất cả ({shifts.length})
                </button>
                <button
                  onClick={() => setStatusFilter('ACTIVE')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${statusFilter === 'ACTIVE'
                    ? 'bg-white text-emerald-700 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Đang dùng ({shifts.filter((s) => s.status === 'ACTIVE').length})
                </button>
                <button
                  onClick={() => setStatusFilter('INACTIVE')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${statusFilter === 'INACTIVE'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Tạm dừng ({shifts.filter((s) => s.status === 'INACTIVE').length})
                </button>
              </div>
            </div>

            <Button
              size="sm"
              className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs shrink-0"
              onClick={() => {
                setEditingShift(null);
                setShiftForm({
                  code: 'CA-NEW-' + (shifts.length + 1),
                  name: '',
                  startTime: '08:00',
                  endTime: '17:30',
                  breakMinutes: 60,
                  breakStartTime: '12:00',
                  breakEndTime: '13:00',
                  crossMidnight: false,
                  graceLateMinutes: 10,
                  graceEarlyMinutes: 5,
                  status: 'ACTIVE',
                });
                setIsAddShiftOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              <span>Thêm ca làm việc</span>
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Mã ca</th>
                    <th className="py-3.5 px-4">Tên ca làm việc</th>
                    <th className="py-3.5 px-4">Khung giờ chuẩn</th>
                    <th className="py-3.5 px-4 text-center">Nghỉ giữa ca</th>
                    <th className="py-3.5 px-4 text-center">Công chuẩn (giờ)</th>
                    <th className="py-3.5 px-4 text-center">Ca qua đêm</th>
                    <th className="py-3.5 px-4 text-center">Dung sai trễ / sớm</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách ca từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredShifts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Không tìm thấy ca làm việc nào phù hợp.
                      </td>
                    </tr>
                  ) : (
                    filteredShifts.map((shift) => (
                      <tr key={shift.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                            {shift.code}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-900 block text-xs">{shift.name}</span>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5">
                            <Clock className="size-3.5 text-blue-700" />
                            <span>
                              {shift.startTime?.slice(0, 5)} - {shift.endTime?.slice(0, 5)}
                              {shift.crossMidnight ? ' (+1)' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="font-mono font-semibold text-slate-700">{shift.breakMinutes} phút</span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="font-mono font-semibold text-slate-700">{computeShiftStandardHours(shift) ?? '-'}</span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {shift.crossMidnight ? (
                            <Badge className="bg-purple-100 text-purple-800 border-purple-200 text-[10px]">
                              Qua đêm (+1)
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-slate-400">Không</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                          {shift.graceLateMinutes}p / {shift.graceEarlyMinutes}p
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {shift.status === 'ACTIVE' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              Đang dùng
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                              Tạm dừng
                            </Badge>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-blue-700 hover:bg-blue-50"
                              onClick={() => {
                                setSelectedShiftForDrawer(shift);
                                setIsShiftDrawerOpen(true);
                              }}
                            >
                              <Eye className="size-3.5 mr-1" />
                              Xem
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-slate-600 hover:bg-slate-100"
                              onClick={() => handleOpenEditShift(shift)}
                            >
                              <Edit className="size-3.5 mr-1" />
                              Sửa
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 2: BẢNG PHÂN CA ROSTER (THEO PHÒNG BAN & KẾ THỪA CORE) */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          <UnitShiftPanel shifts={shifts} />
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setRosterViewMode('ORG_LEVEL')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${rosterViewMode === 'ORG_LEVEL'
                    ? 'bg-[#021E73] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <Building2 className="size-3.5" />
                  <span>1. Phân ca theo Phòng ban (Kế thừa Core)</span>
                  <Badge className={`text-[10px] ml-1 px-1.5 py-0 border-none ${rosterViewMode === 'ORG_LEVEL' ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 text-slate-700'
                    }`}>
                    {departmentHierarchyList.length} đơn vị
                  </Badge>
                </button>

                <button
                  type="button"
                  onClick={() => setRosterViewMode('INDIVIDUAL_EXCEPTIONS')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${rosterViewMode === 'INDIVIDUAL_EXCEPTIONS'
                    ? 'bg-[#021E73] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <Users className="size-3.5" />
                  <span>2. Danh sách Ngoại lệ / Đổi ca cá nhân</span>
                  <Badge className={`text-[10px] ml-1 px-1.5 py-0 border-none ${rosterViewMode === 'INDIVIDUAL_EXCEPTIONS' ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 text-slate-700'
                    }`}>
                    {assignments.length} bản ghi
                  </Badge>
                </button>
              </div>

              {rosterViewMode === 'INDIVIDUAL_EXCEPTIONS' && (
                <div className="flex items-center gap-2">
                  <div className="w-56">
                    <SearchableSelect
                      placeholder="Lọc phòng ban..."
                      options={departmentOptions}
                      value={selectedDeptFilter}
                      onChange={(val) => setSelectedDeptFilter(val || 'ALL')}
                    />
                  </div>
                  <div className="relative w-56">
                    <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <Input
                      placeholder="Tìm nhân viên ngoại lệ..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 text-xs h-8"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <a
                href="/modules/hrm/policies"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-blue-300 bg-blue-50/60 hover:bg-blue-100 text-blue-900 text-xs font-semibold shadow-xs"
                title="Lịch làm / OFF / lễ và công chuẩn tháng được cấu hình tại Cấu hình công & thiết bị"
              >
                <Settings2 className="size-3.5 text-blue-700" />
                <span>Mở Cấu hình công &amp; thiết bị</span>
              </a>
              <span className="text-[11px] text-slate-500 max-w-[260px] leading-tight">
                Lịch làm / OFF / lễ và công chuẩn tháng được cấu hình tại đó.
              </span>

              {rosterViewMode === 'INDIVIDUAL_EXCEPTIONS' ? (
                <Button
                  size="sm"
                  className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white gap-1.5 shadow-xs"
                  onClick={() => {
                    setAssignTargetDept(selectedDeptFilter);
                    setAssignEmployeeId('');
                    setIsAssignModalOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  <span>Thêm ca ngoại lệ mới</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-slate-300 hover:bg-slate-100 text-slate-700 gap-1.5 shadow-xs"
                  onClick={() => {
                    setAssignTargetDept(selectedOrgUnit);
                    setAssignEmployeeId('');
                    setIsAssignModalOpen(true);
                  }}
                  title="Gán ca ngoại lệ theo cá nhân (hoặc bấm trực tiếp nút Gán ngoại lệ ở từng dòng phòng ban)"
                >
                  <Users className="size-3.5 text-slate-600" />
                  <span>Gán ca ngoại lệ</span>
                </Button>
              )}
            </div>
          </div>

          {/* VIEW MODE 1: PHÂN CA CẤP PHÒNG BAN (HIERARCHICAL ORGANIZATIONAL MATRIX) */}
          {rosterViewMode === 'ORG_LEVEL' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Organizational Units Tree / List */}
              <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="size-4 text-[#021E73]" />
                    <span className="font-bold text-xs text-slate-900">Cơ cấu Phòng ban (Core)</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {departmentHierarchyList.length} phòng ban
                  </span>
                </div>

                <div className="space-y-1.5 max-h-[580px] overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedOrgUnit('ALL')}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all flex items-center justify-between ${selectedOrgUnit === 'ALL'
                      ? 'bg-blue-50/80 border-blue-300 text-blue-900 font-bold shadow-xs'
                      : 'border-slate-100 hover:bg-slate-50 text-slate-700'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="size-3.5 text-blue-700" />
                      <span>Toàn bộ phòng ban công ty</span>
                    </div>
                    <Badge className="bg-white text-blue-800 border border-blue-200 text-[10px]">
                      {employees.length} NV
                    </Badge>
                  </button>

                  {departmentHierarchyList.map((dept) => {
                    const isSelected = selectedOrgUnit === dept.name;
                    return (
                      <button
                        key={dept.name}
                        type="button"
                        onClick={() => setSelectedOrgUnit(dept.name)}
                        className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all flex items-center justify-between ${isSelected
                          ? 'bg-blue-50/80 border-blue-300 text-blue-900 font-bold shadow-xs'
                          : 'border-slate-100 hover:bg-slate-50 text-slate-700'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className="size-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{dept.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="text-[10px] text-slate-500 font-mono">
                            {dept.count} NV
                          </span>
                          <ChevronRight className="size-3 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                  <div className="flex items-center gap-1 text-[#021E73] font-bold">
                    <Sparkles className="size-3" />
                    <span>Quy tắc Kế thừa ca:</span>
                  </div>
                  <p>
                    Ma trận tổng hợp ca đang được phân cho nhân sự của từng phòng ban (kèm số người) từ danh mục ca thật.
                  </p>
                </div>
              </div>

              {/* Right Column: 7-Day Matrix by Department */}
              <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-xs">
                        Ma trận Ca chuẩn cấp Phòng ban (Đa ca: Sáng / Chiều / T7)
                      </h3>
                      {selectedOrgUnit !== 'ALL' && (
                        <Badge className="bg-blue-100 text-blue-900 border-none font-medium text-[11px]">
                          {selectedOrgUnit}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Hiển thị ca thực tế theo phân ca của nhân sự trong từng phòng ban, đọc từ danh mục ca đã tạo.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="/modules/hrm/policies"
                      className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-md border border-blue-300 bg-blue-50/60 hover:bg-blue-100 text-blue-900 text-xs font-semibold"
                    >
                      <Settings2 className="size-3.5 text-blue-700" />
                      <span>Mở Cấu hình công &amp; thiết bị</span>
                    </a>
                  </div>
                </div>

                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      <tr>
                        <th className="py-3 px-3.5 min-w-[200px] sticky left-0 bg-slate-50 z-10 border-r">Phòng ban / Đơn vị</th>
                        <th className="py-3 px-2 min-w-[65px] text-center">Quy mô</th>
                        {currentWeekDays.map((day) => (
                          <th
                            key={day.iso}
                            className={`py-3 px-2 text-center min-w-[130px] ${day.isToday ? 'bg-blue-50/70 text-blue-900 font-extrabold' : ''
                              } ${day.isWeekend ? 'bg-slate-100/60' : ''}`}
                          >
                            <div>{day.label}</div>
                          </th>
                        ))}
                        <th className="py-3 px-3 text-center min-w-[100px]">Ngoại lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {(selectedOrgUnit === 'ALL'
                        ? departmentHierarchyList
                        : departmentHierarchyList.filter((d) => d.name === selectedOrgUnit)
                      ).map((dept) => {
                        const deptOverrides = deptShiftMap[dept.name] || {};
                        const hasAnyOverride = Object.keys(deptOverrides).length > 0;

                        return (
                          <tr key={dept.name} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-3.5 sticky left-0 bg-white z-10 border-r shadow-xs">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold text-slate-900 block text-xs">{dept.name}</span>
                                {hasAnyOverride ? (
                                  <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[9px] px-1 py-0">
                                    Đã tùy biến
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] text-slate-400 border-slate-200 px-1 py-0">
                                    Theo phân ca
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-slate-400">Đơn vị trực thuộc Core</span>
                                {hasAnyOverride && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeptShiftMap((prev) => {
                                        const clone = { ...prev };
                                        delete clone[dept.name];
                                        return clone;
                                      });
                                      toast.add({
                                        title: 'Đã khôi phục ca kế thừa',
                                        description: `${dept.name} đã được khôi phục về lịch chuẩn của công ty mẹ.`,
                                        type: 'info',
                                      });
                                    }}
                                    className="text-[10px] text-blue-600 hover:underline"
                                    title="Khôi phục về lịch công ty mẹ"
                                  >
                                    Khôi phục gốc
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-2 text-center font-mono font-bold text-slate-700">
                              {dept.count} NV
                            </td>

                            {/* 7 Days of the Week */}
                            {currentWeekDays.map((day) => {
                              // Ca thực tế: đọc từ phân ca (shift_assignments) của nhân sự trong phòng ban
                              // và danh mục ca (shift_definitions) trong CSDL, không dùng lịch cố định.
                              const cellShifts = deptDayShifts(dept.employees, day.iso);
                              const isCustom = false;
                              const isOff = false;

                              return (
                                <td
                                  key={day.iso}
                                  className={`py-2 px-1.5 text-center relative ${day.isToday ? 'bg-blue-50/30' : ''} ${day.isWeekend ? 'bg-slate-50/50' : ''
                                    }`}
                                >
                                  {/* Button Trigger mở Popover tại ô */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (activeCellPopover?.deptName === dept.name && activeCellPopover?.dayIso === day.iso) {
                                        setActiveCellPopover(null);
                                      } else {
                                        setActiveCellPopover({
                                          deptName: dept.name,
                                          dayIso: day.iso,
                                          dayLabel: day.label,
                                          currentShifts: cellShifts,
                                          currentIsOff: isOff,
                                          isCustomOverride: isCustom,
                                        });
                                      }
                                    }}
                                    className="w-full text-left group focus:outline-none"
                                    title="Nhấp chuột để mở bảng thao tác trực tiếp tại ô này"
                                  >
                                    {isOff || cellShifts.length === 0 ? (
                                      <div className="w-full text-[10px] font-bold text-slate-400 bg-slate-100 hover:bg-slate-200 group-hover:border-blue-400 px-1.5 py-2.5 rounded border border-slate-200 transition-all text-center">
                                        <span>Chưa phân ca</span>
                                        {isCustom && (
                                          <span className="block text-[8px] text-amber-600 font-mono mt-0.5">● Tùy biến</span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        {/* Danh sách các ca trong ngày (Ca 1, Ca 2, Ca 3...) */}
                                        {cellShifts.map((shiftItem, shiftIndex) => {
                                          return (
                                            <div
                                              key={shiftIndex}
                                              className={`p-1.5 rounded border transition-all text-left ${activeCellPopover?.deptName === dept.name && activeCellPopover?.dayIso === day.iso
                                                ? 'ring-2 ring-blue-600 shadow-md'
                                                : 'group-hover:border-blue-400 group-hover:shadow-xs'
                                                } ${shiftIndex === 0
                                                  ? 'bg-blue-50/70 border-blue-200/80 text-blue-950'
                                                  : shiftIndex === 1
                                                    ? 'bg-indigo-50/80 border-indigo-200/90 text-indigo-950'
                                                    : 'bg-emerald-50/80 border-emerald-200/90 text-emerald-950'
                                                }`}
                                            >
                                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                                <div className="flex items-center gap-1 min-w-0">
                                                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 font-mono">
                                                    Ca {shiftIndex + 1}:
                                                  </span>
                                                  <span className="font-mono font-bold text-[11px] text-[#021E73] truncate">
                                                    {shiftItem.shiftCode}
                                                  </span>
                                                </div>
                                                <Badge className="text-[8px] px-1 py-0 bg-white border border-slate-200 text-slate-700 shrink-0 font-mono">
                                                  {shiftItem.workHours}h
                                                </Badge>
                                              </div>
                                              <div className="text-[10px] text-slate-600 truncate font-medium">
                                                {shiftItem.shiftName}
                                              </div>
                                              {shiftItem.breakMinutes !== undefined && shiftItem.breakMinutes > 0 && (
                                                <div className="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1">
                                                  <Clock className="size-2.5 text-slate-400" />
                                                  <span>Nghỉ {shiftItem.breakMinutes}p</span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}

                                        {isCustom && (
                                          <div className="text-[9px] text-amber-600 font-mono text-right">
                                            ● Tùy biến riêng
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </button>

                                  {/* POPOVER NỘI BỘ XUẤT HIỆN TRỰC TIẾP TẠI GIAO ĐIỂM HÀNG X CỘT */}
                                  {activeCellPopover?.deptName === dept.name && activeCellPopover?.dayIso === day.iso && (
                                    <>
                                      {/* Backdrop click outside để đóng Popover */}
                                      <div
                                        className="fixed inset-0 z-40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveCellPopover(null);
                                        }}
                                      />

                                      {/* Khung Popover */}
                                      <div
                                        className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-84 bg-white rounded-xl shadow-xl border border-slate-300 p-3.5 text-left text-xs animate-in fade-in zoom-in-95 duration-100"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="flex items-start justify-between border-b pb-2 mb-2.5">
                                          <div>
                                            <span className="font-bold text-slate-900 block text-xs">
                                              {dept.name}
                                            </span>
                                            <span className="text-[11px] text-blue-700 font-mono">
                                              {day.label}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => setActiveCellPopover(null)}
                                            className="text-slate-400 hover:text-slate-700 p-0.5 rounded"
                                            title="Đóng popover"
                                          >
                                            <X className="size-3.5" />
                                          </button>
                                        </div>

                                        <div className="space-y-2.5">
                                          {/* Nguồn quy tắc hiện tại */}
                                          <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 text-[11px] flex items-center justify-between">
                                            <span className="text-slate-500">Nguồn ca áp dụng:</span>
                                            {isCustom ? (
                                              <Badge className="bg-amber-100 text-amber-800 border-none font-medium text-[10px]">
                                                Ghi đè tại phòng ban
                                              </Badge>
                                            ) : (
                                              <Badge className="bg-blue-100 text-blue-900 border-none font-medium text-[10px]">
                                                Theo phân ca nhân sự
                                              </Badge>
                                            )}
                                          </div>

                                          {/* Chế độ chỉ xem: lịch phòng ban được chỉnh ở Cấu hình công & thiết bị */}
                                          <div className="p-2 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
                                            {isOff ? (
                                              <span className="font-semibold text-slate-700 text-[11px]">Nghỉ cả ngày (OFF)</span>
                                            ) : (
                                              <>
                                                <span className="text-slate-700 font-bold text-[11px] block">
                                                  Ca làm việc trong ngày ({cellShifts.length} ca):
                                                </span>
                                                {cellShifts.map((sh, idx) => (
                                                  <div key={idx} className="text-[11px] text-slate-800 font-mono">
                                                    Ca {idx + 1}: [{sh.shiftCode}] {sh.shiftName}
                                                  </div>
                                                ))}
                                              </>
                                            )}
                                          </div>
                                          <p className="text-[11px] text-slate-500">
                                            Chỉ xem. Chỉnh sửa lịch làm / OFF / lễ ở{' '}
                                            <a className="font-semibold text-blue-700 hover:underline" href="/modules/hrm/policies">
                                              Cấu hình công &amp; thiết bị
                                            </a>
                                            .
                                          </p>

                                          {/* Hành động nhanh */}
                                          <div className="pt-2 border-t flex flex-col gap-1.5">
                                            {/* Nút Gán ngoại lệ cá nhân đúng ngày này */}
                                            <Button
                                              type="button"
                                              size="sm"
                                              className="w-full h-7 text-[11px] bg-[#021E73] hover:bg-blue-900 text-white justify-center gap-1 font-semibold"
                                              onClick={() => {
                                                setAssignTargetDept(dept.name);
                                                setAssignEffectiveFrom(day.iso);
                                                setAssignEffectiveTo(day.iso);
                                                setAssignEmployeeId('');
                                                setActiveCellPopover(null);
                                                setIsAssignModalOpen(true);
                                              }}
                                            >
                                              <Users className="size-3" />
                                              <span>Gán ngoại lệ cho NV ngày này</span>
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </td>
                              );
                            })}

                            {/* Cột Ngoại lệ theo từng phòng ban */}
                            <td className="py-2 px-2 text-center">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] px-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-slate-700 hover:text-blue-900 gap-1"
                                onClick={() => {
                                  setAssignTargetDept(dept.name);
                                  setAssignEmployeeId('');
                                  setIsAssignModalOpen(true);
                                }}
                                title={`Gán ca ngoại lệ cho nhân viên thuộc ${dept.name}`}
                              >
                                <Plus className="size-3 text-blue-600" />
                                <span>Gán ngoại lệ</span>
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-[#021E73]" />
                    <span>
                      <b>Quy chuẩn Hành chính / Công ty nhà nước:</b> T2–T6 có cả Ca Sáng + Ca Chiều, Thứ 7 chỉ làm Ca Sáng, Chủ nhật nghỉ OFF.
                    </span>
                  </div>
                  <span className="font-mono text-slate-400">Hiển thị {departmentHierarchyList.length} phòng ban</span>
                </div>
              </div>
            </div>
          )}

          {/* VIEW MODE 2: DANH SÁCH NGOẠI LỆ / CÁ NHÂN ĐỔI CA (INDIVIDUAL EXCEPTION OVERRIDES) */}
          {rosterViewMode === 'INDIVIDUAL_EXCEPTIONS' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <Filter className="size-3.5 text-[#021E73]" />
                    <span>Danh sách phân ca ngoại lệ cá nhân (Override Entries)</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Chỉ hiển thị các nhân sự có lịch trực đặc biệt, ca đêm hoặc hoán đổi ca khác với ca mặc định của phòng ban.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="py-3 px-4 min-w-[170px] sticky left-0 bg-slate-50 z-10 border-r">Nhân viên</th>
                      <th className="py-3 px-4 min-w-[140px]">Bộ phận</th>
                      {currentWeekDays.map((day) => (
                        <th
                          key={day.iso}
                          className={`py-3 px-3 text-center min-w-[110px] ${day.isToday ? 'bg-blue-50/70 text-blue-900 font-extrabold' : ''
                            } ${day.isWeekend ? 'bg-slate-100/60' : ''}`}
                        >
                          <div>{day.label}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {isLoading ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                          <span>Đang tải danh sách phân ca...</span>
                        </td>
                      </tr>
                    ) : filteredRosterEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          Không tìm thấy nhân viên nào phù hợp bộ lọc.
                        </td>
                      </tr>
                    ) : (
                      filteredRosterEmployees.map((emp) => {
                        const empAssignments = assignments.filter((a) => a.employeeId === emp.employeeId && a.status === 'ACTIVE');
                        const primaryShift = empAssignments[0];

                        return (
                          <tr key={emp.employeeId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4 sticky left-0 bg-white z-10 border-r shadow-xs">
                              <span className="font-bold text-slate-900 block text-xs">{emp.fullName}</span>
                              <span className="text-[11px] text-slate-500 font-mono">{emp.employeeCode}</span>
                            </td>
                            <td className="py-3 px-4 text-slate-600">{emp.department || 'Chưa gán'}</td>
                            {currentWeekDays.map((day) => {
                              const isWeekend = day.isWeekend;
                              return (
                                <td
                                  key={day.iso}
                                  className={`py-3 px-2 text-center ${day.isToday ? 'bg-blue-50/30' : ''} ${isWeekend ? 'bg-slate-50/50' : ''
                                    }`}
                                >
                                  {isWeekend ? (
                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                      OFF
                                    </span>
                                  ) : primaryShift ? (
                                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-mono">
                                      {primaryShift.shiftCode || 'CA'}
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                      Theo phòng ban
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 3: LOG & DỮ LIỆU CHẤM CÔNG (PROCESSED & RAW)           */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'raw_logs' && (
        <div className="space-y-4">
          {/* Top Control Bar: Chế độ hiển thị & Nút làm mới */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Chế độ hiển thị:</span>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('MATRIX')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${attendanceViewMode === 'MATRIX'
                    ? 'bg-white text-[#021E73] shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Bảng công ma trận tháng (Chuẩn kỳ)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('PROCESSED')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${attendanceViewMode === 'PROCESSED'
                    ? 'bg-white text-[#021E73] shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Bản ghi công tổng hợp (Mode A)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('RAW_EVENTS')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${attendanceViewMode === 'RAW_EVENTS'
                    ? 'bg-white text-[#021E73] shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Sự kiện quẹt thẻ thô (Mode B)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() => void loadAllData()}
              >
                <RefreshCw className="size-3.5 mr-1" />
                <span>Làm mới log CSDL</span>
              </Button>
            </div>
          </div>

          {/* VIEW 1: BẢNG CÔNG MA TRẬN THÁNG (TOÀN THỂ NHÂN VIÊN - MỖI NHÂN SỰ 1 HÀNG CÓ CON LĂN) */}
          {attendanceViewMode === 'MATRIX' && (
            <MonthlyAttendanceMatrixTable
              employees={employees.map((emp) => ({
                employeeId: emp.employeeId,
                employeeCode: emp.employeeCode,
                fullName: emp.fullName || emp.employeeCode || 'Nhân viên',
                department: emp.department,
                position: emp.position,
              }))}
              attendances={attendances.map((a) => ({
                id: a.id,
                employeeId: a.employeeId,
                workDate: String(a.workDate),
                checkInAt: a.checkInAt,
                checkOutAt: a.checkOutAt,
                status: a.status,
                workedMinutes: a.workedMinutes,
                note: a.note,
              }))}
              leaveRequests={leaveRequests}
              isLoading={isLoading}
              isSingleEmployeeMode={false}
              onExplainRequest={(attendanceId) => {
                const found = attendances.find((x) => x.id === attendanceId);
                if (found) {
                  toast.add({
                    title: 'Bản ghi chấm công',
                    description: `Ngày ${String(found.workDate).slice(0, 10)} - NV: ${found.employeeId}`,
                    type: 'info',
                  });
                }
              }}
            />
          )}

          {/* VIEW 2 & 3: DANH SÁCH BẢN GHI PHẲNG (PROCESSED HOẶC RAW_EVENTS) */}
          {attendanceViewMode !== 'MATRIX' && (
            <>
              {/* Filter Bar: Lọc theo nhân viên, trạng thái công, khoảng ngày làm việc */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-[#021E73]" />
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Bộ lọc dữ liệu chấm công
                </span>
                <Badge className="bg-blue-50 text-blue-800 text-[11px] font-bold px-2 py-0.5 border border-blue-200">
                  {filteredAttendances.length} / {attendances.length} bản ghi
                </Badge>
              </div>

              {(attFilterEmployeeId !== 'ALL' || attFilterStatus !== 'ALL' || attFilterDateFrom || attFilterDateTo) && (
                <button
                  onClick={() => {
                    setAttFilterEmployeeId('ALL');
                    setAttFilterStatus('ALL');
                    setAttFilterDateFrom('');
                    setAttFilterDateTo('');
                  }}
                  className="text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <X className="size-3.5" />
                  <span>Xóa tất cả bộ lọc</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {/* Filter 1: Nhân viên - SearchableSelect chuẩn Direct Combobox */}
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Theo nhân sự</label>
                <SearchableSelect
                  placeholder="Tìm mã hoặc tên nhân viên (gõ tiếng Việt không dấu)..."
                  emptyText="Không tìm thấy nhân viên phù hợp"
                  options={allEmployeeSelectOptions}
                  value={attFilterEmployeeId}
                  onChange={(val) => setAttFilterEmployeeId(val || 'ALL')}
                  clearable
                />
              </div>

              {/* Filter 2: Trạng thái công - SearchableSelect */}
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Theo trạng thái công</label>
                <SearchableSelect
                  placeholder="Chọn hoặc tìm trạng thái..."
                  emptyText="Không tìm thấy trạng thái phù hợp"
                  options={[
                    { value: 'ALL', label: '' },
                    { value: 'VALID', label: 'Hợp lệ (Đúng giờ)', description: 'Chấm công chuẩn giờ ca' },
                    { value: 'LATE', label: 'Đi muộn', description: 'Vào ca muộn hơn dung sai' },
                    { value: 'EARLY_LEAVE', label: 'Về sớm', description: 'Ra ca sớm hơn dung sai' },
                    { value: 'NO_CHECKOUT', label: 'Chưa Checkout (Quên quẹt ra)', description: 'Chỉ có giờ vào, thiếu giờ ra' },
                    { value: 'APPROVED_CORRECTION', label: 'Đã giải trình sửa công', description: 'Đã được duyệt bổ sung/điều chỉnh' },
                  ]}
                  value={attFilterStatus}
                  onChange={(val) => setAttFilterStatus(val || 'ALL')}
                  clearable
                />
              </div>

              {/* Filter 3: Từ ngày - DatePickerInput định dạng chuẩn DD/MM/YYYY */}
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Từ ngày làm việc</label>
                <DatePickerInput
                  placeholder="dd/mm/yyyy"
                  value={attFilterDateFrom}
                  onChange={(isoDate) => setAttFilterDateFrom(isoDate)}
                />
              </div>

              {/* Filter 4: Đến ngày - DatePickerInput định dạng chuẩn DD/MM/YYYY */}
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Đến ngày làm việc</label>
                <DatePickerInput
                  placeholder="dd/mm/yyyy"
                  value={attFilterDateTo}
                  onChange={(isoDate) => setAttFilterDateTo(isoDate)}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Ngày làm việc</th>
                    <th className="py-3.5 px-4">Mã nhân sự</th>
                    <th className="py-3.5 px-4">Giờ Check-in</th>
                    <th className="py-3.5 px-4">Giờ Check-out</th>
                    <th className="py-3.5 px-4 text-center">Số phút làm việc</th>
                    <th className="py-3.5 px-4 text-center">Nguồn dữ liệu</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái công</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải dữ liệu công từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredAttendances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        {attendances.length === 0
                          ? 'Chưa có bản ghi chấm công nào được ghi nhận trong CSDL.'
                          : 'Không tìm thấy bản ghi chấm công nào phù hợp với điều kiện lọc đã chọn.'}
                      </td>
                    </tr>
                  ) : (
                    filteredAttendances.map((att) => {
                      const emp = employees.find((e) => e.employeeId === att.employeeId);
                      return (
                        <tr key={att.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                            {String(att.workDate).slice(0, 10)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {emp ? emp.fullName : att.employeeId}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {emp ? `${emp.employeeCode} • ${emp.department}` : att.employeeId}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono">
                            {att.checkInAt ? (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                                {new Date(att.checkInAt).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-normal">--:--</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono">
                            {att.checkOutAt ? (
                              <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold">
                                {new Date(att.checkOutAt).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            ) : (
                              <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-mono text-[11px]">
                                Chưa checkout
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">
                            {att.workedMinutes} phút
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[10px]">
                              {att.attendanceSource}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {att.status === 'VALID' && (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                Hợp lệ
                              </Badge>
                            )}
                            {att.status === 'LATE' && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                                Đi muộn
                              </Badge>
                            )}
                            {att.status === 'EARLY_LEAVE' && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                                Về sớm
                              </Badge>
                            )}
                            {att.status === 'APPROVED_CORRECTION' && (
                              <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">
                                Đã sửa công
                              </Badge>
                            )}
                            {att.status !== 'VALID' &&
                              att.status !== 'LATE' &&
                              att.status !== 'EARLY_LEAVE' &&
                              att.status !== 'APPROVED_CORRECTION' && (
                                <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-[10px]">
                                  {att.status}
                                </Badge>
                              )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 4: BỔ SUNG & SỬA CÔNG (CORRECTIONS & APPROVALS)        */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'adjustments' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Hàng đợi Giải trình & Sửa đổi công chờ HR xét duyệt</h3>
              <p className="text-xs text-slate-500">
                Các yêu cầu quên quẹt thẻ, lỗi thiết bị thu nhận, được đối chiếu trực tiếp giữa giờ quẹt gốc và giờ giải trình đề xuất.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Mã đơn</th>
                    <th className="py-3.5 px-4">Nhân sự giải trình</th>
                    <th className="py-3.5 px-4">Ngày cần sửa</th>
                    <th className="py-3.5 px-4">Giờ quẹt gốc (In - Out)</th>
                    <th className="py-3.5 px-4">Giờ đề xuất sửa</th>
                    <th className="py-3.5 px-4 min-w-[200px]">Lý do giải trình</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center min-w-[140px]">Thao tác duyệt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách giải trình...</span>
                      </td>
                    </tr>
                  ) : corrections.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Hiện tại không có đơn giải trình công nào cần xử lý.
                      </td>
                    </tr>
                  ) : (
                    corrections.map((corr) => {
                      const emp = employees.find((e) => e.employeeId === corr.employeeId);
                      const isPending = corr.status === 'PENDING';

                      const formatTimeOnly = (iso?: string | null) => {
                        if (!iso) return '--:--';
                        try {
                          return new Date(iso).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                        } catch {
                          return iso.slice(11, 16);
                        }
                      };

                      return (
                        <tr key={corr.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-blue-700">
                            {corr.id.slice(0, 8)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {emp ? emp.fullName : corr.employeeId}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {emp ? `${emp.employeeCode} • ${emp.department}` : ''}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {String(corr.requestDate).slice(0, 10)}
                          </td>
                          <td className="py-3 px-4 font-mono text-red-600 bg-red-50/50 px-2 py-1 rounded">
                            {formatTimeOnly(corr.oldCheckInAt)} - {formatTimeOnly(corr.oldCheckOutAt)}
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-700 bg-emerald-50 px-2 py-1 rounded font-bold">
                            {formatTimeOnly(corr.newCheckInAt)} - {formatTimeOnly(corr.newCheckOutAt)}
                          </td>
                          <td className="py-3 px-4 text-slate-600">{corr.reason}</td>
                          <td className="py-3 px-4 text-center">
                            {corr.status === 'PENDING' && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                                Chờ duyệt
                              </Badge>
                            )}
                            {corr.status === 'APPROVED' && (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                                Đã phê duyệt
                              </Badge>
                            )}
                            {corr.status === 'REJECTED' && (
                              <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px]">
                                Từ chối
                              </Badge>
                            )}
                            {corr.status === 'CANCELLED' && (
                              <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                                Đã hủy
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-slate-600 hover:bg-slate-100 px-2"
                                onClick={() => {
                                  setSelectedCorrection(corr);
                                  setIsCorrectionDrawerOpen(true);
                                }}
                              >
                                <Eye className="size-3.5 mr-1" />
                                Xem
                              </Button>

                              {isPending && (
                                <>
                                  <Popconfirm
                                    title="Phê duyệt đơn giải trình công?"
                                    description="Giờ công đề xuất sẽ được áp dụng trực tiếp vào bảng công tổng hợp của nhân sự."
                                    onConfirm={() => handleApproveCorrection(corr.id)}
                                  >
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5"
                                    >
                                      Duyệt
                                    </Button>
                                  </Popconfirm>

                                  <Popconfirm
                                    title="Từ chối đơn giải trình này?"
                                    description="Đơn sẽ bị đánh dấu REJECTED và không cập nhật vào bảng công."
                                    onConfirm={() => handleRejectCorrection(corr.id)}
                                  >
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 px-2"
                                    >
                                      Từ chối
                                    </Button>
                                  </Popconfirm>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* DIALOG: THÊM / CẬP NHẬT CA LÀM VIỆC                            */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={isAddShiftOpen} onOpenChange={setIsAddShiftOpen}>
        <DialogContent className="max-w-lg p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-base">
              {editingShift ? `Cập nhật ca: ${editingShift.code}` : 'Thêm ca làm việc mới'}
            </h3>
            <p className="text-xs text-slate-500">
              Cấu hình các tham số giờ bắt đầu, kết thúc, nghỉ giữa ca và dung sai chấm công.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Mã ca làm việc *</label>
                <Input
                  placeholder="Ví dụ: HC-STD, CA-SANG"
                  value={shiftForm.code}
                  disabled={!!editingShift}
                  onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value.toUpperCase() })}
                  className="h-8 text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Tên ca làm việc *</label>
                <Input
                  placeholder="Ví dụ: Hành chính tiêu chuẩn"
                  value={shiftForm.name}
                  onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Giờ bắt đầu (In) *</label>
                <TimeTextInput
  value={shiftForm.startTime}
  onChange={(v: string) => setShiftForm({ ...shiftForm, startTime: v })}
  className="h-8 text-xs font-mono"
/>
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Giờ kết thúc (Out) *</label>
                <TimeTextInput
  value={shiftForm.endTime}
  onChange={(v: string) => setShiftForm({ ...shiftForm, endTime: v })}
  className="h-8 text-xs font-mono"
/>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Thời gian nghỉ (phút)</label>
                <Input
                  type="number"
                  placeholder="60"
                  value={shiftForm.breakMinutes}
                  onChange={(e) => {
                    const breakMinutes = Number(e.target.value) || 0;
                    setShiftForm({
                      ...shiftForm,
                      breakMinutes,
                      breakEndTime: addMinutesToTime(shiftForm.breakStartTime, breakMinutes),
                    });
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="crossMidnight"
                  checked={shiftForm.crossMidnight}
                  onChange={(e) => setShiftForm({ ...shiftForm, crossMidnight: e.target.checked })}
                  className="size-4 text-[#021E73] rounded border-slate-300"
                />
                <label htmlFor="crossMidnight" className="text-slate-700 font-semibold cursor-pointer select-none">
                  Ca làm việc qua đêm (+1 ngày)
                </label>
              </div>
            </div>

            {shiftForm.breakMinutes > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-600 block mb-1 font-semibold">Giờ bắt đầu nghỉ *</label>
                  <TimeTextInput
  value={shiftForm.breakStartTime}
  onChange={(v: string) =>
                      setShiftForm({
                        ...shiftForm,
                        breakStartTime: v,
                        breakEndTime: addMinutesToTime(v, shiftForm.breakMinutes),
                      })
                    }
  className="h-8 text-xs font-mono"
/>
                </div>
                <div>
                  <label className="text-slate-600 block mb-1 font-semibold">Giờ kết thúc nghỉ *</label>
                  <TimeTextInput
  value={shiftForm.breakEndTime}
  onChange={(v: string) => setShiftForm({ ...shiftForm, breakEndTime: v })}
  className="h-8 text-xs font-mono"
/>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Dung sai đi muộn cho phép (phút)</label>
                <Input
                  type="number"
                  placeholder="10"
                  value={shiftForm.graceLateMinutes}
                  onChange={(e) => setShiftForm({ ...shiftForm, graceLateMinutes: Number(e.target.value) || 0 })}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Dung sai về sớm cho phép (phút)</label>
                <Input
                  type="number"
                  placeholder="5"
                  value={shiftForm.graceEarlyMinutes}
                  onChange={(e) => setShiftForm({ ...shiftForm, graceEarlyMinutes: Number(e.target.value) || 0 })}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Trạng thái áp dụng</label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={shiftForm.status === 'ACTIVE' ? 'default' : 'outline'}
                  className={`h-7 text-xs ${shiftForm.status === 'ACTIVE' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                  onClick={() => setShiftForm({ ...shiftForm, status: 'ACTIVE' })}
                >
                  Đang dùng
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={shiftForm.status === 'INACTIVE' ? 'default' : 'outline'}
                  className={`h-7 text-xs ${shiftForm.status === 'INACTIVE' ? 'bg-slate-700 text-white' : ''}`}
                  onClick={() => setShiftForm({ ...shiftForm, status: 'INACTIVE' })}
                >
                  Tạm dừng
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setIsAddShiftOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              disabled={isSubmitting}
              onClick={handleSaveShift}
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              <span>{editingShift ? 'Cập nhật thay đổi' : 'Lưu ca làm việc'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG: GÁN CA NGOẠI LỆ CHO NHÂN SỰ                            */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-base">Phân ca Ngoại lệ cho Nhân viên</h3>
            <p className="text-xs text-slate-500">
              Chỉ dùng khi nhân sự làm ca trực, ca đêm hoặc hoán đổi ca khác với ca mặc định của phòng ban.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Phòng ban / Đơn vị (Bộ lọc nhanh)</label>
              <SearchableSelect
                placeholder="Chọn phòng ban để lọc nhân viên..."
                options={departmentOptions}
                value={assignTargetDept}
                onChange={(val) => {
                  setAssignTargetDept(val || 'ALL');
                  setAssignEmployeeId(''); // Reset nhân sự khi đổi phòng ban
                }}
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                {assignTargetDept === 'ALL'
                  ? `Đang hiển thị toàn bộ ${employees.length} nhân sự công ty.`
                  : `Đã lọc hiển thị ${employeeSelectOptions.length} nhân sự thuộc phòng ${assignTargetDept}.`}
              </span>
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Chọn nhân sự ngoại lệ *</label>
              <SearchableSelect
                placeholder="Tìm chọn nhân viên..."
                options={employeeSelectOptions}
                value={assignEmployeeId}
                onChange={(val) => setAssignEmployeeId(val || '')}
              />
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Chọn ca làm việc *</label>
              <SearchableSelect
                placeholder="Chọn ca làm việc..."
                options={shiftSelectOptions}
                value={assignShiftId}
                onChange={(val) => setAssignShiftId(val || '')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Ngày bắt đầu hiệu lực *</label>
                <DatePickerInput
  value={assignEffectiveFrom}
  onChange={(v: string) => setAssignEffectiveFrom(v)}
/>
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Ngày kết thúc (Tùy chọn)</label>
                <DatePickerInput
  value={assignEffectiveTo}
  onChange={(v: string) => setAssignEffectiveTo(v)}
/>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setIsAssignModalOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              disabled={isSubmitting}
              onClick={handleCreateAssignment}
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              <span>Xác nhận phân ca</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DRAWER: CHI TIẾT ĐỊNH NGHĨA CA (5 KHỐI CHUẨN)                  */}
      {/* ------------------------------------------------------------- */}
      <Sheet open={isShiftDrawerOpen} onOpenChange={setIsShiftDrawerOpen}>
        <SheetContent className="overflow-y-auto">
          {selectedShiftForDrawer && (
            <div className="space-y-6">
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-900 border-blue-200 text-xs font-mono font-bold">
                    {selectedShiftForDrawer.code}
                  </Badge>
                  {selectedShiftForDrawer.status === 'ACTIVE' ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
                      Đang dùng
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs">
                      Tạm dừng
                    </Badge>
                  )}
                </div>
                <SheetTitle>{selectedShiftForDrawer.name}</SheetTitle>
                <SheetDescription>
                  Hồ sơ cấu hình kỹ thuật ca làm việc từ CSDL
                </SheetDescription>
              </SheetHeader>

              {/* Khối 1: Thông tin định danh */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <Sliders className="size-4 text-[#021E73]" />
                  <span>1. Thông tin định danh & Phân loại</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 block">Mã ca:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedShiftForDrawer.code}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Tên ca:</span>
                    <span className="font-bold text-slate-900">{selectedShiftForDrawer.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Ca qua đêm:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedShiftForDrawer.crossMidnight ? 'Có (+1 ngày)' : 'Không'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Mã UUID hệ thống:</span>
                    <span className="font-mono text-[11px] text-slate-600">{selectedShiftForDrawer.id}</span>
                  </div>
                </div>
              </div>

              {/* Khối 2: Khung giờ & Thời lượng */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <Clock className="size-4 text-blue-700" />
                  <span>2. Khung giờ & Phân đoạn nghỉ</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 block">Giờ bắt đầu:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {selectedShiftForDrawer.startTime?.slice(0, 5)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Giờ kết thúc:</span>
                    <span className="font-mono font-bold text-blue-700">
                      {selectedShiftForDrawer.endTime?.slice(0, 5)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Thời gian nghỉ:</span>
                    <span className="font-bold text-slate-800">{selectedShiftForDrawer.breakMinutes} phút</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Dung sai đi muộn:</span>
                    <span className="font-mono font-bold text-amber-700">{selectedShiftForDrawer.graceLateMinutes} phút</span>
                  </div>
                </div>
              </div>

              {/* Khối 3: Nhân sự đang gán ca này */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <Users className="size-4 text-emerald-700" />
                  <span>3. Nhân sự đang áp dụng ca này</span>
                </h4>
                {assignments.filter((a) => a.shiftId === selectedShiftForDrawer.id).length === 0 ? (
                  <p className="text-slate-400 italic">Chưa có nhân sự nào được gán ca này.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {assignments
                      .filter((a) => a.shiftId === selectedShiftForDrawer.id)
                      .map((a) => {
                        const emp = employees.find((e) => e.employeeId === a.employeeId);
                        return (
                          <div key={a.id} className="flex justify-between items-center bg-white p-2 rounded border border-slate-200">
                            <div>
                              <span className="font-bold text-slate-800 block text-xs">
                                {emp ? emp.fullName : a.employeeId}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                {emp ? emp.employeeCode : ''} • Từ {a.effectiveFrom}
                              </span>
                            </div>
                            <Badge className="bg-emerald-50 text-emerald-700 text-[10px]">Đang áp dụng</Badge>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setIsShiftDrawerOpen(false)}
                >
                  Đóng ngăn kéo
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white"
                  onClick={() => {
                    setIsShiftDrawerOpen(false);
                    handleOpenEditShift(selectedShiftForDrawer);
                  }}
                >
                  <Edit className="size-3 mr-1" />
                  <span>Chỉnh sửa ca</span>
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ------------------------------------------------------------- */}
      {/* DRAWER: CHI TIẾT ĐƠN GIẢI TRÌNH SỬA CÔNG                       */}
      {/* ------------------------------------------------------------- */}
      <Sheet open={isCorrectionDrawerOpen} onOpenChange={setIsCorrectionDrawerOpen}>
        <SheetContent className="overflow-y-auto">
          {selectedCorrection && (
            <div className="space-y-6">
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-900 border-blue-200 text-xs font-mono font-bold">
                    {selectedCorrection.id.slice(0, 8)}
                  </Badge>
                  {selectedCorrection.status === 'PENDING' && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                      CHỜ DUYỆT
                    </Badge>
                  )}
                  {selectedCorrection.status === 'APPROVED' && (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
                      ĐÃ PHÊ DUYỆT
                    </Badge>
                  )}
                  {selectedCorrection.status === 'REJECTED' && (
                    <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">
                      TỪ CHỐI
                    </Badge>
                  )}
                </div>
                <SheetTitle>Chi tiết Đơn giải trình & Điều chỉnh công</SheetTitle>
                <SheetDescription>
                  Đối chiếu giữa dữ liệu quẹt thẻ thực tế và giờ đề xuất sửa
                </SheetDescription>
              </SheetHeader>

              {/* Thông tin nhân viên */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <UserCheck className="size-4 text-[#021E73]" />
                  <span>Nhân viên gửi giải trình</span>
                </h4>
                {(() => {
                  const emp = employees.find((e) => e.employeeId === selectedCorrection.employeeId);
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-500 block">Họ và tên:</span>
                        <span className="font-bold text-slate-900">{emp ? emp.fullName : selectedCorrection.employeeId}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Mã nhân viên:</span>
                        <span className="font-mono font-bold text-blue-700">{emp ? emp.employeeCode : 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Phòng ban:</span>
                        <span className="text-slate-700">{emp ? emp.department : 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Ngày giải trình:</span>
                        <span className="font-mono font-bold text-slate-800">{String(selectedCorrection.requestDate).slice(0, 10)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Bảng đối chiếu Side-by-side */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Clock className="size-4 text-blue-700" />
                  <span>Đối chiếu giờ công (Gốc vs Đề xuất)</span>
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                    <span className="text-red-700 font-bold block mb-1">Dữ liệu gốc ban đầu</span>
                    <div className="space-y-1 text-slate-700 font-mono">
                      <div>Vào: {selectedCorrection.oldCheckInAt ? new Date(selectedCorrection.oldCheckInAt).toLocaleTimeString('vi-VN') : '--:--'}</div>
                      <div>Ra: {selectedCorrection.oldCheckOutAt ? new Date(selectedCorrection.oldCheckOutAt).toLocaleTimeString('vi-VN') : '--:--'}</div>
                    </div>
                  </div>

                  <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                    <span className="text-emerald-700 font-bold block mb-1">Đề xuất cập nhật</span>
                    <div className="space-y-1 text-emerald-900 font-mono font-bold">
                      <div>Vào: {selectedCorrection.newCheckInAt ? new Date(selectedCorrection.newCheckInAt).toLocaleTimeString('vi-VN') : '--:--'}</div>
                      <div>Ra: {selectedCorrection.newCheckOutAt ? new Date(selectedCorrection.newCheckOutAt).toLocaleTimeString('vi-VN') : '--:--'}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block font-semibold mb-1">Lý do giải trình:</span>
                  <div className="bg-white p-3 rounded-lg border border-slate-200 text-slate-800 text-xs">
                    {selectedCorrection.reason}
                  </div>
                </div>
              </div>

              {selectedCorrection.status === 'PENDING' && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Popconfirm
                    title="Từ chối đơn giải trình này?"
                    description="Đơn sẽ bị chuyển trạng thái sang REJECTED."
                    onConfirm={() => handleRejectCorrection(selectedCorrection.id)}
                  >
                    <Button variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200">
                      Từ chối đơn
                    </Button>
                  </Popconfirm>

                  <Popconfirm
                    title="Phê duyệt đơn giải trình công?"
                    description="Bản ghi công mới sẽ được ghi nhận vào hệ thống CSDL chấm công."
                    onConfirm={() => handleApproveCorrection(selectedCorrection.id)}
                  >
                    <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                      Phê duyệt & Áp dụng
                    </Button>
                  </Popconfirm>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
