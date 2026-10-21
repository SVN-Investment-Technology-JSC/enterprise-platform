'use client';
import {
  Check,
  Download,
  FileCheck2,
  FileText,
  Info,
  Plus,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import {
  type EmployeeProfileHeroData,
} from '../ui/employee-hero-card';
import { Input } from '../ui/input';
import { MonthStepper } from '../ui/month-stepper';
import { RowMenu } from '../ui/row-menu';
import {
  DetailField,
  QuickCreateRow,
  RequestDetailCard,
  RequestListPanel,
  type QuickCreateItem,
} from '../ui/my-requests-view';
import {
  detailStatusMeta,
  inMonth,
  matchesStatusFilter,
  pickSelectedId,
  QUICK_CREATE_KINDS,
  requestMonthOf,
  type RequestStatusFilter,
} from '../my-requests-model';
import { currentMonthVn } from '../hrm-timesheet-format';
import type {
  HrmBusinessTripType,
  HrmRequestType,
} from '@enterprise-platform/contracts-hrm';
import { formatRequestDuration, formatRequestPeriod } from '../request-time-format';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { toast } from '../ui/toast';
import { hrmApiUrl, hrmFetch } from '../hrm-api';
import {
  loadLinkableProjects,
  PROJECT_LINK_STATUS_LABEL,
  projectLabel,
  type LinkableProject,
} from '../workspace-projects';
import { useHrmPermissions } from '../hrm-permissions';
import {
  REQUEST_HISTORY_PAGE_SIZE,
  approverFallbackLabel,
  exportRequestHistory,
  paginate,
} from '../request-history-view';
import {
  SearchableSelect,
  Popconfirm,
  formatDate,
} from '@enterprise-platform/shared-ui';
import { reasonCell, requestReasonView } from '../request-reason-form';
import {
  ProcedureProgressPanel,
  useProcedureProgress,
} from '../ui/procedure-progress-panel';
import {
  isTerminalProcedureStatus,
  procedureFieldsOf,
  distinctCurrentSteps,
  matchesWorkflowFilter,
  waitingApproverLabel,
} from '../procedure-progress-view';
import { RequestThread } from '../ui/approvals/request-thread';
import {
  CreateRequestForm,
  csrfToken,
  requestCatalogOf,
  type RequestFormInitial,
  type RequestKind,
} from '../ui/create-request-form';
import { leaveBalancesOf, type LeaveTypeItem, type ShiftItem } from '../request-form-model';

/** Đơn của loại tuỳ chỉnh (GET /custom-requests) thành dòng của danh sách đơn. */
function customRequestItem(item: Record<string, any>): RequestItem {
  const status = String(item.status);
  const wf: RequestItem['workflowStatus'] =
    status === 'APPROVED'
      ? 'APPROVED'
      : status === 'REJECTED' || status === 'CANCELLED'
        ? 'REJECTED'
        : 'PENDING_APPROVAL';
  const minutes = typeof item.durationMinutes === 'number' ? item.durationMinutes : null;
  return {
    id: item.id,
    code: `${String(item.typeCode || 'CUSTOM').slice(0, 12)}-${String(item.id).slice(0, 8).toUpperCase()}`,
    kind: 'custom',
    typeName: String(item.typeName || 'Đơn tuỳ chỉnh'),
    category: String(item.typeName || 'Đơn tuỳ chỉnh'),
    createdAt: item.createdAt
      ? formatDate(item.createdAt)
      : '----',
    rawCreatedAt: item.createdAt,
    createdTimeMs: item.createdAt ? new Date(item.createdAt).getTime() : 0,
    effectiveDate: formatRequestPeriod(item) || 'Không có thời gian',
    duration: minutes != null ? formatRequestDuration({ durationMinutes: minutes }) : '----',
    ...requestReasonView(item),
    approver: approverFallbackLabel(item.approvedBy, wf === 'PENDING_APPROVAL'),
    workflowStatus: wf,
    requestStatus:
      status === 'APPROVED'
        ? 'APPROVED'
        : status === 'REJECTED'
          ? 'REJECTED'
          : status === 'CANCELLED'
            ? 'CANCELLED'
            : 'PENDING',
    statusText:
      status === 'APPROVED'
        ? 'Đã duyệt'
        : status === 'REJECTED'
          ? 'Đã từ chối'
          : status === 'CANCELLED'
            ? 'Đã rút / hủy'
            : 'Chờ phê duyệt',
    rawDetails: item,
  };
}

interface RequestItem {
  id: string;
  code: string;
  kind: RequestKind;
  typeName: string;
  category: string;
  createdAt: string;
  rawCreatedAt?: string;
  createdTimeMs: number;
  effectiveDate: string;
  duration: string;
  /** Lý do: tên lý do chọn từ danh mục ("—" với đơn cũ chưa có lý do). */
  reason: string;
  /** Mô tả tự do của đơn ("—" khi trống); luôn tách khỏi lý do. */
  description: string;
  approver: string;
  // Tách biệt Request Status và Workflow Status theo Mục 14 trong PLAN
  workflowStatus:
  | 'SUBMITTED'
  | 'PENDING_PEER'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';
  requestStatus:
  | 'SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'APPLIED'
  | 'DISBURSED'
  | 'REPAID'
  | 'REJECTED'
  | 'CANCELLED';
  statusText: string;
  // Chi tiết mở rộng của từng nghiệp vụ
  rawDetails: Record<string, unknown>;
}

/** "Đang chờ [người] duyệt - [bước]" khi đơn đang chạy theo quy trình, ngược lại người duyệt mặc định. */
function approverText(req: RequestItem): string {
  const f = procedureFieldsOf(req.rawDetails);
  const pending =
    req.workflowStatus === 'PENDING_APPROVAL' ||
    req.workflowStatus === 'PENDING_PEER' ||
    req.workflowStatus === 'SUBMITTED';
  const label = pending
    ? waitingApproverLabel({
      assigneeName: f.currentAssigneeName,
      stepName: f.currentStepName,
    })
    : null;
  return label ?? req.approver;
}

/** Đơn làm thêm giờ có lý do không lương: không sinh công và tiền OT. */
function isUnpaidOt(req: RequestItem): boolean {
  return req.kind === 'ot' && req.rawDetails.paid === false;
}

function UnpaidOtBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-1.5 border-amber-200 bg-amber-50 text-[12px] font-semibold text-amber-800"
    >
      Không lương
    </Badge>
  );
}

