'use client';

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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { toast } from '../ui/toast';
import { SearchableSelect, type SearchableSelectOption, Popconfirm } from '@enterprise-platform/shared-ui';

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

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [attendanceViewMode, setAttendanceViewMode] = useState<'PROCESSED' | 'RAW'>('PROCESSED');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');

  // Modals & Drawers
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<HrmShiftDefinition | null>(null);
  const [selectedShiftForDrawer, setSelectedShiftForDrawer] = useState<HrmShiftDefinition | null>(null);
  const [isShiftDrawerOpen, setIsShiftDrawerOpen] = useState(false);

  // Quick Shift Assign Modal
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
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
    crossMidnight: false,
    graceLateMinutes: 15,
    graceEarlyMinutes: 15,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  // 1. Fetch Master Data from DB
  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [shiftsRes, assignRes, attRes, corrRes, empRes] = await Promise.all([
        fetch('/api/hrm/v1/shifts', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/shift-assignments', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/attendance', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/attendance-corrections', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/employees?page_size=100', { credentials: 'same-origin' }),
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
        body: JSON.stringify(shiftForm),
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
      breakMinutes: shift.breakMinutes || 60,
      crossMidnight: shift.crossMidnight || false,
      graceLateMinutes: shift.graceLateMinutes || 10,
      graceEarlyMinutes: shift.graceEarlyMinutes || 5,
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
        toast.add({
          title: 'Phân ca không thành công',
          description: errPayload.message || 'Khoảng thời gian gán ca bị chồng lấn với ca hiện hữu.',
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

  // Employee Select Options for SearchableSelect
  const employeeSelectOptions: SearchableSelectOption[] = useMemo(() => {
    return employees.map((emp) => ({
      value: emp.employeeId,
      label: `${emp.fullName || 'Nhân viên'} (${emp.employeeCode})`,
      description: `${emp.department || 'Chưa gán phòng'} • ${emp.position || 'Nhân viên'}`,
    }));
  }, [employees]);

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

          <Button
            size="sm"
            className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs"
            onClick={() => {
              setEditingShift(null);
              setShiftForm({
                code: 'CA-NEW-' + (shifts.length + 1),
                name: '',
                startTime: '08:00',
                endTime: '17:30',
                breakMinutes: 60,
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
              <span className="text-2xl font-bold text-emerald-600 font-mono">{assignments.length}</span>
              <span className="text-xs font-semibold text-slate-500 font-mono">/ {employees.length}</span>
            </div>
            <span className="text-[11px] text-slate-500 block mt-1">
              {employees.length > 0 ? Math.round((assignments.length / employees.length) * 100) : 0}% độ phủ nhân sự
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
            <span>2. Bảng phân ca (Roster Matrix)</span>
            <Badge className="bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0 border-none">
              Tuần hiện tại
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
                  INACTIVE ({shifts.filter((s) => s.status === 'INACTIVE').length})
                </button>
              </div>
            </div>
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
                    <th className="py-3.5 px-4 text-center">Dung sai trễ / sớm</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách ca từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredShifts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
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
      {/* SUB-TAB 2: BẢNG PHÂN CA ROSTER (ROSTER MATRIX)                */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="w-64">
                <SearchableSelect
                  placeholder="Lọc theo phòng ban..."
                  options={departmentOptions}
                  value={selectedDeptFilter}
                  onChange={(val) => setSelectedDeptFilter(val || 'ALL')}
                />
              </div>

              <div className="relative flex-1 max-w-xs">
                <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Tìm nhân viên trong ma trận..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white gap-1.5 shadow-xs"
                onClick={() => setIsAssignModalOpen(true)}
              >
                <Plus className="size-3.5" />
                <span>Gán ca cho nhân sự</span>
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3 px-4 min-w-[170px] sticky left-0 bg-slate-50 z-10 border-r">Nhân viên</th>
                    <th className="py-3 px-4 min-w-[140px]">Bộ phận</th>
                    {currentWeekDays.map((day) => (
                      <th
                        key={day.iso}
                        className={`py-3 px-3 text-center min-w-[110px] ${
                          day.isToday ? 'bg-blue-50/70 text-blue-900 font-extrabold' : ''
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
                        <span>Đang tải ma trận phân ca kíp...</span>
                      </td>
                    </tr>
                  ) : filteredRosterEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Không có dữ liệu nhân viên nào theo bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredRosterEmployees.map((emp) => {
                      // Find active assignments for this employee
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
                                className={`py-3 px-2 text-center ${day.isToday ? 'bg-blue-50/30' : ''} ${
                                  isWeekend ? 'bg-slate-50/50' : ''
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
                                  <span className="text-[10px] text-amber-600 font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                    Chưa gán
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
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 3: LOG & DỮ LIỆU CHẤM CÔNG (PROCESSED & RAW)           */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'raw_logs' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Chế độ hiển thị:</span>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setAttendanceViewMode('PROCESSED')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    attendanceViewMode === 'PROCESSED'
                      ? 'bg-white text-[#021E73] shadow-xs font-bold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Bản ghi công tổng hợp (Mode A)
                </button>
                <button
                  onClick={() => setAttendanceViewMode('RAW')}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    attendanceViewMode === 'RAW'
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
                  ) : attendances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        Chưa có bản ghi chấm công nào được ghi nhận trong CSDL.
                      </td>
                    </tr>
                  ) : (
                    attendances.map((att) => {
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
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải danh sách giải trình...</span>
                      </td>
                    </tr>
                  ) : corrections.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
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
                <Input
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Giờ kết thúc (Out) *</label>
                <Input
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
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
                  onChange={(e) => setShiftForm({ ...shiftForm, breakMinutes: Number(e.target.value) || 0 })}
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
                  ACTIVE (Đang dùng)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={shiftForm.status === 'INACTIVE' ? 'default' : 'outline'}
                  className={`h-7 text-xs ${shiftForm.status === 'INACTIVE' ? 'bg-slate-700 text-white' : ''}`}
                  onClick={() => setShiftForm({ ...shiftForm, status: 'INACTIVE' })}
                >
                  INACTIVE (Tạm dừng)
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
      {/* DIALOG: GÁN CA NHANH CHO NHÂN SỰ                               */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-base">Phân ca làm việc cho Nhân viên</h3>
            <p className="text-xs text-slate-500">
              Gán lịch trực / ca mẫu cho nhân sự trong khoảng thời gian hiệu lực.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Chọn nhân sự *</label>
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
                <Input
                  type="date"
                  value={assignEffectiveFrom}
                  onChange={(e) => setAssignEffectiveFrom(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1 font-semibold">Ngày kết thúc (Tùy chọn)</label>
                <Input
                  type="date"
                  value={assignEffectiveTo}
                  onChange={(e) => setAssignEffectiveTo(e.target.value)}
                  className="h-8 text-xs font-mono"
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
