'use client';

import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sliders,
  UserCheck,
} from 'lucide-react';
import type {
  HrmEmployeeProfile,
  HrmLeaveBalance,
  HrmLeaveRequest,
  HrmLeaveTransaction,
  HrmLeaveType,
  HrmOtRequest,
  HrmBusinessTripRequest,
  HrmShiftChangeRequest,
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

type SubTabKey = 'pending' | 'balances' | 'ledger';
type RequestKind = 'LEAVE' | 'OT' | 'SHIFT' | 'TRIP' | 'CORRECTION';

interface UnifiedApprovalItem {
  id: string;
  kind: RequestKind;
  kindLabel: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  timeDisplay: string;
  volumeDisplay: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  waitingDurationHours: number;
  policyStatus: 'VALID' | 'WARNING' | 'VIOLATION';
  policyNote: string;
  rawItem: Record<string, unknown>;
}

interface ExtendedLeaveBalance extends HrmLeaveBalance {
  leaveTypeName?: string;
  leaveTypeCode?: string;
  employeeName?: string;
  employeeCode?: string;
  department?: string | null;
}

interface ExtendedLeaveTransaction extends HrmLeaveTransaction {
  leaveTypeName?: string;
  leaveTypeCode?: string;
  employeeName?: string;
  employeeCode?: string;
  department?: string | null;
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

export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<SubTabKey>('pending');

  // Master Data States from DB
  const [employees, setEmployees] = useState<HrmEmployeeProfile[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<HrmLeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<ExtendedLeaveBalance[]>([]);
  const [leaveTransactions, setLeaveTransactions] = useState<ExtendedLeaveTransaction[]>([]);
  const [unifiedRequests, setUnifiedRequests] = useState<UnifiedApprovalItem[]>([]);

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filters
  const [kindFilter, setKindFilter] = useState<'ALL' | RequestKind>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [selectedLeaveTypeFilter, setSelectedLeaveTypeFilter] = useState('ALL');

  // Multi-select for Batch Approval (Restricted to same kind only)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Drawer & Modal States
  const [selectedRequest, setSelectedRequest] = useState<UnifiedApprovalItem | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);

  // Leave Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustEmpId, setAdjustEmpId] = useState('');
  const [adjustLeaveTypeId, setAdjustLeaveTypeId] = useState('');
  const [adjustDays, setAdjustDays] = useState('1.0');
  const [adjustReason, setAdjustReason] = useState('');

  // 1. Fetch All Real Data from Backend APIs
  const loadAllData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [
        empRes,
        typesRes,
        balRes,
        txRes,
        leaveRes,
        otRes,
        tripRes,
        shiftRes,
        corrRes,
      ] = await Promise.all([
        fetch('/api/hrm/v1/employees?page_size=100', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/leave-types', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/leave-balances', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/leave-transactions', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/leave-requests?status=PENDING', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/ot-requests', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/business-trip-requests?status=PENDING', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/shift-change-requests', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/attendance-corrections?status=PENDING', { credentials: 'same-origin' }),
      ]);

      let empList: HrmEmployeeProfile[] = [];
      let lTypes: HrmLeaveType[] = [];

      if (empRes.ok) {
        const payload = await empRes.json();
        empList = payload.data || [];
        setEmployees(empList);
      }
      if (typesRes.ok) {
        const payload = await typesRes.json();
        lTypes = payload.data || [];
        setLeaveTypes(lTypes);
      }
      if (balRes.ok) {
        const payload = await balRes.json();
        setLeaveBalances(payload.data || []);
      }
      if (txRes.ok) {
        const payload = await txRes.json();
        setLeaveTransactions(payload.data || []);
      }

      // Map Unified Pending Work Queue
      const items: UnifiedApprovalItem[] = [];
      const now = new Date().getTime();

      // 1.1 Leave Requests
      if (leaveRes.ok) {
        const payload = await leaveRes.json();
        const list: HrmLeaveRequest[] = payload.data || [];
        list.forEach((l) => {
          const emp = empList.find((e) => e.employeeId === l.employeeId);
          const lt = lTypes.find((t) => t.id === l.leaveTypeId);
          const createdAtMs = new Date(l.createdAt).getTime();
          const waitingHours = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600)));

          items.push({
            id: l.id,
            kind: 'LEAVE',
            kindLabel: lt ? lt.name : 'Nghỉ phép',
            employeeId: l.employeeId,
            employeeCode: emp ? emp.employeeCode : 'N/A',
            employeeName: emp ? (emp.fullName || 'Nhân viên') : l.employeeId,
            department: emp ? (emp.department || 'Chưa gán') : 'Chưa gán',
            timeDisplay: `${l.fromDate} → ${l.toDate}`,
            volumeDisplay: `${l.duration} ngày`,
            reason: l.reason,
            status: l.status === 'PENDING' ? 'PENDING' : l.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            createdAt: l.createdAt,
            waitingDurationHours: waitingHours,
            policyStatus: 'VALID',
            policyNote: 'Hợp lệ theo quy định quỹ phép',
            rawItem: l as any,
          });
        });
      }

      // 1.2 OT Requests
      if (otRes.ok) {
        const payload = await otRes.json();
        const list: HrmOtRequest[] = (payload.data || []).filter((o: HrmOtRequest) => o.status === 'PENDING');
        list.forEach((o) => {
          const emp = empList.find((e) => e.employeeId === o.employeeId);
          const createdAtMs = new Date(o.createdAt).getTime();
          const waitingHours = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600)));
          const hours = (o.plannedMinutes / 60).toFixed(1);

          items.push({
            id: o.id,
            kind: 'OT',
            kindLabel: `Làm thêm giờ (${o.otType})`,
            employeeId: o.employeeId,
            employeeCode: emp ? emp.employeeCode : 'N/A',
            employeeName: emp ? (emp.fullName || 'Nhân viên') : o.employeeId,
            department: emp ? (emp.department || 'Chưa gán') : 'Chưa gán',
            timeDisplay: `${o.workDate} (${o.startTime.slice(0, 5)} - ${o.endTime.slice(0, 5)})`,
            volumeDisplay: `${hours} giờ OT`,
            reason: o.reason,
            status: 'PENDING',
            createdAt: o.createdAt,
            waitingDurationHours: waitingHours,
            policyStatus: o.monthlyAccumulatedOtMinutes > 1800 ? 'WARNING' : 'VALID',
            policyNote: o.monthlyAccumulatedOtMinutes > 1800 ? 'OT lũy kế tháng cao (>30h)' : 'Hạn mức OT an toàn',
            rawItem: o as any,
          });
        });
      }

      // 1.3 Business Trip Requests
      if (tripRes.ok) {
        const payload = await tripRes.json();
        const list: HrmBusinessTripRequest[] = payload.data || [];
        list.forEach((t) => {
          const emp = empList.find((e) => e.employeeId === t.employeeId);
          const createdAtMs = new Date(t.createdAt).getTime();
          const waitingHours = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600)));

          items.push({
            id: t.id,
            kind: 'TRIP',
            kindLabel: `Công tác (${t.businessTripType})`,
            employeeId: t.employeeId,
            employeeCode: emp ? emp.employeeCode : 'N/A',
            employeeName: emp ? (emp.fullName || 'Nhân viên') : t.employeeId,
            department: emp ? (emp.department || 'Chưa gán') : 'Chưa gán',
            timeDisplay: `${t.fromDate} → ${t.toDate} (${t.destination})`,
            volumeDisplay: `${t.daysCount} ngày`,
            reason: t.reason,
            status: 'PENDING',
            createdAt: t.createdAt,
            waitingDurationHours: waitingHours,
            policyStatus: 'VALID',
            policyNote: t.allowOt ? 'Có phát sinh OT khi công tác' : 'Công tác tiêu chuẩn',
            rawItem: t as any,
          });
        });
      }

      // 1.4 Shift Change Requests
      if (shiftRes.ok) {
        const payload = await shiftRes.json();
        const list: HrmShiftChangeRequest[] = (payload.data || []).filter(
          (s: HrmShiftChangeRequest) => s.status === 'PENDING' || s.status === 'PEER_CONFIRMED',
        );
        list.forEach((s) => {
          const emp = empList.find((e) => e.employeeId === s.employeeId);
          const createdAtMs = new Date(s.createdAt).getTime();
          const waitingHours = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600)));

          items.push({
            id: s.id,
            kind: 'SHIFT',
            kindLabel: `Đổi ca (${s.changeType})`,
            employeeId: s.employeeId,
            employeeCode: emp ? emp.employeeCode : 'N/A',
            employeeName: emp ? (emp.fullName || 'Nhân viên') : s.employeeId,
            department: emp ? (emp.department || 'Chưa gán') : 'Chưa gán',
            timeDisplay: `${s.fromDate} → ${s.toDate}`,
            volumeDisplay: '1 ca trực',
            reason: s.reason,
            status: 'PENDING',
            createdAt: s.createdAt,
            waitingDurationHours: waitingHours,
            policyStatus: s.swapPeerConfirmed ? 'VALID' : 'WARNING',
            policyNote: s.swapPeerConfirmed ? 'Đồng nghiệp đã xác nhận' : 'Chờ đồng nghiệp xác nhận',
            rawItem: s as any,
          });
        });
      }

      // 1.5 Attendance Corrections
      if (corrRes.ok) {
        const payload = await corrRes.json();
        const list: HrmAttendanceCorrection[] = payload.data || [];
        list.forEach((c) => {
          const emp = empList.find((e) => e.employeeId === c.employeeId);
          const createdAtMs = new Date(c.createdAt).getTime();
          const waitingHours = Math.max(0, Math.round((now - createdAtMs) / (1000 * 3600)));

          items.push({
            id: c.id,
            kind: 'CORRECTION',
            kindLabel: 'Giải trình sửa công',
            employeeId: c.employeeId,
            employeeCode: emp ? emp.employeeCode : 'N/A',
            employeeName: emp ? (emp.fullName || 'Nhân viên') : c.employeeId,
            department: emp ? (emp.department || 'Chưa gán') : 'Chưa gán',
            timeDisplay: String(c.requestDate).slice(0, 10),
            volumeDisplay: 'Sửa giờ vào/ra',
            reason: c.reason,
            status: 'PENDING',
            createdAt: c.createdAt,
            waitingDurationHours: waitingHours,
            policyStatus: 'VALID',
            policyNote: 'Cần HR đối chiếu log thô',
            rawItem: c as any,
          });
        });
      }

      // Sort by waiting time (newest waiting first)
      items.sort((a, b) => b.waitingDurationHours - a.waitingDurationHours);
      setUnifiedRequests(items);
    } catch (err) {
      console.error('Lỗi khi tải dữ liệu phê duyệt:', err);
      toast.add({
        title: 'Lỗi tải dữ liệu',
        description: 'Không thể kết nối đến máy chủ quản lý đơn từ.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Handle Single Approve
  const handleApprove = async (item: UnifiedApprovalItem) => {
    try {
      let endpoint = '';
      if (item.kind === 'LEAVE') endpoint = `/api/hrm/v1/leave-requests/${item.id}/approve`;
      else if (item.kind === 'OT') endpoint = `/api/hrm/v1/ot-requests/${item.id}/approve`;
      else if (item.kind === 'TRIP') endpoint = `/api/hrm/v1/business-trip-requests/${item.id}/approve`;
      else if (item.kind === 'SHIFT') endpoint = `/api/hrm/v1/shift-change-requests/${item.id}/approve`;
      else if (item.kind === 'CORRECTION') endpoint = `/api/hrm/v1/attendance-corrections/${item.id}/approve`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
      });

      if (res.ok) {
        toast.add({
          title: 'Phê duyệt thành công',
          description: `Đơn [${item.kindLabel}] của ${item.employeeName} đã được phê duyệt và cập nhật quyền lợi.`,
          type: 'success',
        });
        setIsDetailDrawerOpen(false);
        await loadAllData();
      } else {
        toast.add({
          title: 'Phê duyệt thất bại',
          description: 'Không thể thực hiện phê duyệt đơn này.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi khi phê duyệt đơn:', err);
      toast.add({
        title: 'Lỗi kết nối',
        description: 'Không thể gửi yêu cầu phê duyệt đến máy chủ.',
        type: 'error',
      });
    }
  };

  // Handle Single Reject
  const handleReject = async (item: UnifiedApprovalItem) => {
    try {
      let endpoint = '';
      if (item.kind === 'LEAVE') endpoint = `/api/hrm/v1/leave-requests/${item.id}/reject`;
      else if (item.kind === 'OT') endpoint = `/api/hrm/v1/ot-requests/${item.id}/reject`;
      else if (item.kind === 'TRIP') endpoint = `/api/hrm/v1/business-trip-requests/${item.id}/reject`;
      else if (item.kind === 'SHIFT') endpoint = `/api/hrm/v1/shift-change-requests/${item.id}/reject`;
      else if (item.kind === 'CORRECTION') endpoint = `/api/hrm/v1/attendance-corrections/${item.id}/reject`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Từ chối bởi HR Quản lý' }),
      });

      if (res.ok) {
        toast.add({
          title: 'Đã từ chối đơn',
          description: `Đơn [${item.kindLabel}] của ${item.employeeName} đã chuyển sang trạng thái Từ chối.`,
          type: 'info',
        });
        setIsDetailDrawerOpen(false);
        await loadAllData();
      } else {
        toast.add({
          title: 'Từ chối thất bại',
          description: 'Không thể cập nhật trạng thái đơn.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi khi từ chối đơn:', err);
    }
  };

  // Handle Batch Approve (Strict Check: Same kind only)
  const handleBatchApprove = async () => {
    if (selectedIds.length === 0) {
      toast.add({
        title: 'Chưa chọn đơn',
        description: 'Vui lòng chọn ít nhất một đơn để duyệt hàng loạt.',
        type: 'info',
      });
      return;
    }

    const selectedItems = unifiedRequests.filter((r) => selectedIds.includes(r.id));
    const firstKind = selectedItems[0]?.kind;
    const isSameKind = selectedItems.every((r) => r.kind === firstKind);

    if (!isSameKind) {
      toast.add({
        title: 'Không thể duyệt hỗn hợp',
        description: 'Theo quy định an toàn kiểm toán, chỉ được duyệt hàng loạt các đơn CÙNG LOẠI NGHIỆP VỤ.',
        type: 'warning',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      for (const item of selectedItems) {
        await handleApprove(item);
      }
      setSelectedIds([]);
      toast.add({
        title: 'Duyệt hàng loạt thành công',
        description: `Đã phê duyệt ${selectedItems.length} đơn [${selectedItems[0].kindLabel}].`,
        type: 'success',
      });
      await loadAllData();
    } catch (err) {
      console.error('Lỗi duyệt hàng loạt:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Leave Adjustment Submit
  const handleSaveAdjustment = async () => {
    if (!adjustEmpId || !adjustLeaveTypeId || !adjustDays || !adjustReason.trim()) {
      toast.add({
        title: 'Thiếu thông tin',
        description: 'Vui lòng chọn nhân viên, loại phép, số ngày điều chỉnh và lý do.',
        type: 'warning',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/hrm/v1/leave-adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          employeeId: adjustEmpId,
          leaveTypeId: adjustLeaveTypeId,
          daysAdjusted: parseFloat(adjustDays),
          reason: adjustReason,
        }),
      });

      if (res.ok) {
        toast.add({
          title: 'Điều chỉnh quỹ phép thành công',
          description: 'Hạn mức đã được điều chỉnh và ghi sổ cái kiểm toán thành công.',
          type: 'success',
        });
        setIsAdjustModalOpen(false);
        setAdjustReason('');
        await loadAllData();
      } else {
        toast.add({
          title: 'Điều chỉnh thất bại',
          description: 'Không thể ghi nhận điều chỉnh phép.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi điều chỉnh phép:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Work Queue Requests
  const filteredRequests = useMemo(() => {
    return unifiedRequests.filter((r) => {
      const matchesKind = kindFilter === 'ALL' || r.kind === kindFilter;
      const matchesDept = selectedDeptFilter === 'ALL' || r.department === selectedDeptFilter;
      const matchesSearch =
        r.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.reason.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesKind && matchesDept && matchesSearch;
    });
  }, [unifiedRequests, kindFilter, selectedDeptFilter, searchTerm]);

  // Filtered Leave Balances
  const filteredBalances = useMemo(() => {
    return leaveBalances.filter((b) => {
      const matchesDept = selectedDeptFilter === 'ALL' || b.department === selectedDeptFilter;
      const matchesType = selectedLeaveTypeFilter === 'ALL' || b.leaveTypeId === selectedLeaveTypeFilter;
      const name = b.employeeName || '';
      const code = b.employeeCode || '';
      const matchesSearch =
        name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        code.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesDept && matchesType && matchesSearch;
    });
  }, [leaveBalances, selectedDeptFilter, selectedLeaveTypeFilter, searchTerm]);

  // Filtered Leave Transactions (Ledger)
  const filteredTransactions = useMemo(() => {
    return leaveTransactions.filter((tx) => {
      const matchesDept = selectedDeptFilter === 'ALL' || tx.department === selectedDeptFilter;
      const matchesType = selectedLeaveTypeFilter === 'ALL' || tx.leaveTypeId === selectedLeaveTypeFilter;
      const name = tx.employeeName || '';
      const code = tx.employeeCode || '';
      const note = tx.note || '';
      const matchesSearch =
        name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        note.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.id.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesDept && matchesType && matchesSearch;
    });
  }, [leaveTransactions, selectedDeptFilter, selectedLeaveTypeFilter, searchTerm]);

  // Department Options
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

  // Leave Type Options
  const leaveTypeOptions: SearchableSelectOption[] = useMemo(() => {
    return [
      { value: 'ALL', label: 'Tất cả loại phép' },
      ...leaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    ];
  }, [leaveTypes]);

  // Employee Select Options for Adjustment
  const employeeSelectOptions: SearchableSelectOption[] = useMemo(() => {
    return employees.map((emp) => ({
      value: emp.employeeId,
      label: `${emp.fullName || 'Nhân viên'} (${emp.employeeCode})`,
      description: `${emp.department || 'Chưa gán phòng'} • ${emp.position || 'Nhân viên'}`,
    }));
  }, [employees]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#091426] tracking-tight">
              Xử lý Đơn từ & Quản trị Phép
            </h1>
            <Badge className="bg-blue-100 text-[#021E73] border-blue-200 text-xs font-semibold">
              HR Operations / C&B
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Hàng đợi duyệt tập trung (Work Queue), quản trị quỹ phép theo thời gian thực và sổ cái biến động phép bất biến (ISO/Audit).
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
                title: 'Đã làm mới dữ liệu',
                description: 'Đã đồng bộ đơn từ và sổ cái mới nhất từ CSDL.',
                type: 'info',
              });
            }}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Đồng bộ CSDL</span>
          </Button>

          <Button
            size="sm"
            className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs"
            onClick={() => {
              setAdjustEmpId('');
              setAdjustLeaveTypeId(leaveTypes[0]?.id || '');
              setAdjustDays('1.0');
              setAdjustReason('');
              setIsAdjustModalOpen(true);
            }}
          >
            <Sliders className="size-3.5" />
            <span>Điều chỉnh tồn phép</span>
          </Button>
        </div>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Tổng đơn chờ HR duyệt</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-700 font-mono">{unifiedRequests.length}</span>
              <span className="text-xs font-semibold text-blue-700">Đơn trong hàng đợi</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-medium block mt-1">
              {unifiedRequests.filter((r) => r.waitingDurationHours <= 24).length} đơn gửi trong 24h
            </span>
          </div>
          <div className="size-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Clock className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Đơn nghỉ phép chờ duyệt</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 font-mono">
                {unifiedRequests.filter((r) => r.kind === 'LEAVE').length}
              </span>
              <span className="text-xs font-semibold text-slate-500">Đơn phép</span>
            </div>
            <span className="text-[11px] text-amber-600 font-medium block mt-1">Cần duyệt trước ngày nghỉ</span>
          </div>
          <div className="size-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Calendar className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Đơn làm thêm giờ (OT)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-600 font-mono">
                {unifiedRequests.filter((r) => r.kind === 'OT').length}
              </span>
              <span className="text-xs font-semibold text-amber-600">Đơn OT</span>
            </div>
            <span className="text-[11px] text-slate-500 block mt-1">Kiểm soát hạn mức 40h/tháng</span>
          </div>
          <div className="size-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Clock className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">Giao dịch sổ cái ghi nhận</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#021E73] font-mono">{leaveTransactions.length}</span>
              <span className="text-xs font-semibold text-blue-700">Transactions</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-medium block mt-1">100% Bất biến (Immutable)</span>
          </div>
          <div className="size-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#021E73] shrink-0">
            <History className="size-5" />
          </div>
        </div>
      </div>

      {/* 3. Horizontal Sub-tabs */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('pending')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'pending'
                ? 'border-[#021E73] text-[#021E73] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Clock className="size-4" />
            <span>1. Đơn chờ HR duyệt</span>
            <Badge className="bg-[#021E73] text-white text-[10px] font-bold px-1.5 py-0 border-none">
              {unifiedRequests.length}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('balances')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'balances'
                ? 'border-[#021E73] text-[#021E73] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="size-4" />
            <span>2. Quỹ phép & Số dư</span>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-medium px-1.5 py-0 border-none">
              Năm {new Date().getFullYear()}
            </Badge>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'ledger'
                ? 'border-[#021E73] text-[#021E73] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="size-4" />
            <span>3. Sổ cái biến động phép</span>
            <Badge className="bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0 border-none">
              Immutable Ledger
            </Badge>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUB-TAB 1: ĐƠN CHỜ HR DUYỆT (WORK QUEUE)                       */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className={`text-xs h-7.5 px-3 rounded-lg font-bold ${
                    kindFilter === 'ALL'
                      ? 'bg-[#021E73] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setKindFilter('ALL')}
                >
                  Tất cả ({unifiedRequests.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`text-xs h-7.5 px-3 rounded-lg font-medium border-slate-200 ${
                    kindFilter === 'LEAVE'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setKindFilter('LEAVE')}
                >
                  Nghỉ phép ({unifiedRequests.filter((r) => r.kind === 'LEAVE').length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`text-xs h-7.5 px-3 rounded-lg font-medium border-slate-200 ${
                    kindFilter === 'OT'
                      ? 'bg-amber-50 text-amber-700 border-amber-200 font-bold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setKindFilter('OT')}
                >
                  Làm thêm giờ OT ({unifiedRequests.filter((r) => r.kind === 'OT').length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`text-xs h-7.5 px-3 rounded-lg font-medium border-slate-200 ${
                    kindFilter === 'SHIFT'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setKindFilter('SHIFT')}
                >
                  Đổi ca ({unifiedRequests.filter((r) => r.kind === 'SHIFT').length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`text-xs h-7.5 px-3 rounded-lg font-medium border-slate-200 ${
                    kindFilter === 'TRIP'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setKindFilter('TRIP')}
                >
                  Công tác ({unifiedRequests.filter((r) => r.kind === 'TRIP').length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`text-xs h-7.5 px-3 rounded-lg font-medium border-slate-200 ${
                    kindFilter === 'CORRECTION'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setKindFilter('CORRECTION')}
                >
                  Sửa công ({unifiedRequests.filter((r) => r.kind === 'CORRECTION').length})
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  className="text-xs h-7.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1"
                  disabled={selectedIds.length === 0 || isSubmitting}
                  onClick={handleBatchApprove}
                >
                  <CheckCircle2 className="size-3.5" />
                  <span>Duyệt hàng loạt ({selectedIds.length})</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7.5 border-slate-200 text-slate-700 gap-1"
                  onClick={() => {
                    toast.add({
                      title: 'Xuất danh sách đơn chờ',
                      description: 'Đang kết xuất bảng tổng hợp đơn chờ duyệt ra file Excel.',
                      type: 'info',
                    });
                  }}
                >
                  <Download className="size-3.5 text-emerald-600" />
                  <span>Xuất Excel</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
              <div className="w-64">
                <SearchableSelect
                  placeholder="Lọc theo phòng ban..."
                  options={departmentOptions}
                  value={selectedDeptFilter}
                  onChange={(val) => setSelectedDeptFilter(val || 'ALL')}
                />
              </div>

              <div className="relative flex-1 max-w-sm">
                <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Tìm theo mã đơn, nhân viên, lý do..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-3 text-center w-10">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(filteredRequests.map((r) => r.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                      />
                    </th>
                    <th className="py-3.5 px-4">Mã đơn & Loại</th>
                    <th className="py-3.5 px-4">Nhân sự được áp dụng</th>
                    <th className="py-3.5 px-4">Thời gian áp dụng</th>
                    <th className="py-3.5 px-4 text-center">Khối lượng</th>
                    <th className="py-3.5 px-4">Đánh giá Policy</th>
                    <th className="py-3.5 px-4 min-w-[180px]">Lý do tóm tắt</th>
                    <th className="py-3.5 px-4 text-center">Thời gian chờ</th>
                    <th className="py-3.5 px-4 text-center min-w-[140px]">Thao tác duyệt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải hàng đợi duyệt từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Hàng đợi trống. Không có đơn từ nào cần duyệt vào lúc này.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={selectedIds.includes(req.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds((prev) => [...prev, req.id]);
                              } else {
                                setSelectedIds((prev) => prev.filter((id) => id !== req.id));
                              }
                            }}
                          />
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-blue-700 block text-[11px]">
                            {req.id.slice(0, 8)}
                          </span>
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] mt-0.5">
                            {req.kindLabel}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900 block text-xs">{req.employeeName}</span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {req.employeeCode} • {req.department}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                          {req.timeDisplay}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                          {req.volumeDisplay}
                        </td>
                        <td className="py-3 px-4">
                          {req.policyStatus === 'VALID' ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                              {req.policyNote}
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              {req.policyNote}
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700 text-xs">
                          {req.reason}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-500">
                          {req.waitingDurationHours === 0 ? 'Vừa gửi' : `${req.waitingDurationHours} giờ trước`}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Popconfirm
                              title="Phê duyệt đơn này?"
                              description="Quyền lợi và dữ liệu sẽ được áp dụng trực tiếp vào bảng công/quỹ phép."
                              onConfirm={() => handleApprove(req)}
                            >
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5"
                              >
                                Duyệt
                              </Button>
                            </Popconfirm>

                            <Popconfirm
                              title="Từ chối đơn này?"
                              description="Đơn sẽ bị đánh dấu REJECTED và không được ghi nhận quyền lợi."
                              onConfirm={() => handleReject(req)}
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 px-2"
                              >
                                Từ chối
                              </Button>
                            </Popconfirm>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-blue-700 px-1.5"
                              onClick={() => {
                                setSelectedRequest(req);
                                setIsDetailDrawerOpen(true);
                              }}
                            >
                              <Eye className="size-3.5" />
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
      {/* SUB-TAB 2: QUỸ PHÉP & SỐ DƯ (BALANCES & BUCKETS)              */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/60 flex items-start justify-between gap-4 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-white border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
                <Lock className="size-4" />
              </div>
              <div className="text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-blue-900 text-sm">
                    Quản trị Hạn mức & Quỹ phép tự động (Automated Leave Quota Engine):
                  </h4>
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                    ACTIVE {new Date().getFullYear()}
                  </Badge>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Nguyên tắc tính toán: <strong>Khả dụng (Available) = Số dư ghi nhận - Đang giữ chỗ (Pending)</strong>.
                  Mọi biến động đều được cập nhật tự động khi phê duyệt đơn hoặc điều chỉnh qua phiếu kiểm toán.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center gap-3">
            <div className="w-64">
              <SearchableSelect
                placeholder="Lọc theo phòng ban..."
                options={departmentOptions}
                value={selectedDeptFilter}
                onChange={(val) => setSelectedDeptFilter(val || 'ALL')}
              />
            </div>

            <div className="w-64">
              <SearchableSelect
                placeholder="Lọc theo loại phép..."
                options={leaveTypeOptions}
                value={selectedLeaveTypeFilter}
                onChange={(val) => setSelectedLeaveTypeFilter(val || 'ALL')}
              />
            </div>

            <div className="relative flex-1 max-w-sm">
              <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Tìm nhân viên trong quỹ phép..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Nhân viên & Mã</th>
                    <th className="py-3.5 px-4">Loại phép</th>
                    <th className="py-3.5 px-4 text-center">Tồn đầu kỳ</th>
                    <th className="py-3.5 px-4 text-center">Tích lũy</th>
                    <th className="py-3.5 px-4 text-center">Điều chỉnh</th>
                    <th className="py-3.5 px-4 text-center">Đã dùng</th>
                    <th className="py-3.5 px-4 text-center">Đang giữ chỗ</th>
                    <th className="py-3.5 px-4 text-center font-bold text-slate-700 bg-slate-100/50">Số dư ghi nhận</th>
                    <th className="py-3.5 px-4 text-center font-bold text-blue-700 bg-blue-50/50">Khả dụng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải số dư quỹ phép từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Chưa có bản ghi số dư phép nào trong CSDL.
                      </td>
                    </tr>
                  ) : (
                    filteredBalances.map((item) => {
                      const available = Math.max(0, item.remaining - item.pending);
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-bold text-slate-900 block text-xs">{item.employeeName}</span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {item.employeeCode} • {item.department}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                              {item.leaveTypeName}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-slate-700">{item.openingBalance} ngày</td>
                          <td className="py-3 px-4 text-center font-mono font-bold text-emerald-600">+{item.accrued} ngày</td>
                          <td className="py-3 px-4 text-center font-mono text-slate-500">{item.adjusted}</td>
                          <td className="py-3 px-4 text-center font-mono text-amber-600">{item.used} ngày</td>
                          <td className="py-3 px-4 text-center font-mono text-slate-400">{item.pending} ngày</td>
                          <td className="py-3 px-4 text-center font-mono font-bold text-slate-800 bg-slate-50/30">
                            {item.remaining} ngày
                          </td>
                          <td className="py-3 px-4 text-center font-mono font-bold text-blue-700 bg-blue-50/30 text-sm">
                            {available.toFixed(1)} ngày
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
      {/* SUB-TAB 3: SỔ CÁI BIẾN ĐỘNG PHÉP (IMMUTABLE LEDGER)           */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/60 flex items-start gap-3 shadow-xs">
            <div className="size-8 rounded-lg bg-white border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
              <Lock className="size-4" />
            </div>
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-blue-900 text-sm">
                  Sổ cái giao dịch biến động phép bất biến (Immutable Leave Ledger):
                </h4>
                <Badge className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]">
                  READ-ONLY / APPEND-ONLY
                </Badge>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Màn hình 100% Chỉ đọc (Read-only), tuyệt đối không sửa hoặc xóa trực tiếp nhằm bảo đảm tính toàn vẹn kiểm toán (Labor Audit & ISO).
                Mỗi dòng giải thích rõ nguyên nhân tăng/giảm và số dư sau giao dịch.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center gap-3">
            <div className="w-64">
              <SearchableSelect
                placeholder="Lọc theo phòng ban..."
                options={departmentOptions}
                value={selectedDeptFilter}
                onChange={(val) => setSelectedDeptFilter(val || 'ALL')}
              />
            </div>

            <div className="w-64">
              <SearchableSelect
                placeholder="Lọc theo loại phép..."
                options={leaveTypeOptions}
                value={selectedLeaveTypeFilter}
                onChange={(val) => setSelectedLeaveTypeFilter(val || 'ALL')}
              />
            </div>

            <div className="relative flex-1 max-w-sm">
              <Search className="size-3.5 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Tìm mã giao dịch, nhân viên, ghi chú..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Thời điểm & Mã TX</th>
                    <th className="py-3.5 px-4">Nhân sự</th>
                    <th className="py-3.5 px-4">Loại phép</th>
                    <th className="py-3.5 px-4 text-center">Loại giao dịch</th>
                    <th className="py-3.5 px-4 text-center">Biến động</th>
                    <th className="py-3.5 px-4 text-center font-bold text-blue-700">Số dư sau TX</th>
                    <th className="py-3.5 px-4">Căn cứ chứng từ / Đơn</th>
                    <th className="py-3.5 px-4 min-w-[200px]">Ghi chú kiểm toán</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[#021E73]" />
                        <span>Đang tải sổ cái giao dịch từ CSDL...</span>
                      </td>
                    </tr>
                  ) : filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        Chưa có giao dịch phép nào được ghi nhận trong CSDL.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono">
                          <span className="font-bold text-slate-900 block">
                            {new Date(tx.createdAt).toLocaleDateString('vi-VN')} {new Date(tx.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-[10px] text-blue-700 font-semibold">{tx.id.slice(0, 8)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900 block text-xs">{tx.employeeName}</span>
                          <span className="text-[11px] text-slate-500 font-mono">{tx.employeeCode} • {tx.department}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                            {tx.leaveTypeName}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            className={`text-[10px] font-bold ${
                              tx.transactionType === 'USAGE'
                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                : tx.transactionType === 'ACCRUAL'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-blue-100 text-blue-800 border-blue-200'
                            }`}
                          >
                            {tx.transactionType}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                          {tx.daysChanged > 0 ? `+${tx.daysChanged}` : tx.daysChanged} ngày
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-blue-700">
                          {tx.balanceAfter} ngày
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-blue-700">
                          {tx.referenceRequestId ? tx.referenceRequestId.slice(0, 8) : 'Hệ thống'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 text-xs">
                          {tx.note || 'Giao dịch chuẩn'}
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
      {/* DRAWER: CHI TIẾT ĐƠN DUYỆT (5 KHỐI QUY CHUẨN)                  */}
      {/* ------------------------------------------------------------- */}
      <Sheet open={isDetailDrawerOpen} onOpenChange={setIsDetailDrawerOpen}>
        <SheetContent className="overflow-y-auto">
          {selectedRequest && (
            <div className="space-y-6">
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-900 border-blue-200 text-xs font-mono font-bold">
                    {selectedRequest.id.slice(0, 8)}
                  </Badge>
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                    CHỜ HR XÉT DUYỆT
                  </Badge>
                </div>
                <SheetTitle>Hồ sơ đơn: {selectedRequest.kindLabel}</SheetTitle>
                <SheetDescription>
                  Thông tin trình duyệt chi tiết từ nhân sự và đánh giá quy chuẩn
                </SheetDescription>
              </SheetHeader>

              {/* Khối 1: Thông tin nhân sự áp dụng */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <UserCheck className="size-4 text-[#021E73]" />
                  <span>1. Nhân sự được áp dụng</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 block">Họ và tên:</span>
                    <span className="font-bold text-slate-900">{selectedRequest.employeeName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Mã nhân viên:</span>
                    <span className="font-mono font-bold text-blue-700">{selectedRequest.employeeCode}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Phòng ban / Đơn vị:</span>
                    <span className="text-slate-800">{selectedRequest.department}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Thời gian đã chờ duyệt:</span>
                    <span className="font-mono text-amber-700 font-bold">{selectedRequest.waitingDurationHours} giờ</span>
                  </div>
                </div>
              </div>

              {/* Khối 2: Chi tiết nội dung yêu cầu */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <Calendar className="size-4 text-blue-700" />
                  <span>2. Nội dung yêu cầu đề xuất</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 block">Thời gian áp dụng:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedRequest.timeDisplay}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Khối lượng / Thời lượng:</span>
                    <span className="font-mono font-bold text-emerald-700">{selectedRequest.volumeDisplay}</span>
                  </div>
                </div>
                <div className="pt-2">
                  <span className="text-slate-500 block font-semibold mb-1">Lý do giải trình:</span>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-slate-800">
                    {selectedRequest.reason}
                  </div>
                </div>
              </div>

              {/* Khối 3: Kiểm tra chính sách (Policy Check) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  <span>3. Đánh giá chính sách tự động</span>
                </h4>
                <div className="flex items-center gap-2">
                  <Badge className={selectedRequest.policyStatus === 'VALID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
                    {selectedRequest.policyNote}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-500 italic mt-1">
                  Hệ thống tự động kiểm tra số dư khả dụng, hạn mức OT lũy kế và xung đột ca trực trước khi trình HR.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Popconfirm
                  title="Từ chối đơn này?"
                  description="Đơn sẽ bị chuyển trạng thái sang REJECTED."
                  onConfirm={() => handleReject(selectedRequest)}
                >
                  <Button variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200">
                    Từ chối đơn
                  </Button>
                </Popconfirm>

                <Popconfirm
                  title="Phê duyệt đơn này?"
                  description="Quyền lợi sẽ được áp dụng trực tiếp vào CSDL."
                  onConfirm={() => handleApprove(selectedRequest)}
                >
                  <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    Phê duyệt & Áp dụng
                  </Button>
                </Popconfirm>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ------------------------------------------------------------- */}
      {/* DIALOG: ĐIỀU CHỈNH TỒN PHÉP (LEAVE ADJUSTMENT FORM)            */}
      {/* ------------------------------------------------------------- */}
      <Dialog open={isAdjustModalOpen} onOpenChange={setIsAdjustModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-base">Điều chỉnh hạn mức Quỹ phép cá nhân</h3>
            <p className="text-xs text-slate-500">
              Cộng hoặc trừ ngày phép nhân sự kèm lý do kiểm toán bắt buộc.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Chọn nhân sự điều chỉnh *</label>
              <SearchableSelect
                placeholder="Tìm nhân viên..."
                options={employeeSelectOptions}
                value={adjustEmpId}
                onChange={(val) => setAdjustEmpId(val || '')}
              />
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Chọn loại phép *</label>
              <SearchableSelect
                placeholder="Chọn loại phép..."
                options={leaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                value={adjustLeaveTypeId}
                onChange={(val) => setAdjustLeaveTypeId(val || '')}
              />
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Số ngày điều chỉnh (+ tăng / - giảm) *</label>
              <Input
                type="number"
                step="0.5"
                placeholder="Ví dụ: 1.0 hoặc -1.0"
                value={adjustDays}
                onChange={(e) => setAdjustDays(e.target.value)}
                className="h-8 text-xs font-mono font-bold"
              />
            </div>

            <div>
              <label className="text-slate-600 block mb-1 font-semibold">Căn cứ / Lý do điều chỉnh *</label>
              <Input
                placeholder="Ví dụ: Bổ sung phép thâm niên theo Quyết định số 45/QĐ-NS"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setIsAdjustModalOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              disabled={isSubmitting}
              onClick={handleSaveAdjustment}
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              <span>Xác nhận điều chỉnh</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