export default function RequestsPage() {
  const { can } = useHrmPermissions();
  const canCreateRequest = can('hrm.self.request');
  const [historyPage, setHistoryPage] = useState(1);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  // Form tạo đơn đang mở: loại đơn và giá trị điền sẵn (đơn điều chỉnh); `seq` đổi mỗi lần mở để form bắt đầu lại.
  const [createForm, setCreateForm] = useState<{
    seq: number;
    kind: RequestKind;
    title: string;
    customType: HrmRequestType | null;
    initial?: RequestFormInitial;
  } | null>(null);
  // Danh mục loại đơn cấu hình (GET /request-types).
  const [requestTypes, setRequestTypes] = useState<HrmRequestType[]>([]);

  // Master Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>([]);
  const [shiftsList, setShiftsList] = useState<ShiftItem[]>([]);
  // Dự án Workspace người dùng tham gia, cho trường "Dự án liên kết".
  const [workspaceProjects, setWorkspaceProjects] = useState<
    LinkableProject[]
  >([]);

  /** Mã nhân viên của người đang đăng nhập, để lần tải lại danh sách không phải hỏi lại hồ sơ. */
  const empIdRef = useRef('');
  const [loading, setLoading] = useState(true);

  // Drawer chi tiết theo chuẩn 5 khối
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestItem | null>(
    null,
  );
  const selectedProcedure = procedureFieldsOf(selectedRequest?.rawDetails);
  const {
    progress: procedureProgress,
    loading: loadingProgress,
    refresh: refreshProgress,
  } = useProcedureProgress({
    instanceId: selectedProcedure.instanceId,
    kind: selectedRequest?.kind ?? '',
    requestId: selectedRequest?.id ?? '',
    open: isDetailDrawerOpen || selectedRequest !== null,
    // Quy trình đổi trạng thái (hoặc đã kết thúc khi mở): nạp lại đơn để lấy trạng thái nghiệp vụ thật.
    onLoaded: (data, previousStatus) => {
      if (
        previousStatus === undefined
          ? !isTerminalProcedureStatus(data.status)
          : previousStatus === data.status
      )
        return;
      const target = selectedRequest;
      void loadData({ listsOnly: true }).then((latest) => {
        const refreshed = latest?.find(
          (item) => item.id === target?.id && item.kind === target?.kind,
        );
        if (refreshed)
          setSelectedRequest((current) =>
            current?.id === refreshed.id && current.kind === refreshed.kind
              ? refreshed
              : current,
          );
      });
    },
  });

  // Filter cho bảng Đang chờ duyệt (Sub-tab 2)
  // Lọc theo người đang chờ duyệt / bước hiện tại của quy trình (dùng chung hai tab).
  const [waitAssignee, setWaitAssignee] = useState('');
  const [waitStep, setWaitStep] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKind, setFilterKind] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<RequestStatusFilter>('PENDING');
  /** Tháng đang xem (theo ngày tạo đơn); null là mọi tháng. */
  const [listMonth, setListMonth] = useState<string | null>(() => currentMonthVn());

  // Profile data from API
  const [profile, setProfile] = useState<
    EmployeeProfileHeroData & { id: string }
  >({
    id: '',
    fullName: '',
    employeeCode: '',
    department: '',
    position: '',
    employmentStatus: '',
    workEmail: '',
    phone: '',
    roleLabel: '',
    joinDate: '',
  });

  const [rawProfile, setRawProfile] = useState<Record<string, any>>({});

  // Annual leave balance
  const [leaveBalances, setLeaveBalances] = useState<
    Record<
      string,
      {
        remaining: string;
        entitlement: string;
        advanceAllowed?: boolean;
        advanceHeadroom?: string;
        seniorityDays?: string;
      }
    >
  >({});
  // Quỹ phép năm khả dụng (loại nghỉ phép năm, như Bàn làm việc): thẻ Đơn xin nghỉ phép và chi tiết đơn nghỉ.
  const leaveBalance = leaveBalances[leaveTypes.find((t) => t.isAnnual)?.id ?? ''] || {
    remaining: '----',
    entitlement: '----',
    advanceAllowed: false,
  };

  // Requests list fetched from API
  const [requestsList, setRequestsList] = useState<RequestItem[]>([]);
  const [notificationRequestId, setNotificationRequestId] = useState('');
  // Đơn vừa mở từ liên kết ?request=: bỏ một lượt tự chọn đơn đầu tiên và lật tới trang chứa đơn đó.
  const skipAutoSelect = useRef(false);
  const focusRequestId = useRef('');
  useEffect(() => {
    setNotificationRequestId(new URLSearchParams(window.location.search).get('request') ?? '');
  }, []);
  // ?create=<loại đơn> (lối tắt ở Bàn làm việc): mở thẳng form tạo đơn sau khi danh mục đã tải, chỉ một lần.
  const createFromLink = useRef(false);
  useEffect(() => {
    if (createFromLink.current || loading) return;
    const want = new URLSearchParams(window.location.search).get('create');
    if (!want) return;
    const target = requestCatalog.find((c) => c.id === want && !c.customType);
    if (!target) return;
    createFromLink.current = true;
    void handleOpenCreateForType(target.id, target.title, null);
  });

  /**
   * Danh mục hiển thị: loại đơn cấu hình từ API (tên, mô tả, thứ tự do quản trị đặt, chỉ gồm loại đang bật);
   * chưa tải được thì dùng các loại hệ thống.
   */
  const requestCatalog = requestCatalogOf(requestTypes, leaveBalance.remaining);

  /**
   * Tải dữ liệu trang. `listsOnly` (sau khi gửi, rút đơn, mở chi tiết) chỉ tải lại các danh sách đơn: không tải lại hồ sơ,
   * danh mục và không bật màn hình chờ, để trang không nháy và không gọi lại hàng chục yêu cầu.
   */
  async function loadData(opts?: { listsOnly?: boolean }) {
    try {
      if (!opts?.listsOnly) setLoading(true);

      // 1. Fetch user profile
      let empId = empIdRef.current;
      const needProfile = !(opts?.listsOnly && empId);
      if (needProfile) {
      const profRes = await fetch(hrmApiUrl('/my-profile'), {
        credentials: 'same-origin',
      });
      if (!profRes.ok) {
        const error = await profRes.json();
        throw new Error(error.message || 'Không thể tải hồ sơ nhân viên');
      }
      if (profRes.ok) {
        const payload = await profRes.json();
        const p = payload.data;
        if (p) {
          empId = p.employeeId || '';
          if (!empId) throw new Error('Tài khoản chưa liên kết nhân viên');
          const statusLabel =
            p.employmentStatus === 'OFFICIAL'
              ? 'CHÍNH THỨC (Official)'
              : p.employmentStatus === 'PROBATION'
                ? 'THỬ VIỆC (Probation)'
                : p.employmentStatus === 'ON_LEAVE'
                  ? 'NGHỈ PHÉP (On Leave)'
                  : p.employmentStatus === 'RESIGNED'
                    ? 'ĐÃ NGHỈ VIỆC (Resigned)'
                    : p.employmentStatus === 'TERMINATED'
                      ? 'CHẤM DỨT HĐ (Terminated)'
                      : p.employmentStatus || '';

          setProfile({
            id: p.employeeId || '',
            fullName: p.fullName || '',
            employeeCode: p.employeeCode || '',
            department: p.department || '',
            position: p.position || '',
            employmentStatus: statusLabel,
            workEmail: p.email || p.personalEmail || '',
            phone: p.phone || '',
            roleLabel: '',
            joinDate: p.joinDate ? String(p.joinDate).slice(0, 10) : '',
          });

          setRawProfile(p);
        }
      }
      empIdRef.current = empId;
      }

      // 2. Danh mục dùng cho form tạo đơn (loại nghỉ, ca, dự án, quỹ phép, loại đơn): tải song song với danh sách đơn,
      // không chặn việc hiện danh sách.
      const loadMaster = async () => {
      // Dự án đọc qua API của Workspace, không qua HRM.
      void loadLinkableProjects().then(setWorkspaceProjects);
      const [ltRes, shiftRes] = await Promise.all([
        fetch('/api/hrm/v1/leave-types?active=true', {
          credentials: 'same-origin',
        }),
        fetch('/api/hrm/v1/shifts?status=ACTIVE', {
          credentials: 'same-origin',
        }),
      ]);

      if (ltRes.ok) {
        const payload = await ltRes.json();
        const types: LeaveTypeItem[] = payload.data || [];
        setLeaveTypes(types);
      }

      if (shiftRes.ok) {
        const payload = await shiftRes.json();
        const sList: ShiftItem[] = payload.data || [];
        setShiftsList(sList);
      }

      // 3. Fetch leave balances if empId exists
      if (empId) {
        const balRes = await fetch(
          hrmApiUrl(`/employees/${empId}/leave-balances`),
          { credentials: 'same-origin' },
        );
        if (balRes.ok) {
          const payload = await balRes.json();
          setLeaveBalances(leaveBalancesOf(payload.data || []));
        }
      }

      // Danh mục loại đơn cấu hình; máy chủ chưa hỗ trợ thì dùng 7 loại hệ thống.
      try {
        const typesRes = await fetch(hrmApiUrl('/request-types'), {
          credentials: 'same-origin',
        });
        if (typesRes?.ok) {
          const payload = await typesRes.json();
          setRequestTypes(Array.isArray(payload?.data) ? payload.data : []);
        }
      } catch {
        setRequestTypes([]);
      }

      };
      if (!opts?.listsOnly) void loadMaster().catch(() => undefined);

      // 4. Tải mọi danh sách đơn cùng lúc, gồm cả đơn của loại tuỳ chỉnh
      const empQuery = empId ? `?employee_id=${empId}` : '';
      const [
        leaveRes,
        otRes,
        tripRes,
        shiftChangeRes,
        corrRes,
        advRes,
        profileRes,
        customRes,
      ] = await Promise.all([
        fetch(hrmApiUrl(`/leave-requests${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/ot-requests${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/business-trip-requests${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/shift-change-requests${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/attendance-corrections${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/salary-advance-requests${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/profile-corrections${empQuery}`), {
          credentials: 'same-origin',
        }),
        fetch(hrmApiUrl(`/custom-requests${empQuery}`), {
          credentials: 'same-origin',
        }).catch(() => null),
      ]);

      const mergedList: RequestItem[] = [];

      // 4.1 Leave Requests
      if (leaveRes.ok) {
        const payload = await leaveRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isApplied = Boolean(item.appliedAt);
          const wfStatus = isApproved
            ? 'APPROVED'
            : item.status === 'REJECTED' || item.status === 'CANCELLED'
              ? 'REJECTED'
              : 'PENDING_APPROVAL';
          const reqStatus = isApplied
            ? 'APPLIED'
            : isApproved
              ? 'APPROVED'
              : item.status === 'CANCELLED'
                ? 'CANCELLED'
                : item.status === 'REJECTED'
                  ? 'REJECTED'
                  : 'PENDING';
          const stText = isApplied
            ? 'Đã áp dụng vào công'
            : isApproved
              ? 'Đã duyệt'
              : wfStatus === 'REJECTED'
                ? 'Đã từ chối'
                : 'Chờ phê duyệt';
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `LEAVE-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'leave',
            typeName: 'Đơn xin nghỉ phép',
            category: 'Nghỉ phép',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.fromAt
              ? formatRequestPeriod(item)
              : `${item.fromDate ? formatDate(item.fromDate) : '----'} - ${item.toDate ? formatDate(item.toDate) : '----'}`,
            duration: `${item.duration || 1} ngày`,
            ...requestReasonView(item),
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.2 OT Requests
      if (otRes.ok) {
        const payload = await otRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const wfStatus = isApproved
            ? 'APPROVED'
            : item.status === 'REJECTED' || item.status === 'CANCELLED'
              ? 'REJECTED'
              : 'PENDING_APPROVAL';
          const reqStatus = isApproved
            ? 'APPROVED'
            : item.status === 'CANCELLED'
              ? 'CANCELLED'
              : item.status === 'REJECTED'
                ? 'REJECTED'
                : 'PENDING';
          const plannedHrs = item.plannedMinutes
            ? (item.plannedMinutes / 60).toFixed(1)
            : '----';
          const stText = isApproved
            ? 'Đã duyệt OT'
            : wfStatus === 'REJECTED'
              ? 'Đã từ chối'
              : 'Chờ duyệt OT';
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `OT-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'ot',
            typeName: `Làm thêm giờ (${item.otType || 'OT'})`,
            category: 'Làm thêm giờ',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.fromAt
              ? formatRequestPeriod(item)
              : `${item.workDate ? formatDate(item.workDate) : '----'} (${item.startTime || '----'} - ${item.endTime || '----'})`,
            duration: `${plannedHrs} giờ (${item.otRateMultiplier || 1.5}x)`,
            ...requestReasonView(item),
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.3 Business Trip Requests
      if (tripRes.ok) {
        const payload = await tripRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const wfStatus = isApproved
            ? 'APPROVED'
            : item.status === 'REJECTED' || item.status === 'CANCELLED'
              ? 'REJECTED'
              : 'PENDING_APPROVAL';
          const reqStatus = isApproved
            ? 'APPROVED'
            : item.status === 'CANCELLED'
              ? 'CANCELLED'
              : item.status === 'REJECTED'
                ? 'REJECTED'
                : 'PENDING';
          const stText = isApproved
            ? 'Đã duyệt công tác'
            : wfStatus === 'REJECTED'
              ? 'Đã từ chối'
              : 'Chờ phê duyệt';
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `TRIP-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'business_trip',
            typeName: `Công tác (${item.destination || '----'})`,
            category: 'Công tác',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.fromAt
              ? formatRequestPeriod(item)
              : `${item.fromDate ? formatDate(item.fromDate) : '----'} - ${item.toDate ? formatDate(item.toDate) : '----'}`,
            duration: `${item.daysCount || 1} ngày`,
            ...requestReasonView(item),
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.4 Shift Change Requests
      if (shiftChangeRes.ok) {
        const payload = await shiftChangeRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isPeerConfirmed =
            item.status === 'PEER_CONFIRMED' || item.swapPeerConfirmed;
          const isApplied = Boolean(item.appliedAt);

          let wfStatus: RequestItem['workflowStatus'] = 'PENDING_APPROVAL';
          let reqStatus: RequestItem['requestStatus'] = 'PENDING';
          let stText = 'Chờ quản lý duyệt';

          if (
            item.status === 'PENDING' &&
            item.swapWithEmployeeId &&
            !isPeerConfirmed
          ) {
            wfStatus = 'PENDING_PEER';
            reqStatus = 'PENDING';
            stText = 'Chờ đồng nghiệp xác nhận';
          } else if (item.status === 'PEER_CONFIRMED') {
            wfStatus = 'PENDING_APPROVAL';
            reqStatus = 'PENDING';
            stText = 'Đồng nghiệp đã xác nhận - Chờ duyệt';
          } else if (isApproved) {
            wfStatus = 'APPROVED';
            reqStatus = isApplied ? 'APPLIED' : 'APPROVED';
            stText = isApplied ? 'Đã cập nhật ca làm việc' : 'Đã duyệt';
          } else if (item.status === 'REJECTED') {
            wfStatus = 'REJECTED';
            reqStatus = 'REJECTED';
            stText = 'Đã từ chối';
          }
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `SHIFT-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'shift_change',
            typeName:
              item.changeType === 'SWAP'
                ? 'Đổi ca với đồng nghiệp'
                : 'Đề nghị chuyển ca',
            category: 'Đổi ca',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? formatDate(item.fromDate) : '----'} - ${item.toDate ? formatDate(item.toDate) : '----'}`,
            duration:
              item.changeType === 'SWAP' ? 'Hoán đổi ca trực' : 'Thay đổi ca',
            ...requestReasonView(item),
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL' || wfStatus === 'PENDING_PEER',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.5 Attendance Correction Requests
      if (corrRes.ok) {
        const payload = await corrRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isApplied = Boolean(item.appliedAt);
          const wfStatus = isApproved
            ? 'APPROVED'
            : item.status === 'REJECTED' || item.status === 'CANCELLED'
              ? 'REJECTED'
              : 'PENDING_APPROVAL';
          const reqStatus = isApplied
            ? 'APPLIED'
            : isApproved
              ? 'APPROVED'
              : item.status === 'CANCELLED'
                ? 'CANCELLED'
                : item.status === 'REJECTED'
                  ? 'REJECTED'
                  : 'PENDING';
          const inTime = item.newCheckInAt
            ? new Date(item.newCheckInAt).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })
            : '----';
          const outTime = item.newCheckOutAt
            ? new Date(item.newCheckOutAt).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })
            : '----';
          const stText = isApplied
            ? 'Đã cập nhật Timesheet'
            : isApproved
              ? 'Đã duyệt giải trình'
              : wfStatus === 'REJECTED'
                ? 'Đã từ chối'
                : 'Chờ phê duyệt';
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `CORR-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'correction',
            typeName: 'Giải trình / Bổ sung công',
            category: 'Chấm công',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? formatDate(item.requestDate)
              : '----',
            duration: `Vào: ${inTime} | Ra: ${outTime}`,
            ...requestReasonView(item),
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.6 Salary Advance Requests
      if (advRes.ok) {
        const payload = await advRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isDisbursed =
            item.status === 'DISBURSED' || Boolean(item.disbursedAt);
          const wfStatus =
            isApproved || isDisbursed
              ? 'APPROVED'
              : item.status === 'REJECTED' || item.status === 'CANCELLED'
                ? 'REJECTED'
                : 'PENDING_APPROVAL';
          const reqStatus = isDisbursed
            ? 'DISBURSED'
            : isApproved
              ? 'APPROVED'
              : item.status === 'CANCELLED'
                ? 'CANCELLED'
                : item.status === 'REJECTED'
                  ? 'REJECTED'
                  : 'PENDING';
          const stText = isDisbursed
            ? 'Đã giải ngân'
            : isApproved
              ? 'Đã duyệt - Chờ chi'
              : wfStatus === 'REJECTED'
                ? 'Đã từ chối'
                : 'Chờ phê duyệt';
          const createdTimeMs = item.createdAt
            ? new Date(item.createdAt).getTime()
            : 0;

          mergedList.push({
            id: item.id,
            code: `ADV-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'advance',
            typeName: 'Đơn xin tạm ứng lương',
            category: 'Tạm ứng',
            createdAt: item.createdAt
              ? formatDate(item.createdAt)
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? formatDate(item.requestDate)
              : '----',
            duration: `${Number(item.requestedAmount || 0).toLocaleString('vi-VN')} đ (${item.numberOfInstallments || 1} kỳ)`,
            // Ứng lương không có danh mục lý do: nội dung nhập tự do chính là lý do.
            reason: reasonCell(item.reason),
            description: '—',
            approver: approverFallbackLabel(
              item.approvedBy,
              wfStatus === 'PENDING_APPROVAL',
            ),
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // Đơn của các loại tuỳ chỉnh.
      try {
        if (customRes?.ok) {
          const payload = await customRes.json();
          for (const item of payload?.data || [])
            mergedList.push(customRequestItem(item));
        }
      } catch {
        // Máy chủ chưa có đơn tuỳ chỉnh: danh sách chỉ gồm các đơn hệ thống.
      }

      if (profileRes.ok) {
        const payload = await profileRes.json();
        for (const item of payload.data || [])
          mergedList.push({
            id: item.id,
            code: `PRO-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'profile_correction',
            typeName: 'Điều chỉnh hồ sơ',
            category: 'Hồ sơ',
            createdAt: formatDate(item.createdAt),
            effectiveDate: 'Theo ngày duyệt',
            duration: `${Object.keys(item.changes || {}).length} trường`,
            reason: reasonCell(item.reason),
            description: '—',
            approver: approverFallbackLabel(
              item.reviewed_by ?? item.reviewedBy,
              item.status !== 'APPROVED' && item.status !== 'REJECTED',
            ),
            workflowStatus:
              item.status === 'APPROVED'
                ? 'APPROVED'
                : item.status === 'REJECTED'
                  ? 'REJECTED'
                  : 'PENDING_APPROVAL',
            requestStatus: item.status,
            statusText:
              item.status === 'APPROVED'
                ? 'Đã duyệt'
                : item.status === 'REJECTED'
                  ? 'Đã từ chối'
                  : 'Chờ phê duyệt',
            rawCreatedAt: item.createdAt,
            createdTimeMs: Date.parse(item.createdAt) || 0,
            rawDetails: item,
          });
      }
      // Sort newest first
      for (const item of mergedList) {
        if (item.rawDetails.status === 'CANCELLED') {
          item.requestStatus = 'CANCELLED';
          item.workflowStatus = 'CANCELLED';
          item.statusText = 'Đã rút / hủy';
        }
        if (item.rawDetails.status === 'REPAID') {
          item.requestStatus = 'REPAID';
          item.workflowStatus = 'APPROVED';
          item.statusText = 'Đã thu hồi đủ';
        }
      }
      mergedList.sort((a, b) =>
        String(
          b.rawDetails.createdAt || b.rawDetails.created_at || '',
        ).localeCompare(
          String(a.rawDetails.createdAt || a.rawDetails.created_at || ''),
        ),
      );
      setRequestsList(mergedList);
      return mergedList;
    } catch (err) {
      if (!opts?.listsOnly) setRequestsList([]);
      toast.error(
        err instanceof Error ? err.message : 'Không thể tải danh sách đơn từ',
      );
      return undefined;
    } finally {
      if (!opts?.listsOnly) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Tổng số lượng đơn đang chờ duyệt thực tế (dùng cho badge hiển thị trên Tab)
  // Bộ lọc danh sách: tháng (theo ngày tạo), từ khóa, loại đơn và bước quy trình; trạng thái lọc thêm ở bên dưới.
  const baseFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requestsList.filter((item) => {
      // Đơn đã rút/hủy không cần theo dõi tiếp: ẩn khỏi bảng và số trên tab (dữ liệu vẫn giữ), giống trang duyệt đơn.
      if (item.requestStatus === 'CANCELLED') return false;
      if (!inMonth(item, listMonth)) return false;
      const matchSearch =
        !q ||
        item.code.toLowerCase().includes(q) ||
        item.typeName.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.approver.toLowerCase().includes(q);
      const matchKind = filterKind === 'ALL' || item.kind === filterKind;
      const matchWorkflow = matchesWorkflowFilter(item.rawDetails, {
        assignee: waitAssignee,
        currentStep: waitStep,
      });
      return matchSearch && matchKind && matchWorkflow;
    });
  }, [requestsList, listMonth, searchQuery, filterKind, waitAssignee, waitStep]);

  const filteredHistory = useMemo(
    () => baseFiltered.filter((item) => matchesStatusFilter(item, filterStatus)),
    [baseFiltered, filterStatus],
  );

  const statusTabs = useMemo(
    () =>
      (
        [
          ['ALL', 'Tất cả'],
          ['PENDING', 'Chờ duyệt'],
          ['APPROVED', 'Đã duyệt'],
          ['REJECTED', 'Từ chối'],
        ] as const
      ).map(([id, label]) => ({
        id,
        label,
        count: baseFiltered.filter((item) => matchesStatusFilter(item, id)).length,
      })),
    [baseFiltered],
  );

  // Đổi bộ lọc thì quay về trang đầu để không đứng ở trang không còn dữ liệu.
  useEffect(() => {
    setHistoryPage(1);
  }, [waitAssignee, waitStep, searchQuery, filterKind, filterStatus, listMonth]);

  const historySlice = useMemo(
    () => paginate(filteredHistory, historyPage, REQUEST_HISTORY_PAGE_SIZE),
    [filteredHistory, historyPage],
  );

  const handleExportHistory = () => {
    if (filteredHistory.length === 0) {
      toast.error({
        title: 'Không có dữ liệu để xuất',
        description: 'Danh sách lịch sử đơn đang lọc không có dòng nào.',
      });
      return;
    }
    exportRequestHistory(filteredHistory, approverText);
    toast.success({
      title: 'Đã xuất lịch sử đơn',
      description: `Đã tải về ${filteredHistory.length} dòng (Excel).`,
    });
  };

  const workflowStepOptions = useMemo(
    () =>
      distinctCurrentSteps(requestsList.map((item) => item.rawDetails)).map(
        (name) => ({ value: name, label: name }),
      ),
    [requestsList],
  );
  const workflowFilterControls = (
    <>
      <div className="w-52">
        <Input
          aria-label="Đang chờ ai duyệt"
          placeholder="Đang chờ ai duyệt (tên, chức danh)"
          value={waitAssignee}
          onChange={(e) => setWaitAssignee(e.target.value)}
          className="h-8 text-xs bg-white"
        />
      </div>
      <div className="w-48">
        <SearchableSelect
          height={36}
          options={workflowStepOptions}
          value={waitStep}
          onChange={(val) => setWaitStep(val || '')}
          placeholder="Bước hiện tại..."
          clearable
        />
      </div>
    </>
  );

  // Bộ lọc loại đơn: bảy loại hệ thống, thêm các loại tuỳ chỉnh đã có đơn của người dùng.
  const kindFilterOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Tất cả loại đơn' },
      { value: 'leave', label: 'Nghỉ phép' },
      { value: 'ot', label: 'Làm thêm giờ (OT)' },
      { value: 'business_trip', label: 'Công tác' },
      { value: 'shift_change', label: 'Đổi ca' },
      { value: 'correction', label: 'Bổ sung công' },
      { value: 'advance', label: 'Tạm ứng lương' },
      { value: 'profile_correction', label: 'Đính chính nhân sự' },
      ...(requestsList.some((item) => item.kind === 'custom')
        ? [{ value: 'custom', label: 'Loại đơn tuỳ chỉnh' }]
        : []),
    ],
    [requestsList],
  );

  const handleOpenCreateForType = (
    catId: RequestKind,
    typeTitle: string,
    customType: HrmRequestType | null = null,
    initial?: RequestFormInitial,
  ) => {
    setCreateForm((current) => ({
      seq: (current?.seq ?? 0) + 1,
      kind: catId,
      title: typeTitle,
      customType,
      initial,
    }));
    setIsCreateModalOpen(true);
  };

  /**
   * Đơn điều chỉnh cho một đơn đã bị huỷ hiệu lực (link trong thông báo "Cần
   * gửi đơn điều chỉnh"): mở form cùng loại, điền sẵn nội dung đơn cũ.
   */
  const openAdjustment = (original: RequestItem) => {
    const catalog = requestCatalog.find((entry) => entry.id === original.kind);
    const d = original.rawDetails;
    const str = (key: string, fallback = '') =>
      d[key] === undefined || d[key] === null ? fallback : String(d[key]);
    // Ngày từ API có thể là chuỗi ngày hoặc ISO kèm giờ: đọc theo giờ địa phương.
    const day = (key: string) => {
      const value = d[key];
      if (typeof value !== 'string' || !value) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value.slice(0, 10);
      const pad = (part: number) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const from = day('fromDate') || day('workDate') || day('requestDate');
    const to = day('toDate') || from;
    const initial: RequestFormInitial = {};
    if (from) initial.fromDate = from;
    if (to) initial.toDate = to;
    // Lý do chọn từ danh mục: đơn nghỉ là loại nghỉ, các loại khác là `reasonId`.
    const reasonRef = original.kind === 'leave' ? str('leaveTypeId') : str('reasonId');
    if (reasonRef) initial.reasonId = reasonRef;
    initial.description = `Điều chỉnh đơn ${original.code}`;
    if (original.kind === 'leave') initial.leaveDuration = str('duration', '1');
    if (original.kind === 'ot') {
      initial.startTime = str('startTime', '18:00').slice(0, 5);
      initial.endTime = str('endTime', '21:00').slice(0, 5);
    }
    if (original.kind === 'business_trip') {
      initial.tripType = str('businessTripType', 'DOMESTIC') as HrmBusinessTripType;
      initial.destination = str('destination');
      initial.allowOt = d.allowOt === true;
      initial.project = { id: str('projectId'), code: str('projectCode'), name: str('projectName') };
    }
    if (original.kind === 'advance') {
      initial.requestedAmount = str('requestedAmount', '0');
      initial.numberOfInstallments = str('numberOfInstallments', '1');
    }
    handleOpenCreateForType(original.kind, catalog?.title ?? original.typeName, null, initial);
  };

  // `?adjust=<loại>:<id>` từ thông báo: chờ danh sách đơn của mình nạp xong
  // rồi mở form điều chỉnh, sau đó dọn tham số để tải lại không mở lại form.
  const adjustHandled = useRef(false);
  useEffect(() => {
    if (adjustHandled.current || requestsList.length === 0) return;
    const param = new URLSearchParams(window.location.search).get('adjust');
    if (!param) return;
    adjustHandled.current = true;
    const [kind, id] = param.split(':');
    const original = requestsList.find((item) => item.id === id && item.kind === kind);
    const url = new URL(window.location.href);
    url.searchParams.delete('adjust');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (original) void openAdjustment(original);
    // Chỉ chạy một lần (adjustHandled) khi danh sách đơn có dữ liệu.
  }, [requestsList]);

  // Gửi đơn xong: đóng form, tải lại danh sách và đưa người dùng tới đơn vừa gửi (tháng hiện tại, nhóm chờ duyệt).
  const handleRequestSubmitted = async () => {
    setIsCreateModalOpen(false);
    await loadData({ listsOnly: true });
    setListMonth(currentMonthVn());
    setFilterStatus('PENDING');
  };

  // Một phần khoảng thời gian đã thành đơn rồi gặp lỗi: đóng form để không gửi trùng, tải lại danh sách.
  const handleRequestAbandoned = async () => {
    setIsCreateModalOpen(false);
    await loadData({ listsOnly: true });
  };

  // Xác nhận đổi ca chéo cho đồng nghiệp
  const handlePeerConfirm = async (requestId: string, confirmed: boolean) => {
    try {
      const res = await fetch(
        hrmApiUrl(`/shift-change-requests/${requestId}/peer-confirm`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({ confirmed }),
        },
      );
      if (res.ok) {
        toast.success({
          title: confirmed ? 'Đã xác nhận đổi ca' : 'Đã từ chối đổi ca',
          description:
            'Hồ sơ đã được cập nhật trạng thái trong chu trình phê duyệt.',
        });
        setIsDetailDrawerOpen(false);
        await loadData({ listsOnly: true });
      } else {
        toast.error({
          title: 'Thao tác không thành công',
          description: 'Vui lòng kiểm tra lại quyền hạn hoặc thử lại sau.',
        });
      }
    } catch (err) {
      console.error('Peer confirm error:', err);
    }
  };

  // Hủy đơn khi còn ở trạng thái Pending
  const handleCancelRequest = async (reqItem: RequestItem) => {
    const endpoint = hrmApiUrl(
      `/requests/${reqItem.kind}/${reqItem.id}/withdraw`,
    );

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
      });
      if (res.ok) {
        const result = await res.json();
        const withdrawn = result.data?.withdrawn === true;
        toast.success({
          title: withdrawn ? 'Đã hủy đơn thành công' : 'Đã gửi yêu cầu rút đơn',
          description: withdrawn
            ? `Đơn ${reqItem.code} đã được rút khỏi luồng phê duyệt.`
            : 'Đang chờ kết quả Procedure được áp dụng vào HRM.',
        });
        setIsDetailDrawerOpen(false);
        await loadData({ listsOnly: true });
      } else {
        toast.error({
          title: 'Hủy đơn thất bại',
          description: 'Không thể hủy đơn ở trạng thái hiện tại.',
        });
      }
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  };

  // Mở Drawer chi tiết; tiến độ do useProcedureProgress tải và tự làm mới
  const handleOpenDetailDrawer = (reqItem: RequestItem) => {
    setSelectedRequest(reqItem);
    setIsDetailDrawerOpen(true);
  };

  // Chuẩn bị options SearchableSelect
  useEffect(() => {
    if (!notificationRequestId) return;
    const request = requestsList.find((item) => item.id === notificationRequestId);
    if (!request) return;
    setNotificationRequestId('');
    skipAutoSelect.current = true;
    focusRequestId.current = request.id;
    // Mở đúng đơn trong thông báo: bỏ các bộ lọc có thể che đơn đó, chuyển tới tháng của đơn.
    setFilterStatus('ALL');
    setFilterKind('ALL');
    setSearchQuery('');
    setWaitAssignee('');
    setWaitStep('');
    setListMonth(requestMonthOf(request) || null);
    setSelectedRequest(request);
  }, [notificationRequestId, requestsList]);

  // Luôn có một đơn đang chọn trong danh sách đang lọc (đơn đầu tiên nếu đơn cũ không còn); bỏ qua khi ngăn kéo đang mở.
  useEffect(() => {
    if (isDetailDrawerOpen) return;
    // Effect mở đơn từ liên kết chạy ngay trước effect này trong cùng một lượt với danh sách cũ; không để nó
    // chọn đè lại đơn đầu tiên.
    if (skipAutoSelect.current) {
      skipAutoSelect.current = false;
      return;
    }
    const next = pickSelectedId(filteredHistory, selectedRequest?.id ?? null);
    if (next === (selectedRequest?.id ?? null)) return;
    setSelectedRequest(filteredHistory.find((item) => item.id === next) ?? null);
  }, [filteredHistory, selectedRequest?.id, isDetailDrawerOpen]);

  // Lật danh sách tới trang chứa đơn vừa mở từ liên kết (sau khi bộ lọc đã được bỏ và danh sách đã lọc lại).
  useEffect(() => {
    const id = focusRequestId.current;
    if (!id) return;
    // Chờ các bộ lọc đã được bỏ, nếu không effect đặt lại trang về 1 sẽ chạy sau và đè lên.
    if (
      filterStatus !== 'ALL' ||
      filterKind !== 'ALL' ||
      searchQuery ||
      waitAssignee ||
      waitStep
    )
      return;
    const index = filteredHistory.findIndex((item) => item.id === id);
    if (index < 0) return;
    focusRequestId.current = '';
    setHistoryPage(Math.floor(index / REQUEST_HISTORY_PAGE_SIZE) + 1);
  }, [filteredHistory, filterStatus, filterKind, searchQuery, waitAssignee, waitStep]);

  // Sau mỗi lần tải lại danh sách, đơn đang chọn lấy dữ liệu mới nhất của chính nó.
  useEffect(() => {
    setSelectedRequest((current) => {
      if (!current) return current;
      const fresh = requestsList.find((item) => item.id === current.id && item.kind === current.kind);
      return fresh && fresh !== current ? fresh : current;
    });
  }, [requestsList]);

  const workflowFallback = (
      <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-3">
        <div className="flex items-center gap-3">
          <div className="size-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
            <Check className="size-3.5" />
          </div>
          <div>
            <div className="font-semibold text-slate-800">
              Nhân viên khởi tạo yêu cầu
            </div>
            <div className="text-[12px] text-slate-400">
              {selectedRequest?.createdAt}
            </div>
          </div>
        </div>

        {selectedRequest?.kind === 'shift_change' && (
          <div className="flex items-center gap-3">
            <div
              className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${selectedRequest.workflowStatus !== 'PENDING_PEER'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
                }`}
            >
              {selectedRequest.workflowStatus !== 'PENDING_PEER'
                ? <Check className="size-3.5" />
                : '•'}
            </div>
            <div>
              <div className="font-semibold text-slate-800">
                Đồng nghiệp xác nhận đổi ca
              </div>
              <div className="text-[12px] text-slate-500">
                {selectedRequest.workflowStatus !== 'PENDING_PEER'
                  ? 'Đã xác nhận chéo'
                  : 'Đang chờ phản hồi'}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div
            className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${selectedRequest?.workflowStatus === 'APPROVED'
              ? 'bg-emerald-100 text-emerald-700'
              : selectedRequest?.workflowStatus === 'REJECTED'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-amber-100 text-amber-700'
              }`}
          >
            {selectedRequest?.workflowStatus === 'APPROVED'
              ? <Check className="size-3.5" />
              : selectedRequest?.workflowStatus === 'REJECTED'
                ? <X className="size-3.5" />
                : '•'}
          </div>
          <div>
            <div className="font-semibold text-slate-800">
              Cấp thẩm quyền phê duyệt:{' '}
              <strong>{selectedRequest?.approver}</strong>
            </div>
            <div className="text-[12px] text-slate-500">
              {selectedRequest?.requestStatus === 'CANCELLED'
                ? 'Đã rút / hủy'
                : selectedRequest?.workflowStatus === 'APPROVED'
                  ? 'Đã chấp thuận'
                  : selectedRequest?.workflowStatus === 'REJECTED'
                    ? 'Đã từ chối'
                    : 'Đang chờ xét duyệt (SLA 24h)'}
            </div>
          </div>
        </div>
      </div>
  );

  // Mở chứng từ đính kèm của đơn (liên kết tải có thời hạn do máy chủ cấp).
  const handleOpenAttachment = async (fileId: string) => {
    try {
      const file = await hrmFetch<{ data: { url: string } }>(
        `/attachments/${fileId}/download`,
      );
      window.open(file.data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Không tải được chứng từ',
      );
    }
  };

  const detailRow = selectedRequest;
  const activeMonth = listMonth ?? currentMonthVn();
  const monthTitle = listMonth
    ? `Danh sách đơn trong tháng ${listMonth.slice(5, 7)}/${listMonth.slice(0, 4)}`
    : 'Danh sách đơn của tất cả các tháng';

  const quickItems: QuickCreateItem[] = QUICK_CREATE_KINDS.flatMap((kind) => {
    const cat = requestCatalog.find((c) => c.id === kind && !c.customType);
    return cat
      ? [
          {
            key: cat.id,
            kind: cat.id,
            title: cat.title,
            desc: cat.desc,
            onClick: () => handleOpenCreateForType(cat.id, cat.title, cat.customType),
          },
        ]
      : [];
  });
  const otherCatalog = requestCatalog.filter(
    (c) => !quickItems.some((q) => q.key === c.id && !c.customType),
  );

  const canCancelSelected =
    selectedRequest?.workflowStatus === 'PENDING_APPROVAL' ||
    (selectedRequest?.workflowStatus === 'PENDING_PEER' &&
      selectedRequest.rawDetails.employeeId === profile.id) ||
    selectedRequest?.workflowStatus === 'SUBMITTED';
  const canPeerConfirmSelected =
    selectedRequest?.kind === 'shift_change' &&
    selectedRequest.rawDetails.swapWithEmployeeId === profile.id &&
    selectedRequest.workflowStatus === 'PENDING_PEER';
  const detailAttachmentId =
    typeof selectedRequest?.rawDetails.attachmentFileId === 'string'
      ? selectedRequest.rawDetails.attachmentFileId
      : '';

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Đơn từ của tôi</h1>
          <p className="text-xs text-slate-500">Tạo mới và theo dõi trạng thái các yêu cầu cá nhân.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthStepper month={activeMonth} onChange={setListMonth} />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={listMonth === null}
            className="h-9 text-xs"
            title="Xem đơn của mọi tháng thay vì một tháng"
            onClick={() => setListMonth(listMonth === null ? currentMonthVn() : null)}
          >
            Tất cả tháng
          </Button>
          {canCreateRequest && (
            <RowMenu
              label="Chọn loại đơn để tạo"
              buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/80"
              trigger={
                <>
                  <Plus className="size-3.5" />
                  <span>Tạo đơn mới</span>
                </>
              }
              items={[
                ...quickItems.map((q) => ({ key: q.key, label: q.title, onSelect: () => void q.onClick() })),
                ...otherCatalog.map((c) => ({
                  key: c.customType?.id ?? c.id,
                  label: c.title,
                  onSelect: () => void handleOpenCreateForType(c.id, c.title, c.customType),
                })),
              ]}
            />
          )}
        </div>
      </div>

      {!canCreateRequest && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Tài khoản của bạn chưa được cấp quyền tạo đơn. Bạn vẫn xem được lịch sử đơn của mình.
        </div>
      )}
      {loading && (
        <p role="status" className="py-2 text-center text-xs text-slate-500">
          Đang tải danh mục loại đơn...
        </p>
      )}
      {!loading && canCreateRequest && (
        <>
          <QuickCreateRow
            items={quickItems}
            extraCount={otherCatalog.length}
            showAll={showAllTypes}
            onToggleAll={() => setShowAllTypes((v) => !v)}
          />
          {showAllTypes && otherCatalog.length > 0 && (
            <div
              aria-label="Các loại đơn khác"
              className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:grid-cols-2 xl:grid-cols-4"
            >
              {otherCatalog.map((cat) => (
                <button
                  key={cat.customType?.id ?? cat.id}
                  type="button"
                  aria-label={`Khởi tạo đơn này: ${cat.title}`}
                  onClick={() => handleOpenCreateForType(cat.id, cat.title, cat.customType)}
                  className="group flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-[#ffc90a] hover:bg-amber-50/40"
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cat.iconBg}`}>
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span role="heading" aria-level={3} className="truncate text-[14px] font-bold text-slate-900">
                        {cat.title}
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[12px] font-semibold">
                        {cat.tag}
                      </Badge>
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[12px] text-slate-500">{cat.desc}</span>
                    {cat.balanceLabel ? (
                      <span className="mt-1 block truncate text-[12px] font-medium text-slate-600">
                        {cat.balanceLabel}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <RequestListPanel
          title={monthTitle}
          rows={historySlice.items}
          startIndex={historySlice.from > 0 ? historySlice.from - 1 : 0}
          selectedId={selectedRequest?.id ?? null}
          onSelect={(id) => {
            const next = requestsList.find((item) => item.id === id);
            if (next) setSelectedRequest(next);
          }}
          loading={loading}
          tabs={statusTabs}
          status={filterStatus}
          onStatusChange={setFilterStatus}
          search={searchQuery}
          onSearchChange={setSearchQuery}
          kind={filterKind}
          onKindChange={setFilterKind}
          kindOptions={kindFilterOptions}
          advancedFilters={showAdvancedFilters ? workflowFilterControls : undefined}
          hasActiveFilters={Boolean(
            searchQuery || waitAssignee || waitStep || filterKind !== 'ALL' || filterStatus !== 'ALL',
          )}
          onReset={() => {
            setSearchQuery('');
            setWaitAssignee('');
            setWaitStep('');
            setFilterKind('ALL');
            setFilterStatus('ALL');
          }}
          toolbarExtra={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                aria-expanded={showAdvancedFilters}
                onClick={() => setShowAdvancedFilters((v) => !v)}
                title="Lọc theo người đang chờ duyệt và bước quy trình hiện tại"
              >
                Bước duyệt
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleExportHistory}
                disabled={loading || filteredHistory.length === 0}
                title="Xuất các dòng đang hiển thị trong danh sách ra file Excel"
              >
                <Download className="size-3.5" />
                <span>Xuất lịch sử đơn</span>
              </Button>
            </>
          }
          page={historySlice}
          onPage={setHistoryPage}
          reasonExtra={(id) => {
            const item = requestsList.find((r) => r.id === id);
            return item && isUnpaidOt(item) ? <UnpaidOtBadge /> : null;
          }}
        />

        <RequestDetailCard
          row={detailRow}
          status={detailRow ? detailStatusMeta(detailRow, procedureProgress?.status) : null}
          fields={
            detailRow ? (
              <>
                <DetailField label="Thời gian">{detailRow.effectiveDate}</DetailField>
                <DetailField label="Thời lượng">{detailRow.duration}</DetailField>
                <DetailField label="Lý do" testId="card-reason">
                  {detailRow.reason}
                  {isUnpaidOt(detailRow) && <UnpaidOtBadge />}
                </DetailField>
                <DetailField label="Mô tả" testId="card-description">
                  {detailRow.description}
                </DetailField>
                <DetailField label="Người tạo">
                  {profile.fullName || '----'}
                  {profile.employeeCode ? ` (${profile.employeeCode})` : ''}
                  {profile.department ? (
                    <span className="block text-[12px] font-normal text-slate-500">{profile.department}</span>
                  ) : null}
                </DetailField>
                <DetailField label="Ngày tạo">{detailRow.createdAt}</DetailField>
                {detailAttachmentId && (
                  <DetailField label="Tệp đính kèm">
                    <button
                      type="button"
                      className="font-semibold text-blue-700 hover:underline"
                      onClick={() => void handleOpenAttachment(detailAttachmentId)}
                    >
                      Xem chứng từ
                    </button>
                  </DetailField>
                )}
              </>
            ) : null
          }
          workflow={
            <ProcedureProgressPanel
              progress={procedureProgress}
              loading={loadingProgress}
              hasInstance={Boolean(selectedProcedure.instanceId)}
              onRefresh={() => void refreshProgress(false)}
              syncStatus={selectedProcedure.syncStatus}
              lastError={selectedProcedure.lastError}
              fallbackStepName={selectedProcedure.currentStepName}
              fallbackAssigneeName={selectedProcedure.currentAssigneeName}
              showWaitingLabel={false}
              emptyFallback={workflowFallback}
            />
          }
          actions={
            detailRow ? (
              <>
                {canPeerConfirmSelected && (
                  <>
                    <Button
                      permission="hrm.self.request"
                      size="sm"
                      className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                      onClick={() => handlePeerConfirm(detailRow.id, true)}
                    >
                      Xác nhận đổi ca
                    </Button>
                    <Button
                      permission="hrm.self.request"
                      size="sm"
                      variant="outline"
                      className="h-8 border-rose-300 text-xs text-rose-700"
                      onClick={() => handlePeerConfirm(detailRow.id, false)}
                    >
                      Từ chối
                    </Button>
                  </>
                )}
                {canCancelSelected && (
                  <Popconfirm
                    title="Huỷ đơn từ yêu cầu này?"
                    description="Đơn sẽ được rút khỏi luồng phê duyệt và không thể khôi phục."
                    okText="Huỷ đơn"
                    cancelText="Quay lại"
                    okType="danger"
                    placement="top"
                    onConfirm={() => handleCancelRequest(detailRow)}
                  >
                    <Button
                      permission="hrm.self.request"
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 border-rose-200 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      <XCircle className="mr-1 size-3.5" />
                      Thu hồi đơn
                    </Button>
                  </Popconfirm>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={() => handleOpenDetailDrawer(detailRow)}
                >
                  Xem đầy đủ chi tiết
                </Button>
              </>
            ) : null
          }
        />
      </div>

      {/* POPUP MODAL: KHỞI TẠO ĐƠN THEO TỪNG LOẠI NGHIỆP VỤ */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-white">
          {createForm && (
            <CreateRequestForm
              key={createForm.seq}
              kind={createForm.kind}
              title={createForm.title}
              customType={createForm.customType}
              initial={createForm.initial}
              data={{
                employeeId: profile.id,
                profile: rawProfile,
                leaveTypes,
                shifts: shiftsList,
                projects: workspaceProjects,
                leaveBalances,
                loading,
              }}
              onCancel={() => setIsCreateModalOpen(false)}
              onSubmitted={handleRequestSubmitted}
              onAbandoned={handleRequestAbandoned}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* DRAWER / SLIDE-IN PANEL: XEM CHI TIẾT ĐƠN CHUẨN 5 KHỐI THEO PLAN */}
      <Sheet open={isDetailDrawerOpen} onOpenChange={setIsDetailDrawerOpen}>
        <SheetContent className="w-full sm:max-w-xl p-0 h-full max-h-screen overflow-hidden bg-white flex flex-col shadow-2xl">
          {/* KHỐI 1: HEADER (Mã đơn, Tên đơn, Người gửi, Ngày tạo, Trạng thái) */}
          <SheetHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-[#021E73]">
                {selectedRequest?.code}
              </span>
              {(() => {
                const isCompleted =
                  procedureProgress?.status === 'completed' ||
                  selectedRequest?.workflowStatus === 'APPROVED';
                const isRejected =
                  procedureProgress?.status === 'rejected' ||
                  selectedRequest?.workflowStatus === 'REJECTED';
                const isPendingPeer =
                  selectedRequest?.workflowStatus === 'PENDING_PEER';

                const badgeClass = isCompleted
                  ? 'bg-emerald-100 text-emerald-800 text-[12px]'
                  : isRejected
                    ? 'bg-rose-100 text-rose-700 text-[12px]'
                    : isPendingPeer
                      ? 'bg-indigo-100 text-indigo-800 text-[12px]'
                      : 'bg-amber-100 text-amber-800 text-[12px]';

                const label = isCompleted
                  ? selectedRequest?.statusText === 'Chờ phê duyệt' ||
                    !selectedRequest?.statusText
                    ? 'Đã duyệt'
                    : selectedRequest.statusText
                  : isRejected
                    ? 'Đã từ chối'
                    : selectedRequest?.statusText || 'Chờ phê duyệt';

                return <Badge className={badgeClass}>{label}</Badge>;
              })()}
            </div>
            <SheetTitle className="text-base font-bold text-slate-900 mt-1">
              {selectedRequest?.typeName}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Tạo ngày {selectedRequest?.createdAt} bởi{' '}
              <strong>{profile.fullName}</strong>
            </SheetDescription>
          </SheetHeader>

          {/* BODY CHỨA 4 KHỐI CÒN LẠI VỚI NỘI BỘ SCROLL */}
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 text-xs">
            {/* KHỐI 2: THÔNG TIN ĐƠN (Business Information) */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[12px] flex items-center gap-1.5 text-blue-900">
                <FileText className="size-3.5 text-blue-600" />
                Thông tin nghiệp vụ
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Thời gian hiệu lực:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedRequest?.effectiveDate}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">
                    Thời lượng / Khối lượng:
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedRequest?.duration}
                  </span>
                </div>
                <div className="pt-1 space-y-1">
                  <span className="text-slate-500 block">Lý do:</span>
                  <p
                    data-testid="detail-reason"
                    className="p-2.5 rounded bg-white text-slate-800 font-semibold leading-relaxed text-xs border border-slate-100"
                  >
                    {selectedRequest?.reason}
                    {selectedRequest && isUnpaidOt(selectedRequest) && (
                      <UnpaidOtBadge />
                    )}
                  </p>
                </div>
                <div className="pt-1 space-y-1">
                  <span className="text-slate-500 block">Mô tả:</span>
                  <p
                    data-testid="detail-description"
                    className="p-2.5 rounded bg-white text-slate-700 leading-relaxed text-xs border border-slate-100 whitespace-pre-wrap"
                  >
                    {selectedRequest?.description}
                    {typeof selectedRequest?.rawDetails.attachmentFileId ===
                      'string' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={() =>
                            void handleOpenAttachment(
                              String(selectedRequest.rawDetails.attachmentFileId),
                            )
                          }
                        >
                          Xem chứng từ
                        </Button>
                      )}
                  </p>
                </div>
              </div>
            </div>

            {/* KHỐI 3: THÔNG TIN HỖ TRỢ / ĐIỀU KIỆN */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[12px] flex items-center gap-1.5 text-blue-900">
                <Info className="size-3.5 text-blue-600" />
                Thông tin hỗ trợ & Điều kiện áp dụng
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 text-[12px] text-slate-600 space-y-1.5">
                {selectedRequest?.kind === 'leave' && (
                  <>
                    <div className="flex justify-between">
                      <span>Quỹ phép khả dụng của nhân viên:</span>
                      <strong className="text-[#021E73]">
                        {leaveBalance.remaining} ngày
                      </strong>
                    </div>
                    {typeof selectedRequest.rawDetails?.isPaid === 'boolean' && (
                      <div className="flex justify-between">
                        <span>Chế độ lương của lý do nghỉ:</span>
                        <strong className="text-slate-800">
                          {selectedRequest.rawDetails.isPaid
                            ? 'Có lương'
                            : 'Không lương'}
                        </strong>
                      </div>
                    )}
                    {Boolean(selectedRequest.rawDetails?.isNegativeLeave) && (
                      <div className="flex justify-between text-amber-800 font-semibold">
                        <span>Hình thức:</span>
                        <span>Đơn xin ứng phép (Âm phép)</span>
                      </div>
                    )}
                  </>
                )}
                {selectedRequest?.kind === 'ot' && (
                  <>
                    <div className="flex justify-between">
                      <span>Chính sách áp dụng:</span>
                      <strong className="text-slate-800">
                        OT Policy (Đối soát min 2 vòng: Duyệt vs Quẹt thẻ)
                      </strong>
                    </div>
                    {(Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.shiftName,
                    ) ||
                      Boolean(
                        (selectedRequest.rawDetails as any)?.shiftName,
                      )) && (
                        <div className="flex justify-between items-center">
                          <span>Ca làm việc:</span>
                          <span className="font-semibold text-slate-800">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.shiftName ||
                              (selectedRequest.rawDetails as any)
                                ?.shiftName ||
                              '',
                            )}
                          </span>
                        </div>
                      )}
                    {(Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.projectName,
                    ) ||
                      Boolean(
                        (selectedRequest.rawDetails as any)?.projectName,
                      )) && (
                        <div className="flex justify-between items-center">
                          <span>Dự án liên quan:</span>
                          <span className="font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-right">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.projectName ||
                              (selectedRequest.rawDetails as any)
                                ?.projectName ||
                              '',
                            )}
                          </span>
                        </div>
                      )}
                    {Boolean(selectedRequest.rawDetails?.isNightOt) && (
                      <div className="flex justify-between text-blue-700 font-semibold">
                        <span>Phụ trội ca đêm:</span>
                        <span>Cộng thêm ≥ 30%</span>
                      </div>
                    )}
                  </>
                )}
                {selectedRequest?.kind === 'business_trip' && (
                  <>
                    {/* Hình thức công tác */}
                    <div className="flex justify-between items-center">
                      <span>Hình thức:</span>
                      <span className="font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        {String(
                          (selectedRequest.rawDetails as any)
                            ?.businessTripType ||
                          (selectedRequest.rawDetails as any)
                            ?.business_trip_type ||
                          'DOMESTIC',
                        ) === 'DOMESTIC'
                          ? 'Công tác trong nước (Nội địa)'
                          : String(
                            (selectedRequest.rawDetails as any)
                              ?.businessTripType ||
                            (selectedRequest.rawDetails as any)
                              ?.business_trip_type ||
                            '',
                          ) === 'OVERSEAS'
                            ? 'Công tác nước ngoài (Quốc tế)'
                            : 'Nội bộ liên chi nhánh'}
                      </span>
                    </div>

                    {/* Địa điểm & Địa chỉ */}
                    {(selectedRequest.rawDetails as any)?.destination && (
                      <div className="flex justify-between items-start">
                        <span>Địa điểm đến:</span>
                        <span className="font-semibold text-slate-800 text-right max-w-[240px]">
                          {String(
                            (selectedRequest.rawDetails as any)?.destination,
                          )}
                          {Boolean(
                            (selectedRequest.rawDetails as any)?.attributes
                              ?.destinationAddress,
                          ) && (
                              <span className="text-[12px] text-slate-500 block font-normal">
                                {String(
                                  (selectedRequest.rawDetails as any)?.attributes
                                    ?.destinationAddress,
                                )}
                              </span>
                            )}
                        </span>
                      </div>
                    )}

                    {/* Phòng ban cử đi */}
                    {Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.workDepartment,
                    ) && (
                        <div className="flex justify-between items-center">
                          <span>Phòng ban:</span>
                          <span className="font-semibold text-slate-800">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.workDepartment,
                            )}
                          </span>
                        </div>
                      )}

                    {/* Phương tiện */}
                    {(() => {
                      // Phương tiện lưu thành cột của đơn (không phụ thuộc quy trình); đơn cũ chỉ có trong attributes.
                      const details = selectedRequest.rawDetails as any;
                      const vehicleText =
                        details?.transportMode === 'COMPANY_VEHICLE'
                          ? 'Xe công ty'
                          : details?.transportMode === 'EXTERNAL'
                            ? String(details.transportDetail ?? 'Phương tiện ngoài')
                            : details?.attributes?.vehicle
                              ? String(details.attributes.vehicle)
                              : '';
                      return vehicleText ? (
                        <div className="flex justify-between items-center">
                          <span>Phương tiện:</span>
                          <span className="font-semibold text-slate-800">{vehicleText}</span>
                        </div>
                      ) : null;
                    })()}

                    {/* Thời gian giờ đi/giờ về */}
                    {Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.tripStartTime &&
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.tripEndTime,
                    ) && (
                        <div className="flex justify-between items-center">
                          <span>Khung giờ:</span>
                          <span className="font-mono text-slate-700">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.tripStartTime,
                            )}{' '}
                            →{' '}
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.tripEndTime,
                            )}
                          </span>
                        </div>
                      )}

                    {/* Dự án liên kết */}
                    {(() => {
                      const link = selectedRequest.rawDetails?.projectLink as
                        | {
                            projectCode?: string;
                            projectName?: string;
                            status?: string;
                            projectRequestCode?: string;
                            rejectionReason?: string;
                          }
                        | undefined;
                      const label =
                        projectLabel({
                          code: link?.projectCode,
                          name:
                            link?.projectName ??
                            (selectedRequest.rawDetails?.projectName as string | undefined),
                        }) || String(selectedRequest.rawDetails?.projectId ?? '');
                      if (!label) return null;
                      return (
                        <div className="flex justify-between items-start gap-3">
                          <span>Dự án liên kết:</span>
                          <span className="font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-right">
                            {label}
                            {link ? (
                              <span className="text-[12px] text-slate-500 font-mono block">
                                {link.projectRequestCode
                                  ? `Mã đơn trong dự án: ${link.projectRequestCode}`
                                  : (PROJECT_LINK_STATUS_LABEL[link.status ?? ''] ?? link.status)}
                                {link.status === 'REJECTED' && link.rejectionReason
                                  ? ` — ${link.rejectionReason}`
                                  : ''}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Bảng phụ phí (Surcharges) nếu có */}
                    {Array.isArray(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.surcharges,
                    ) &&
                      (
                        (selectedRequest.rawDetails as any)?.attributes
                          ?.surcharges as any[]
                      ).length > 0 && (
                        <div className="pt-1.5 space-y-1.5 border-t border-slate-200/60">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-slate-700">
                              Phụ phí công tác dự trù:
                            </span>
                            <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[12px]">
                              {Number(
                                (selectedRequest.rawDetails as any)?.attributes
                                  ?.totalSurcharges || 0,
                              ).toLocaleString('vi-VN')}{' '}
                              VNĐ
                            </span>
                          </div>
                          <div className="bg-white rounded-md border border-slate-200 p-2 space-y-1">
                            {(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.surcharges as any[]
                            ).map((s: any, idx: number) => (
                              <div
                                key={idx}
                                className="flex justify-between items-center text-[12px] text-slate-600"
                              >
                                <span>• {s.name || 'Phụ phí'}</span>
                                <span className="font-mono font-medium text-slate-800">
                                  {Number(s.amount || 0).toLocaleString(
                                    'vi-VN',
                                  )}{' '}
                                  đ
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Checkbox OT & GPS */}
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-200/60 text-[12px]">
                      {Boolean(selectedRequest.rawDetails?.allow_ot) && (
                        <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded font-medium border border-amber-200">
                          Cho phép tính làm thêm giờ (OT)
                        </span>
                      )}
                      {Boolean(
                        (selectedRequest.rawDetails as any)?.attributes
                          ?.requiredFinger,
                      ) && (
                          <span className="bg-blue-50 text-blue-800 px-2 py-0.5 rounded font-medium border border-blue-200">
                            Yêu cầu chấm công GPS tại nơi đến
                          </span>
                        )}
                    </div>
                  </>
                )}
                {selectedRequest?.kind === 'shift_change' && (
                  <div className="flex justify-between">
                    <span>Tình trạng xác nhận chéo:</span>
                    <strong
                      className={
                        selectedRequest.workflowStatus === 'PENDING_PEER'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }
                    >
                      {selectedRequest.workflowStatus === 'PENDING_PEER'
                        ? 'Đang chờ đồng nghiệp'
                        : 'Đã xác nhận'}
                    </strong>
                  </div>
                )}
                {selectedRequest?.kind === 'advance' && (
                  <div className="flex justify-between">
                    <span>Số kỳ phân bổ khấu trừ:</span>
                    <strong className="text-indigo-900 font-mono">
                      {String(
                        selectedRequest.rawDetails?.numberOfInstallments || 1,
                      )}{' '}
                      kỳ
                    </strong>
                  </div>
                )}
                {selectedRequest?.kind === 'correction' && (
                  <div className="flex justify-between">
                    <span>Mốc giờ đề xuất:</span>
                    <strong className="text-slate-800">
                      {selectedRequest.duration}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            {/* KHỐI 4: QUY TRÌNH (Workflow Step, Approver, Timeline) */}
            <ProcedureProgressPanel
              progress={procedureProgress}
              loading={loadingProgress}
              hasInstance={Boolean(selectedProcedure.instanceId)}
              onRefresh={() => void refreshProgress(false)}
              syncStatus={selectedProcedure.syncStatus}
              lastError={selectedProcedure.lastError}
              fallbackStepName={selectedProcedure.currentStepName}
              fallbackAssigneeName={selectedProcedure.currentAssigneeName}
              showWaitingLabel={false}
              emptyFallback={
                workflowFallback
              }
            />

            {procedureProgress &&
              !procedureProgress.hrmSynced &&
              ['completed', 'rejected', 'cancelled'].includes(
                procedureProgress.status,
              ) && (
                <div
                  role="status"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  {procedureProgress.lastError
                    ? `Chưa áp dụng kết quả vào HRM: ${procedureProgress.lastError}`
                    : 'Quy trình đã kết thúc. HRM đang chờ đồng bộ kết quả; công, phép và lương chưa được xác nhận áp dụng.'}
                </div>
              )}
            {/* KHỐI 5: KẾT QUẢ XỬ LÝ (Result & Side-effects) */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[12px] flex items-center gap-1.5 text-blue-900">
                <FileCheck2 className="size-3.5 text-blue-600" />
                Kết quả xử lý & Đồng bộ dữ liệu
              </h4>
              <div className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Trạng thái áp dụng:</span>
                  <Badge
                    className={
                      selectedRequest?.requestStatus === 'APPLIED' ||
                        selectedRequest?.requestStatus === 'DISBURSED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-700'
                    }
                  >
                    {['CANCELLED', 'REJECTED'].includes(
                      selectedRequest?.requestStatus ?? '',
                    )
                      ? 'Không áp dụng'
                      : selectedRequest?.requestStatus === 'APPLIED'
                        ? 'Đã cập nhật dữ liệu công'
                        : selectedRequest?.requestStatus === 'DISBURSED'
                          ? 'Đã giải ngân'
                          : 'Chờ áp dụng'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-slate-500 text-[12px]">
                  <span>Đồng bộ Timesheet / Payroll:</span>
                  <span className="font-mono text-slate-700">
                    {['CANCELLED', 'REJECTED'].includes(
                      selectedRequest?.requestStatus ?? '',
                    )
                      ? 'Không phát sinh hiệu lực'
                      : selectedRequest?.requestStatus === 'APPLIED' ||
                        selectedRequest?.requestStatus === 'DISBURSED'
                        ? 'Đã đồng bộ'
                        : 'Chưa đồng bộ'}
                  </span>
                </div>
              </div>
            </div>

            {/* KHỐI 6: TRAO ĐỔI & Ý KIẾN */}
            {selectedRequest && (
              <div className="pt-2 border-t border-slate-200">
                <RequestThread
                  kind={selectedRequest.kind}
                  requestId={selectedRequest.id}
                />
              </div>
            )}
          </div>

          {/* FOOTER ACTIONS */}
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              {/* Hành động Xác nhận đổi ca chéo nếu đang chờ xác nhận */}
              {selectedRequest?.kind === 'shift_change' &&
                selectedRequest.rawDetails.swapWithEmployeeId === profile.id &&
                selectedRequest.workflowStatus === 'PENDING_PEER' && (
                  <div className="flex items-center gap-2">
                    <Button
                      permission="hrm.self.request"
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                      onClick={() =>
                        handlePeerConfirm(selectedRequest.id, true)
                      }
                    >
                      Xác nhận đổi ca
                    </Button>
                    <Button
                      permission="hrm.self.request"
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 border-rose-300 text-rose-700"
                      onClick={() =>
                        handlePeerConfirm(selectedRequest.id, false)
                      }
                    >
                      Từ chối
                    </Button>
                  </div>
                )}

              {/* Nút hủy đơn nếu còn ở trạng thái Pending */}
              {(selectedRequest?.workflowStatus === 'PENDING_APPROVAL' ||
                (selectedRequest?.workflowStatus === 'PENDING_PEER' &&
                  selectedRequest.rawDetails.employeeId === profile.id) ||
                selectedRequest?.workflowStatus === 'SUBMITTED') && (
                  <Popconfirm
                    title="Huỷ đơn từ yêu cầu này?"
                    description="Đơn sẽ được rút khỏi luồng phê duyệt và không thể khôi phục."
                    okText="Huỷ đơn"
                    cancelText="Quay lại"
                    okType="danger"
                    placement="top"
                    onConfirm={() =>
                      selectedRequest && handleCancelRequest(selectedRequest)
                    }
                  >
                    <Button
                      permission="hrm.self.request"
                      variant="outline"
                      size="sm"
                      className="text-xs h-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                    >
                      <XCircle className="size-3.5 mr-1" />
                      Rút / Huỷ đơn
                    </Button>
                  </Popconfirm>
                )}
            </div>

            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs h-8"
              onClick={() => setIsDetailDrawerOpen(false)}
            >
              Đóng
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div >
  );
}
