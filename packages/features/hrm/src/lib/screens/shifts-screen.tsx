'use client';

import {
  Calendar,
  CheckCircle2,
  Clock,
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
  Filter,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { toast } from '../ui/toast';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  MonthlyAttendanceMatrixTable,
  type MatrixLeaveRequest,
} from '../ui/monthly-attendance-matrix-table';
import { hrmApiUrl } from '../hrm-api';
import { HrmRosterPanel } from '../ui/hrm-roster-panel';
import { HrmRawAttendancePanel } from '../ui/hrm-raw-attendance-panel';

type SubTabKey = 'definitions' | 'roster' | 'raw_logs' | 'adjustments';

interface ExtendedShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  updatedAt: string;
  tenantId: string;
  createdAt: string;
  positionId: string | null;
  source: 'MANUAL' | 'SCHEDULE_POLICY' | 'SWAP_REQUEST';
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  shiftCode?: string;
  shiftName?: string;
  startTime?: string;
  endTime?: string;
  employeeName?: string;
  employeeCode?: string;
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
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const assignedEmployeeCount = new Set(
    assignments
      .filter(
        (row) =>
          row.status === 'ACTIVE' &&
          row.effectiveFrom <= today &&
          (!row.effectiveTo || row.effectiveTo >= today),
      )
      .map((row) => row.employeeId),
  ).size;

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'ACTIVE' | 'INACTIVE'
  >('ALL');
  const [attendanceViewMode, setAttendanceViewMode] = useState<
    'MATRIX' | 'RAW_EVENTS' | 'PROCESSED'
  >('MATRIX');

  // Attendance Log Filters (Sub-tab 3)
  const [attFilterEmployeeId, setAttFilterEmployeeId] = useState<string>('ALL');
  const [attFilterStatus, setAttFilterStatus] = useState<string>('ALL');
  const [attFilterDateFrom, setAttFilterDateFrom] = useState<string>('');
  const [attFilterDateTo, setAttFilterDateTo] = useState<string>('');

  // Modals & Drawers
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<HrmShiftDefinition | null>(
    null,
  );
  const [selectedShiftForDrawer, setSelectedShiftForDrawer] =
    useState<HrmShiftDefinition | null>(null);
  const [isShiftDrawerOpen, setIsShiftDrawerOpen] = useState(false);

  // Correction Drawer
  const [selectedCorrection, setSelectedCorrection] =
    useState<HrmAttendanceCorrection | null>(null);
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

  // 1. Fetch Master Data from DB
  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [shiftsRes, assignRes, attRes, corrRes, empRes, leaveRes] =
        await Promise.all([
          fetch('/api/hrm/v1/shifts', { credentials: 'same-origin' }),
          fetch('/api/hrm/v1/shift-assignments', {
            credentials: 'same-origin',
          }),
          fetch('/api/hrm/v1/attendance', { credentials: 'same-origin' }),
          fetch('/api/hrm/v1/attendance-corrections', {
            credentials: 'same-origin',
          }),
          fetch('/api/hrm/v1/employees?page_size=100', {
            credentials: 'same-origin',
          }),
          fetch('/api/hrm/v1/leave-requests', { credentials: 'same-origin' }),
        ]);

      if (shiftsRes.ok) {
        const payload = await shiftsRes.json();
        setShifts(payload.data || []);
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
      const url = isEditing
        ? hrmApiUrl(`/shifts/${editingShift.id}`)
        : hrmApiUrl('/shifts');
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
          ...(editingShift
            ? { expectedUpdatedAt: editingShift.updatedAt }
            : {}),
        }),
      });

      if (res.ok) {
        toast.add({
          title: isEditing
            ? 'Đã cập nhật ca làm việc'
            : 'Tạo ca làm việc thành công',
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
          description:
            errPayload.message || 'Mã ca đã tồn tại hoặc dữ liệu không hợp lệ.',
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
      breakStartTime: shift.breakStartTime?.slice(0, 5) || '',
      breakEndTime: shift.breakEndTime?.slice(0, 5) || '',
      crossMidnight: shift.crossMidnight || false,
      graceLateMinutes: shift.graceLateMinutes ?? 10,
      graceEarlyMinutes: shift.graceEarlyMinutes ?? 5,
      status: shift.status || 'ACTIVE',
    });
    setIsAddShiftOpen(true);
  };

  const openCorrectionProcessing = (id: string) => {
    window.location.href =
      '/modules/hrm/approvals?request=' + encodeURIComponent(id);
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
      if (
        attFilterEmployeeId !== 'ALL' &&
        att.employeeId !== attFilterEmployeeId
      ) {
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
  }, [
    attendances,
    attFilterEmployeeId,
    attFilterStatus,
    attFilterDateFrom,
    attFilterDateTo,
  ]);

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
            Quản lý vòng đời ca làm việc, bảng phân ca kíp (Roster), theo dõi
            log quẹt thẻ và xét duyệt giải trình công theo CSDL trực tiếp.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5 border-slate-200"
            onClick={() => void loadAllData()}
          >
            <RefreshCw
              className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Tải lại</span>
          </Button>
        </div>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Tổng định nghĩa ca
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono">
                {shifts.length}
              </span>
              <span className="text-xs font-semibold text-blue-700">
                Mẫu ca
              </span>
            </div>
            <span className="text-[11px] text-emerald-600 font-medium block mt-1">
              {shifts.filter((s) => s.status === 'ACTIVE').length} ca đang kích
              hoạt
            </span>
          </div>
          <div className="size-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Sliders className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Nhân sự đã phân ca
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600 font-mono">
                {assignedEmployeeCount}
              </span>
              <span className="text-xs font-semibold text-slate-500 font-mono">
                / {employees.length}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 block mt-1">
              {employees.length > 0
                ? Math.round((assignedEmployeeCount / employees.length) * 100)
                : 0}
              % độ phủ nhân sự
            </span>
          </div>
          <div className="size-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <Calendar className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Bản ghi công trong CSDL
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono">
                {attendances.length}
              </span>
              <span className="text-xs font-semibold text-slate-500">Lượt</span>
            </div>
            <span className="text-[11px] text-amber-600 font-medium block mt-1">
              {
                attendances.filter(
                  (a) => a.status === 'LATE' || a.status === 'EARLY_LEAVE',
                ).length
              }{' '}
              lượt đi muộn / về sớm
            </span>
          </div>
          <div className="size-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Clock className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Yêu cầu sửa công chờ duyệt
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#021E73] font-mono">
                {corrections.filter((c) => c.status === 'PENDING').length}
              </span>
              <span className="text-xs font-semibold text-blue-700">
                Đơn giải trình
              </span>
            </div>
            <span className="text-[11px] text-blue-700 font-medium block mt-1">
              Cần HR phê duyệt
            </span>
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
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'definitions'
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
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'roster'
                ? 'border-[#021E73] text-[#021E73] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Calendar className="size-4" />
            <span>2. Lịch phân ca</span>
            <Badge className="bg-blue-50 text-blue-800 text-[10px] font-bold px-1.5 py-0 border border-blue-200">
              Dữ liệu đã lưu
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('raw_logs')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'raw_logs'
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
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'adjustments'
                ? 'border-[#021E73] text-[#021E73] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="size-4" />
            <span>4. Bổ sung & Sửa công</span>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0 border-none">
              {corrections.filter((c) => c.status === 'PENDING').length} chờ
              duyệt
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
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    statusFilter === 'ALL'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Tất cả ({shifts.length})
                </button>
                <button
                  onClick={() => setStatusFilter('ACTIVE')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    statusFilter === 'ACTIVE'
                      ? 'bg-white text-emerald-700 shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  ACTIVE ({shifts.filter((s) => s.status === 'ACTIVE').length})
                </button>
                <button
                  onClick={() => setStatusFilter('INACTIVE')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    statusFilter === 'INACTIVE'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  INACTIVE (
                  {shifts.filter((s) => s.status === 'INACTIVE').length})
                </button>
              </div>
            </div>

            <Button
              size="sm"
              className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs shrink-0"
              permission="hrm.shift.manage"
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
                    <th className="py-3.5 px-4 text-center">Ca qua đêm</th>
                    <th className="py-3.5 px-4 text-center">
                      Dung sai trễ / sớm
                    </th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-slate-400"
                      >
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách ca từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredShifts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-slate-400"
                      >
                        Không tìm thấy ca làm việc nào phù hợp.
                      </td>
                    </tr>
                  ) : (
                    filteredShifts.map((shift) => (
                      <tr
                        key={shift.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                            {shift.code}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-900 block text-xs">
                            {shift.name}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">
                          <div className="flex items-center gap-1.5">
                            <Clock className="size-3.5 text-blue-700" />
                            <span>
                              {shift.startTime?.slice(0, 5)} -{' '}
                              {shift.endTime?.slice(0, 5)}
                              {shift.crossMidnight ? ' (+1)' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="font-mono font-semibold text-slate-700">
                            {shift.breakMinutes} phút
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {shift.crossMidnight ? (
                            <Badge className="bg-purple-100 text-purple-800 border-purple-200 text-[10px]">
                              Qua đêm (+1)
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Không
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-600">
                          {shift.graceLateMinutes}p / {shift.graceEarlyMinutes}p
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {shift.status === 'ACTIVE' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                              ACTIVE
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                              INACTIVE
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
                              permission="hrm.shift.manage"
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
        <HrmRosterPanel
          rows={assignments}
          employees={employees}
          shifts={shifts}
          onChanged={loadAllData}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 3: LOG & DỮ LIỆU CHẤM CÔNG (PROCESSED & RAW)           */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'raw_logs' && (
        <div className="space-y-4">
          {/* Top Control Bar: Chế độ hiển thị & Nút làm mới */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Chế độ hiển thị:
              </span>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('MATRIX')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${
                    attendanceViewMode === 'MATRIX'
                      ? 'bg-white text-[#021E73] shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Bảng công ma trận tháng (Chuẩn kỳ)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('PROCESSED')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${
                    attendanceViewMode === 'PROCESSED'
                      ? 'bg-white text-[#021E73] shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Bản ghi công tổng hợp (Mode A)
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceViewMode('RAW_EVENTS')}
                  className={`px-3 py-1.5 rounded-md transition-all font-medium cursor-pointer ${
                    attendanceViewMode === 'RAW_EVENTS'
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
          {attendanceViewMode === 'RAW_EVENTS' && (
            <HrmRawAttendancePanel employees={employees} />
          )}
          {attendanceViewMode === 'PROCESSED' && (
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
                      {filteredAttendances.length} / {attendances.length} bản
                      ghi
                    </Badge>
                  </div>

                  {(attFilterEmployeeId !== 'ALL' ||
                    attFilterStatus !== 'ALL' ||
                    attFilterDateFrom ||
                    attFilterDateTo) && (
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
                    <label className="text-slate-600 block mb-1 font-semibold">
                      Theo nhân sự
                    </label>
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
                    <label className="text-slate-600 block mb-1 font-semibold">
                      Theo trạng thái công
                    </label>
                    <SearchableSelect
                      placeholder="Chọn hoặc tìm trạng thái..."
                      emptyText="Không tìm thấy trạng thái phù hợp"
                      options={[
                        { value: 'ALL', label: '' },
                        {
                          value: 'VALID',
                          label: 'Hợp lệ (Đúng giờ)',
                          description: 'Chấm công chuẩn giờ ca',
                        },
                        {
                          value: 'LATE',
                          label: 'Đi muộn',
                          description: 'Vào ca muộn hơn dung sai',
                        },
                        {
                          value: 'EARLY_LEAVE',
                          label: 'Về sớm',
                          description: 'Ra ca sớm hơn dung sai',
                        },
                        {
                          value: 'NO_CHECKOUT',
                          label: 'Chưa Checkout (Quên quẹt ra)',
                          description: 'Chỉ có giờ vào, thiếu giờ ra',
                        },
                        {
                          value: 'APPROVED_CORRECTION',
                          label: 'Đã giải trình sửa công',
                          description: 'Đã được duyệt bổ sung/điều chỉnh',
                        },
                      ]}
                      value={attFilterStatus}
                      onChange={(val) => setAttFilterStatus(val || 'ALL')}
                      clearable
                    />
                  </div>

                  {/* Filter 3: Từ ngày - DatePickerInput định dạng chuẩn DD/MM/YYYY */}
                  <div>
                    <label className="text-slate-600 block mb-1 font-semibold">
                      Từ ngày làm việc
                    </label>
                    <DatePickerInput
                      placeholder="dd/mm/yyyy"
                      value={attFilterDateFrom}
                      onChange={(isoDate) => setAttFilterDateFrom(isoDate)}
                    />
                  </div>

                  {/* Filter 4: Đến ngày - DatePickerInput định dạng chuẩn DD/MM/YYYY */}
                  <div>
                    <label className="text-slate-600 block mb-1 font-semibold">
                      Đến ngày làm việc
                    </label>
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
                        <th className="py-3.5 px-4 text-center">
                          Số phút làm việc
                        </th>
                        <th className="py-3.5 px-4 text-center">
                          Nguồn dữ liệu
                        </th>
                        <th className="py-3.5 px-4 text-center">
                          Trạng thái công
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {isLoading ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-12 text-center text-slate-400"
                          >
                            <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                            <span>Đang tải dữ liệu công từ CSDL...</span>
                          </td>
                        </tr>
                      ) : filteredAttendances.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="py-12 text-center text-slate-400"
                          >
                            {attendances.length === 0
                              ? 'Chưa có bản ghi chấm công nào được ghi nhận trong CSDL.'
                              : 'Không tìm thấy bản ghi chấm công nào phù hợp với điều kiện lọc đã chọn.'}
                          </td>
                        </tr>
                      ) : (
                        filteredAttendances.map((att) => {
                          const emp = employees.find(
                            (e) => e.employeeId === att.employeeId,
                          );
                          return (
                            <tr
                              key={att.id}
                              className="hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                                {String(att.workDate).slice(0, 10)}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="font-bold text-slate-900 block text-xs">
                                  {emp ? emp.fullName : att.employeeId}
                                </span>
                                <span className="text-[11px] text-slate-500 font-mono">
                                  {emp
                                    ? `${emp.employeeCode} • ${emp.department}`
                                    : att.employeeId}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 font-mono">
                                {att.checkInAt ? (
                                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                                    {new Date(att.checkInAt).toLocaleTimeString(
                                      'vi-VN',
                                      {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      },
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-normal">
                                    --:--
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-mono">
                                {att.checkOutAt ? (
                                  <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold">
                                    {new Date(
                                      att.checkOutAt,
                                    ).toLocaleTimeString('vi-VN', {
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
              <h3 className="font-bold text-slate-900 text-sm">
                Hàng đợi Giải trình & Sửa đổi công chờ HR xét duyệt
              </h3>
              <p className="text-xs text-slate-500">
                Các yêu cầu quên quẹt thẻ, lỗi thiết bị thu nhận, được đối chiếu
                trực tiếp giữa giờ quẹt gốc và giờ giải trình đề xuất.
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
                    <th className="py-3.5 px-4 min-w-[200px]">
                      Lý do giải trình
                    </th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center min-w-[140px]">
                      Thao tác duyệt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-slate-400"
                      >
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách giải trình...</span>
                      </td>
                    </tr>
                  ) : corrections.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-slate-400"
                      >
                        Hiện tại không có đơn giải trình công nào cần xử lý.
                      </td>
                    </tr>
                  ) : (
                    corrections.map((corr) => {
                      const emp = employees.find(
                        (e) => e.employeeId === corr.employeeId,
                      );
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
                        <tr
                          key={corr.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono font-bold text-blue-700">
                            {corr.id.slice(0, 8)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {emp ? emp.fullName : corr.employeeId}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {emp
                                ? `${emp.employeeCode} • ${emp.department}`
                                : ''}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {String(corr.requestDate).slice(0, 10)}
                          </td>
                          <td className="py-3 px-4 font-mono text-red-600 bg-red-50/50 px-2 py-1 rounded">
                            {formatTimeOnly(corr.oldCheckInAt)} -{' '}
                            {formatTimeOnly(corr.oldCheckOutAt)}
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-700 bg-emerald-50 px-2 py-1 rounded font-bold">
                            {formatTimeOnly(corr.newCheckInAt)} -{' '}
                            {formatTimeOnly(corr.newCheckOutAt)}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {corr.reason}
                          </td>
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
                                <Button
                                  permission="hrm.attendance.approve"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    openCorrectionProcessing(corr.id)
                                  }
                                >
                                  Xử lý đơn
                                </Button>
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
              {editingShift
                ? `Cập nhật ca: ${editingShift.code}`
                : 'Thêm ca làm việc mới'}
            </h3>
            <p className="text-xs text-slate-500">
              Cấu hình các tham số giờ bắt đầu, kết thúc, nghỉ giữa ca và dung
              sai chấm công.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Mã ca làm việc *
                </label>
                <Input
                  placeholder="Ví dụ: HC-STD, CA-SANG"
                  value={shiftForm.code}
                  disabled={!!editingShift}
                  onChange={(e) =>
                    setShiftForm({
                      ...shiftForm,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                  className="h-8 text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Tên ca làm việc *
                </label>
                <Input
                  placeholder="Ví dụ: Hành chính tiêu chuẩn"
                  value={shiftForm.name}
                  onChange={(e) =>
                    setShiftForm({ ...shiftForm, name: e.target.value })
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Giờ bắt đầu (In) *
                </label>
                <Input
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(e) =>
                    setShiftForm({ ...shiftForm, startTime: e.target.value })
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Giờ kết thúc (Out) *
                </label>
                <Input
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(e) =>
                    setShiftForm({ ...shiftForm, endTime: e.target.value })
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Bắt đầu nghỉ
                  <Input
                    type="time"
                    value={shiftForm.breakStartTime}
                    onChange={(e) =>
                      setShiftForm({
                        ...shiftForm,
                        breakStartTime: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="text-sm">
                  Kết thúc nghỉ
                  <Input
                    type="time"
                    value={shiftForm.breakEndTime}
                    onChange={(e) =>
                      setShiftForm({
                        ...shiftForm,
                        breakEndTime: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Thời gian nghỉ (phút)
                </label>
                <Input
                  type="number"
                  placeholder="60"
                  value={shiftForm.breakMinutes}
                  onChange={(e) =>
                    setShiftForm({
                      ...shiftForm,
                      breakMinutes: Number(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="crossMidnight"
                  checked={shiftForm.crossMidnight}
                  onChange={(e) =>
                    setShiftForm({
                      ...shiftForm,
                      crossMidnight: e.target.checked,
                    })
                  }
                  className="size-4 text-[#021E73] rounded border-slate-300"
                />
                <label
                  htmlFor="crossMidnight"
                  className="text-slate-700 font-semibold cursor-pointer select-none"
                >
                  Ca làm việc qua đêm (+1 ngày)
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Dung sai đi muộn cho phép (phút)
                </label>
                <Input
                  type="number"
                  placeholder="10"
                  value={shiftForm.graceLateMinutes}
                  onChange={(e) =>
                    setShiftForm({
                      ...shiftForm,
                      graceLateMinutes: Number(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">
                  Dung sai về sớm cho phép (phút)
                </label>
                <Input
                  type="number"
                  placeholder="5"
                  value={shiftForm.graceEarlyMinutes}
                  onChange={(e) =>
                    setShiftForm({
                      ...shiftForm,
                      graceEarlyMinutes: Number(e.target.value) || 0,
                    })
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">
                Trạng thái áp dụng
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    shiftForm.status === 'ACTIVE' ? 'default' : 'outline'
                  }
                  className={`h-7 text-xs ${shiftForm.status === 'ACTIVE' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                  onClick={() =>
                    setShiftForm({ ...shiftForm, status: 'ACTIVE' })
                  }
                >
                  ACTIVE (Đang dùng)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    shiftForm.status === 'INACTIVE' ? 'default' : 'outline'
                  }
                  className={`h-7 text-xs ${shiftForm.status === 'INACTIVE' ? 'bg-slate-700 text-white' : ''}`}
                  onClick={() =>
                    setShiftForm({ ...shiftForm, status: 'INACTIVE' })
                  }
                >
                  INACTIVE (Tạm dừng)
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setIsAddShiftOpen(false)}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              disabled={isSubmitting}
              onClick={handleSaveShift}
              permission="hrm.shift.manage"
            >
              {isSubmitting ? (
                <Loader2 className="size-3.5 animate-spin mr-1" />
              ) : null}
              <span>
                {editingShift ? 'Cập nhật thay đổi' : 'Lưu ca làm việc'}
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG: GÁN CA NGOẠI LỆ CHO NHÂN SỰ                            */}
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
                      ACTIVE
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs">
                      INACTIVE
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
                    <span className="font-mono font-bold text-slate-900">
                      {selectedShiftForDrawer.code}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Tên ca:</span>
                    <span className="font-bold text-slate-900">
                      {selectedShiftForDrawer.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Ca qua đêm:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedShiftForDrawer.crossMidnight
                        ? 'Có (+1 ngày)'
                        : 'Không'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">
                      Mã UUID hệ thống:
                    </span>
                    <span className="font-mono text-[11px] text-slate-600">
                      {selectedShiftForDrawer.id}
                    </span>
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
                    <span className="text-slate-500 block">
                      Thời gian nghỉ:
                    </span>
                    <span className="font-bold text-slate-800">
                      {selectedShiftForDrawer.breakMinutes} phút
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">
                      Dung sai đi muộn:
                    </span>
                    <span className="font-mono font-bold text-amber-700">
                      {selectedShiftForDrawer.graceLateMinutes} phút
                    </span>
                  </div>
                </div>
              </div>

              {/* Khối 3: Nhân sự đang gán ca này */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <Users className="size-4 text-emerald-700" />
                  <span>3. Nhân sự đang áp dụng ca này</span>
                </h4>
                {assignments.filter(
                  (a) => a.shiftId === selectedShiftForDrawer.id,
                ).length === 0 ? (
                  <p className="text-slate-400 italic">
                    Chưa có nhân sự nào được gán ca này.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {assignments
                      .filter((a) => a.shiftId === selectedShiftForDrawer.id)
                      .map((a) => {
                        const emp = employees.find(
                          (e) => e.employeeId === a.employeeId,
                        );
                        return (
                          <div
                            key={a.id}
                            className="flex justify-between items-center bg-white p-2 rounded border border-slate-200"
                          >
                            <div>
                              <span className="font-bold text-slate-800 block text-xs">
                                {emp ? emp.fullName : a.employeeId}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono">
                                {emp ? emp.employeeCode : ''} • Từ{' '}
                                {a.effectiveFrom}
                              </span>
                            </div>
                            <Badge className="bg-emerald-50 text-emerald-700 text-[10px]">
                              Đang áp dụng
                            </Badge>
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
      <Sheet
        open={isCorrectionDrawerOpen}
        onOpenChange={setIsCorrectionDrawerOpen}
      >
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
                <SheetTitle>
                  Chi tiết Đơn giải trình & Điều chỉnh công
                </SheetTitle>
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
                  const emp = employees.find(
                    (e) => e.employeeId === selectedCorrection.employeeId,
                  );
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-500 block">Họ và tên:</span>
                        <span className="font-bold text-slate-900">
                          {emp ? emp.fullName : selectedCorrection.employeeId}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">
                          Mã nhân viên:
                        </span>
                        <span className="font-mono font-bold text-blue-700">
                          {emp ? emp.employeeCode : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Phòng ban:</span>
                        <span className="text-slate-700">
                          {emp ? emp.department : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">
                          Ngày giải trình:
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {String(selectedCorrection.requestDate).slice(0, 10)}
                        </span>
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
                    <span className="text-red-700 font-bold block mb-1">
                      Dữ liệu gốc ban đầu
                    </span>
                    <div className="space-y-1 text-slate-700 font-mono">
                      <div>
                        Vào:{' '}
                        {selectedCorrection.oldCheckInAt
                          ? new Date(
                              selectedCorrection.oldCheckInAt,
                            ).toLocaleTimeString('vi-VN')
                          : '--:--'}
                      </div>
                      <div>
                        Ra:{' '}
                        {selectedCorrection.oldCheckOutAt
                          ? new Date(
                              selectedCorrection.oldCheckOutAt,
                            ).toLocaleTimeString('vi-VN')
                          : '--:--'}
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                    <span className="text-emerald-700 font-bold block mb-1">
                      Đề xuất cập nhật
                    </span>
                    <div className="space-y-1 text-emerald-900 font-mono font-bold">
                      <div>
                        Vào:{' '}
                        {selectedCorrection.newCheckInAt
                          ? new Date(
                              selectedCorrection.newCheckInAt,
                            ).toLocaleTimeString('vi-VN')
                          : '--:--'}
                      </div>
                      <div>
                        Ra:{' '}
                        {selectedCorrection.newCheckOutAt
                          ? new Date(
                              selectedCorrection.newCheckOutAt,
                            ).toLocaleTimeString('vi-VN')
                          : '--:--'}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block font-semibold mb-1">
                    Lý do giải trình:
                  </span>
                  <div className="bg-white p-3 rounded-lg border border-slate-200 text-slate-800 text-xs">
                    {selectedCorrection.reason}
                  </div>
                </div>
              </div>

              {selectedCorrection.status === 'PENDING' && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button
                    permission="hrm.attendance.approve"
                    onClick={() =>
                      openCorrectionProcessing(selectedCorrection.id)
                    }
                  >
                    Mở hộp xử lý đơn
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
