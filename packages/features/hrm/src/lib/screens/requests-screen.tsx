'use client';
import {
  correctionDraftRows,
  correctionPayload,
  type CorrectionSessionRow,
} from '../hrm-correction-sessions';
import { HrmCorrectionSessions } from '../ui/hrm-correction-sessions';

import {
  HrmRequestDrafts,
  requestDraftNames,
  type RequestDraft,
} from '../ui/hrm-request-drafts';
import {
  Clock,
  Download,
  FileCheck2,
  FilePlus,
  FileText,
  History,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import {
  EmployeeHeroCard,
  type EmployeeProfileHeroData,
} from '../ui/employee-hero-card';
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
import { hrmApiUrl, hrmFetch } from '../hrm-api';
import {
  SearchableSelect,
  type SearchableSelectOption,
  Popconfirm,
} from '@enterprise-platform/shared-ui';
import {
  DynamicAttributeForm,
  type ProcedureAttributeItem,
} from '../ui/dynamic-attribute-form';
import {
  PROCEDURE_UNAVAILABLE_MESSAGE,
  apiErrorInfo,
  bindingUrl,
  interpretBindingResponse,
  hoursBetween,
  prefillAttributeValues,
  pruneAttributeValues,
  requestSubTypeCode,
  visibleDynamicAttributes,
  type BindingLoadState,
} from '../request-form-attributes';
import { uploadHrmAttachment } from '../hrm-attachment-upload';
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

type RequestSubTab = 'catalog' | 'pending' | 'history' | 'drafts';
type RequestKind =
  | 'leave'
  | 'ot'
  | 'business_trip'
  | 'shift_change'
  | 'correction'
  | 'advance'
  | 'profile_correction';


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
  reason: string;
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

interface LeaveTypeItem {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unit: string;
}

interface ShiftItem {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

interface EmployeeItem {
  id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  position?: string;
}

interface WorkspaceProjectItem {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
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

function formatVnDate(val?: string | null): string {
  if (!val) return '----';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val).slice(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
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

export default function RequestsPage() {
  const [editingDraft, setEditingDraft] = useState<RequestDraft | null>(null);
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<RequestSubTab>('catalog');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] =
    useState<RequestKind>('leave');
  const [selectedTypeTitle, setSelectedTypeTitle] =
    useState('Đơn xin nghỉ phép');

  // Master Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>([]);
  const [shiftsList, setShiftsList] = useState<ShiftItem[]>([]);
  const [colleaguesList, setColleaguesList] = useState<EmployeeItem[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<
    WorkspaceProjectItem[]
  >([]);

  // State form nhập liệu chung & từng loại đơn
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveDuration, setLeaveDuration] = useState('1.0');
  const [leaveFile, setLeaveFile] = useState<File | null>(null);
  const [leaveAttachmentId, setLeaveAttachmentId] = useState('');

  // OT state
  const [otType, setOtType] = useState<
    'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT'
  >('WEEKDAY');
  const [isNegativeLeave, setIsNegativeLeave] = useState(false);
  const [isNightOt, setIsNightOt] = useState(false);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');

  // Business trip state
  const [tripType, setTripType] = useState<
    'DOMESTIC' | 'OVERSEAS' | 'INTERSITE'
  >('DOMESTIC');
  const [destination, setDestination] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [allowOt, setAllowOt] = useState(false);

  // Shift change state
  const [changeType, setChangeType] = useState<'SWAP' | 'CHANGE_SHIFT'>('SWAP');
  const [currentShiftId, setCurrentShiftId] = useState('');
  const [requestedShiftId, setRequestedShiftId] = useState('');
  const [swapWithEmployeeId, setSwapWithEmployeeId] = useState('');

  // Attendance correction state
  const [correctionSessions, setCorrectionSessions] = useState<
    CorrectionSessionRow[]
  >([{ start: '', end: '' }]);

  // Salary advance state
  const [requestedAmount, setRequestedAmount] = useState('5000000');
  const [numberOfInstallments, setNumberOfInstallments] = useState('1');

  // Profile correction state - Hỗ trợ nhập trực tiếp nhiều trường cùng lúc
  const [workItemId, setWorkItemId] = useState('');
  const [adjustFullName, setAdjustFullName] = useState<string>('');
  const [adjustDateOfBirth, setAdjustDateOfBirth] = useState<string>('');
  const [adjustGender, setAdjustGender] = useState<string>('');
  const [adjustIdentityCard, setAdjustIdentityCard] = useState<string>('');
  const [adjustIdentityDate, setAdjustIdentityDate] = useState<string>('');
  const [adjustIdentityPlace, setAdjustIdentityPlace] = useState<string>('');
  const [adjustTaxCode, setAdjustTaxCode] = useState<string>('');
  const [adjustSocialInsurance, setAdjustSocialInsurance] =
    useState<string>('');
  const [profileEvidenceDoc, setProfileEvidenceDoc] = useState<string>('');

  // Reason & Submission
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dynamic Procedure Attributes from PE Node S
  const [dynamicAttributes, setDynamicAttributes] = useState<
    ProcedureAttributeItem[]
  >([]);
  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(
    {},
  );
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [procedureDefName, setProcedureDefName] = useState<string>('');
  const [bindingState, setBindingState] = useState<BindingLoadState | null>(
    null,
  );
  const [bindingReload, setBindingReload] = useState(0);
  const [attributeNotice, setAttributeNotice] = useState('');
  // Thuộc tính người dùng đã tự sửa: không bị ghi đè khi điền sẵn (ánh xạ PREFILL).
  const touchedAttributeCodes = useRef<Set<string>>(new Set());
  // Mã thuộc tính đã lưu trong bản nháp đang mở, để báo nếu biểu mẫu hiện hành đã đổi.
  const draftAttributeCodes = useRef<string[] | null>(null);
  const [procedureAvailable, setProcedureAvailable] = useState<
    boolean | undefined
  >(undefined);

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
    open: isDetailDrawerOpen,
    // Quy trình đổi trạng thái (hoặc đã kết thúc khi mở): nạp lại đơn để lấy trạng thái nghiệp vụ thật.
    onLoaded: (data, previousStatus) => {
      if (
        previousStatus === undefined
          ? !isTerminalProcedureStatus(data.status)
          : previousStatus === data.status
      )
        return;
      const target = selectedRequest;
      void loadData().then((latest) => {
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
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingKind, setPendingKind] = useState<string>('ALL');
  const [pendingStatus, setPendingStatus] = useState<string>('ALL');
  const [pendingFromDate, setPendingFromDate] = useState<string>('');
  const [pendingToDate, setPendingToDate] = useState<string>('');

  // Filter cho bảng Lịch sử (Zone 1: Filters)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKind, setFilterKind] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [historyFromDate, setHistoryFromDate] = useState<string>('');
  const [historyToDate, setHistoryToDate] = useState<string>('');

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
      { remaining: string; entitlement: string; advanceAllowed: boolean }
    >
  >({});
  const leaveBalance = leaveBalances[selectedLeaveTypeId] || {
    remaining: '----',
    entitlement: '----',
    advanceAllowed: false,
  };

  // Requests list fetched from API
  const [requestsList, setRequestsList] = useState<RequestItem[]>([]);
  const [notificationRequestId, setNotificationRequestId] = useState('');
  useEffect(() => {
    setNotificationRequestId(new URLSearchParams(window.location.search).get('request') ?? '');
  }, []);

  // Danh mục loại đơn hệ thống
  const requestCatalog = [
    {
      id: 'leave' as RequestKind,
      title: 'Đơn xin nghỉ phép',
      desc: 'Nghỉ phép năm, nghỉ ốm BHXH, việc riêng có hưởng lương, nghỉ không lương theo quy chế.',
      tag: 'Tự động trừ quỹ phép',
      tagColor: 'emerald',
      balanceLabel: `Quỹ phép khả dụng: ${leaveBalance.remaining !== '----' ? `${leaveBalance.remaining} ngày` : '----'}`,
      iconBg: 'bg-blue-100 text-[#021E73]',
    },
    {
      id: 'ot' as RequestKind,
      title: 'Đơn làm thêm giờ (OT)',
      desc: 'Đăng ký làm thêm ngày thường (1.5x), làm đêm (2.0x), cuối tuần (2.0x) hoặc Lễ Tết (3.0x).',
      tag: 'Cần duyệt trước ca làm',
      tagColor: 'amber',
      balanceLabel: 'Hệ số tính: 1.5x ~ 3.0x lương',
      iconBg: 'bg-amber-100 text-amber-800',
    },
    {
      id: 'business_trip' as RequestKind,
      title: 'Đơn đi công tác',
      desc: 'Công tác thực địa, hỗ trợ dự án tỉnh xa, hội thảo chuyên môn; kèm chế độ phụ cấp công tác.',
      tag: 'Nội địa / Quốc tế',
      tagColor: 'blue',
      balanceLabel: 'Chế độ: Phụ cấp + Lưu trú',
      iconBg: 'bg-blue-50 text-blue-700',
    },
    {
      id: 'shift_change' as RequestKind,
      title: 'Đơn đổi ca làm việc',
      desc: 'Đổi ca tạm thời/vĩnh viễn; hoán đổi ca trực tương đương với đồng nghiệp cùng bộ phận.',
      tag: 'Cần xác nhận chéo',
      tagColor: 'emerald',
      balanceLabel: 'Hình thức: Đổi ca / Hoán đổi',
      iconBg: 'bg-emerald-100 text-emerald-800',
    },
    {
      id: 'correction' as RequestKind,
      title: 'Đơn giải trình / Bổ sung công',
      desc: 'Giải trình quên quẹt thẻ, sự cố thiết bị nhận diện, bổ sung mốc giờ vào/ra thực tế theo phê duyệt.',
      tag: 'Bù công / Giải trình',
      tagColor: 'rose',
      balanceLabel: 'So sánh: Giờ hiện tại vs Đề xuất',
      iconBg: 'bg-rose-100 text-rose-700',
    },
    {
      id: 'advance' as RequestKind,
      title: 'Đơn xin tạm ứng lương',
      desc: 'Đề nghị tạm ứng lương theo quy định công ty, phân bổ khấu trừ vào các kỳ bảng lương.',
      tag: 'Khấu trừ bảng lương',
      tagColor: 'blue',
      balanceLabel: 'Hạn mức: Tối đa 50% lương cơ bản',
      iconBg: 'bg-indigo-100 text-indigo-800',
    },
    {
      id: 'profile_correction' as RequestKind,
      title: 'Đơn điều chỉnh thông tin nhân sự',
      desc: 'Đề nghị đính chính thông tin định danh: số CCCD, ngày cấp, nơi cấp, ngày sinh hoặc họ tên pháp lý.',
      tag: 'Phê duyệt HR & Pháp lý',
      tagColor: 'purple',
      balanceLabel: 'Kèm minh chứng: Ảnh CCCD / Giấy tờ',
      iconBg: 'bg-purple-100 text-purple-800',
    },
  ];

  async function loadData() {
    try {
      setLoading(true);

      // 1. Fetch user profile
      let empId = '';
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
          setAdjustFullName(p.fullName || '');
          setAdjustDateOfBirth(
            p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : '',
          );
          setAdjustGender(p.gender || 'MALE');
          setAdjustIdentityCard(p.identityCardNumber || '');
          setAdjustIdentityDate(
            p.identityCardIssuedDate
              ? String(p.identityCardIssuedDate).slice(0, 10)
              : '',
          );
          setAdjustIdentityPlace(p.identityCardIssuedPlace || '');
          setAdjustTaxCode(p.taxCode || '');
          setAdjustSocialInsurance(p.socialInsuranceNumber || '');
        }
      }

      // 2. Fetch Master Data: Leave Types, Shifts, Colleagues, Workspace Projects
      const [ltRes, shiftRes, empRes, prjRes] = await Promise.all([
        fetch('/api/hrm/v1/leave-types?active=true', {
          credentials: 'same-origin',
        }),
        fetch('/api/hrm/v1/shifts?status=ACTIVE', {
          credentials: 'same-origin',
        }),
        fetch('/api/hrm/v1/employee-options?page=1', {
          credentials: 'same-origin',
        }),
        fetch('/api/hrm/v1/workspace-projects', { credentials: 'same-origin' }),
      ]);

      if (ltRes.ok) {
        const payload = await ltRes.json();
        const types: LeaveTypeItem[] = payload.data || [];
        setLeaveTypes(types);
        if (types.length > 0 && !selectedLeaveTypeId) {
          setSelectedLeaveTypeId(types[0].id);
        }
      }

      if (shiftRes.ok) {
        const payload = await shiftRes.json();
        const sList: ShiftItem[] = payload.data || [];
        setShiftsList(sList);
        if (sList.length > 0) {
          if (!currentShiftId) setCurrentShiftId(sList[0].id);
          if (!requestedShiftId && sList.length > 1)
            setRequestedShiftId(sList[1].id);
        }
      }

      if (empRes.ok) {
        const payload = await empRes.json();
        const eList: EmployeeItem[] = (payload.data || []).map((e: any) => ({
          id: e.employeeId || e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName || e.employeeCode,
          department: e.department,
          position: e.position,
        }));
        setColleaguesList(eList.filter((item) => item.id !== empId));
      }

      if (prjRes.ok) {
        const payload = await prjRes.json();
        setWorkspaceProjects(payload.data || []);
      }

      // 3. Fetch leave balances if empId exists
      if (empId) {
        const balRes = await fetch(
          hrmApiUrl(`/employees/${empId}/leave-balances`),
          { credentials: 'same-origin' },
        );
        if (balRes.ok) {
          const payload = await balRes.json();
          const balances = payload.data || [];
          setLeaveBalances(
            Object.fromEntries(
              balances.map(
                (b: {
                  leaveTypeId: string;
                  remaining: number;
                  pending: number;
                  available?: number;
                  projectedEntitlement?: number | null;
                  advanceAllowed?: boolean;
                }) => [
                  b.leaveTypeId,
                  {
                    // Server tính sẵn phần được dùng (gồm ứng phép theo chính sách).
                    remaining: String(
                      Math.round(
                        (b.available ??
                          Number(b.remaining) - Number(b.pending)) * 100,
                      ) / 100,
                    ),
                    entitlement:
                      b.projectedEntitlement == null
                        ? '----'
                        : String(b.projectedEntitlement),
                    advanceAllowed: Boolean(b.advanceAllowed),
                  },
                ],
              ),
            ),
          );
        }
      }

      // 4. Fetch all 6 request types concurrently
      const empQuery = empId ? `?employee_id=${empId}` : '';
      const [
        leaveRes,
        otRes,
        tripRes,
        shiftChangeRes,
        corrRes,
        advRes,
        profileRes,
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: `${item.duration || 1} ngày`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.workDate ? new Date(item.workDate).toLocaleDateString('vi-VN') : '----'} (${item.startTime || '----'} - ${item.endTime || '----'})`,
            duration: `${plannedHrs} giờ (${item.otRateMultiplier || 1.5}x)`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: `${item.daysCount || 1} ngày`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration:
              item.changeType === 'SWAP' ? 'Hoán đổi ca trực' : 'Thay đổi ca',
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý ca / Trưởng bộ phận',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? new Date(item.requestDate).toLocaleDateString('vi-VN')
              : '----',
            duration: `Vào: ${inTime} | Ra: ${outTime}`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? new Date(item.requestDate).toLocaleDateString('vi-VN')
              : '----',
            duration: `${Number(item.requestedAmount || 0).toLocaleString('vi-VN')} đ (${item.numberOfInstallments || 1} kỳ)`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Kế toán / Giám đốc',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
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
            createdAt: new Date(item.createdAt).toLocaleDateString('vi-VN'),
            effectiveDate: 'Theo ngày duyệt',
            duration: `${Object.keys(item.changes || {}).length} trường`,
            reason: item.reason,
            approver: item.reviewed_by || 'Nhân sự',
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
      setRequestsList([]);
      toast.error(
        err instanceof Error ? err.message : 'Không thể tải danh sách đơn từ',
      );
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    const todayStr = new Date().toISOString().slice(0, 10);
    setCorrectionSessions([
      { start: todayStr + 'T08:00:00', end: todayStr + 'T17:00:00' },
    ]);
    setFromDate(todayStr);
    setToDate(todayStr);
  }, []);

  // Tổng số lượng đơn đang chờ duyệt thực tế (dùng cho badge hiển thị trên Tab)
  const totalPendingCount = useMemo(() => {
    return requestsList.filter(
      (r) =>
        r.workflowStatus === 'PENDING_APPROVAL' ||
        r.workflowStatus === 'PENDING_PEER' ||
        r.workflowStatus === 'SUBMITTED',
    ).length;
  }, [requestsList]);

  // Bộ lọc cho tab Đang chờ duyệt (Sub-tab 2)
  const pendingRequests = useMemo(() => {
    return requestsList.filter((item) => {
      // Chỉ lấy các yêu cầu đang ở giai đoạn chờ duyệt
      const isPending =
        item.workflowStatus === 'PENDING_APPROVAL' ||
        item.workflowStatus === 'PENDING_PEER' ||
        item.workflowStatus === 'SUBMITTED';

      if (!isPending) return false;

      // Lọc từ khóa tìm kiếm (mã đơn, loại đơn, lý do, người duyệt)
      const q = pendingSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        item.code.toLowerCase().includes(q) ||
        item.typeName.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.approver.toLowerCase().includes(q);

      // Lọc loại đơn
      const matchKind = pendingKind === 'ALL' || item.kind === pendingKind;

      // Lọc tình trạng chờ duyệt chi tiết
      const matchStatus =
        pendingStatus === 'ALL' ||
        (pendingStatus === 'PENDING_APPROVAL' &&
          item.workflowStatus === 'PENDING_APPROVAL') ||
        (pendingStatus === 'PENDING_PEER' &&
          item.workflowStatus === 'PENDING_PEER');

      // Lọc khoảng thời gian (theo ngày tạo đơn)
      let matchDate = true;
      if (pendingFromDate || pendingToDate) {
        const itemDateStr = item.rawCreatedAt
          ? item.rawCreatedAt.slice(0, 10)
          : '';
        if (pendingFromDate && itemDateStr && itemDateStr < pendingFromDate) {
          matchDate = false;
        }
        if (pendingToDate && itemDateStr && itemDateStr > pendingToDate) {
          matchDate = false;
        }
      }

      const matchWorkflow = matchesWorkflowFilter(item.rawDetails, {
        assignee: waitAssignee,
        currentStep: waitStep,
      });

      return (
        matchSearch && matchKind && matchStatus && matchDate && matchWorkflow
      );
    });
  }, [
    requestsList,
    waitAssignee,
    waitStep,
    pendingSearch,
    pendingKind,
    pendingStatus,
    pendingFromDate,
    pendingToDate,
  ]);

  // Bộ lọc cho tab Lịch sử (Zone 1)
  const filteredHistory = useMemo(() => {
    return requestsList.filter((item) => {
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        item.code.toLowerCase().includes(q) ||
        item.typeName.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q) ||
        item.approver.toLowerCase().includes(q);

      const matchKind = filterKind === 'ALL' || item.kind === filterKind;
      const matchStatus =
        filterStatus === 'ALL' ||
        (filterStatus === 'PENDING' &&
          (item.workflowStatus === 'PENDING_APPROVAL' ||
            item.workflowStatus === 'PENDING_PEER')) ||
        (filterStatus === 'APPROVED' &&
          (item.workflowStatus === 'APPROVED' ||
            item.requestStatus === 'APPLIED' ||
            item.requestStatus === 'DISBURSED')) ||
        (filterStatus === 'REJECTED' && item.workflowStatus === 'REJECTED') ||
        (filterStatus === 'CANCELLED' && item.requestStatus === 'CANCELLED');

      // Lọc khoảng thời gian (theo ngày tạo đơn)
      let matchDate = true;
      if (historyFromDate || historyToDate) {
        const itemDateStr = item.rawCreatedAt
          ? item.rawCreatedAt.slice(0, 10)
          : '';
        if (historyFromDate && itemDateStr && itemDateStr < historyFromDate) {
          matchDate = false;
        }
        if (historyToDate && itemDateStr && itemDateStr > historyToDate) {
          matchDate = false;
        }
      }

      const matchWorkflow = matchesWorkflowFilter(item.rawDetails, {
        assignee: waitAssignee,
        currentStep: waitStep,
      });

      return (
        matchSearch && matchKind && matchStatus && matchDate && matchWorkflow
      );
    });
  }, [
    requestsList,
    waitAssignee,
    waitStep,
    searchQuery,
    filterKind,
    filterStatus,
    historyFromDate,
    historyToDate,
  ]);

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
          options={workflowStepOptions}
          value={waitStep}
          onChange={(val) => setWaitStep(val || '')}
          placeholder="Bước hiện tại..."
          clearable
        />
      </div>
    </>
  );

  const handleOpenCreateForType = async (
    catId: RequestKind,
    typeTitle: string,
  ) => {
    setEditingDraft(null);
    setSelectedCatalogId(catId);
    setSelectedTypeTitle(typeTitle);
    const todayStr = new Date().toISOString().slice(0, 10);
    setFromDate(todayStr);
    setToDate(todayStr);
    setReason('');
    setIsNegativeLeave(false);
    setIsNightOt(false);
    setProjectId('');
    setProjectName('');
    setDynamicValues({});
    touchedAttributeCodes.current = new Set();
    setDynamicAttributes([]);
    setProcedureDefName('');

    setLeaveFile(null);
    setLeaveAttachmentId('');
    if (catId === 'profile_correction') {
      setAdjustFullName(rawProfile.fullName || profile.fullName || '');
      setAdjustDateOfBirth(
        rawProfile.dateOfBirth
          ? String(rawProfile.dateOfBirth).slice(0, 10)
          : '',
      );
      setAdjustGender(rawProfile.gender || 'MALE');
      setAdjustIdentityCard(rawProfile.identityCardNumber || '');
      setAdjustIdentityDate(
        rawProfile.identityCardIssuedDate
          ? String(rawProfile.identityCardIssuedDate).slice(0, 10)
          : '',
      );
      setAdjustIdentityPlace(rawProfile.identityCardIssuedPlace || '');
      setAdjustTaxCode(rawProfile.taxCode || '');
      setAdjustSocialInsurance(rawProfile.socialInsuranceNumber || '');
      setProfileEvidenceDoc('');
    }
    setIsCreateModalOpen(true);

    // Thuộc tính động được tải bởi effect theo loại đơn và loại con hiện chọn.
    draftAttributeCodes.current = null;
    setAttributeNotice('');
    setBindingState(null);
  };

  // Mã loại con quyết định binding PE nào sẽ được dùng khi gửi đơn.
  const currentSubTypeCode = requestSubTypeCode(selectedCatalogId, {
    leaveTypeCode: leaveTypes.find(
      (t) => t.id === (selectedLeaveTypeId || leaveTypes[0]?.id),
    )?.code,
    otType,
    tripType,
  });

  // Cờ procedureAvailable từ GET /v1/capabilities, đọc khi mở form.
  useEffect(() => {
    if (!isCreateModalOpen) return;
    let active = true;
    hrmFetch<{ data: { procedureAvailable?: boolean } }>('/capabilities')
      .then((result) => {
        if (active) setProcedureAvailable(result.data.procedureAvailable);
      })
      .catch(() => {
        if (active) setProcedureAvailable(undefined);
      });
    return () => {
      active = false;
    };
  }, [isCreateModalOpen]);

  // Tải lại thuộc tính động mỗi khi đổi loại đơn hoặc loại con (loại phép, loại OT, loại công tác).
  useEffect(() => {
    if (!isCreateModalOpen || !selectedCatalogId) return;
    let active = true;
    setLoadingAttributes(true);
    (async () => {
      let state: BindingLoadState;
      try {
        const res = await fetch(
          bindingUrl(selectedCatalogId, currentSubTypeCode),
          { credentials: 'same-origin' },
        );
        const body = await res.json().catch(() => ({}));
        state = interpretBindingResponse(res.status, body);
      } catch (error) {
        state = {
          status: 'error',
          message:
            error instanceof Error
              ? `Không tải được biểu mẫu quy trình: ${error.message}`
              : 'Không tải được biểu mẫu quy trình',
        };
      }
      if (!active) return;
      setBindingState(state);
      if (state.status === 'ready') {
        setProcedureDefName(state.definitionName);
        setDynamicAttributes(state.attributes);
      } else {
        setProcedureDefName('');
        setDynamicAttributes([]);
      }
      if (state.status === 'ready' || state.status === 'direct') {
        const attributes = state.status === 'ready' ? state.attributes : [];
        const savedCodes = draftAttributeCodes.current;
        draftAttributeCodes.current = null;
        setDynamicValues((prev) => {
          const { values, dropped } = pruneAttributeValues(prev, attributes);
          const removed = savedCodes
            ? savedCodes.filter((code) => dropped.includes(code))
            : [];
          setAttributeNotice(
            removed.length
              ? `Biểu mẫu quy trình đã thay đổi so với lúc lưu nháp; ${removed.length} thuộc tính cũ không còn được áp dụng (${removed.join(', ')}). Vui lòng kiểm tra lại.`
              : '',
          );
          return dropped.length ? values : prev;
        });
      }
      setLoadingAttributes(false);
    })();
    return () => {
      active = false;
    };
  }, [
    isCreateModalOpen,
    selectedCatalogId,
    currentSubTypeCode,
    bindingReload,
  ]);

  // FIX-E-05: điền sẵn thuộc tính PREFILL từ trường form; người dùng sửa tay thì giữ giá trị của họ.
  useEffect(() => {
    const prefills = prefillAttributeValues(dynamicAttributes, {
      'form.reason': reason,
      'form.from_date': fromDate,
      'form.to_date': toDate,
      'form.work_date': fromDate,
      'form.request_date': fromDate,
      'form.duration': leaveDuration,
      'form.leave_type_id': selectedLeaveTypeId,
      'form.is_negative_leave': isNegativeLeave,
      'form.ot_hours': String(hoursBetween(startTime, endTime) ?? ''),
      'form.ot_type': otType,
      'form.is_night_ot': isNightOt,
      'form.trip_type': tripType,
      'form.destination': destination,
      'form.allow_ot': allowOt,
      'form.amount': requestedAmount,
      'form.installments': numberOfInstallments,
      'form.change_type': changeType,
    });
    const pending = Object.entries(prefills).filter(
      ([code, value]) =>
        !touchedAttributeCodes.current.has(code) && dynamicValues[code] !== value,
    );
    if (!pending.length) return;
    setDynamicValues((prev) => ({ ...prev, ...Object.fromEntries(pending) }));
  }, [
    dynamicAttributes,
    dynamicValues,
    reason,
    fromDate,
    toDate,
    leaveDuration,
    selectedLeaveTypeId,
    isNegativeLeave,
    startTime,
    endTime,
    otType,
    isNightOt,
    tripType,
    destination,
    allowOt,
    requestedAmount,
    numberOfInstallments,
    changeType,
  ]);

  const editSavedDraft = async (draft: RequestDraft) => {
    await handleOpenCreateForType(draft.kind, requestDraftNames[draft.kind]);
    setEditingDraft(draft);
    const p = draft.payload;
    const str = (key: string, fallback = '') => String(p[key] ?? fallback);
    setReason(str('reason'));
    setFromDate(str('fromDate', str('workDate', str('requestDate'))));
    setToDate(
      str('toDate', str('fromDate', str('workDate', str('requestDate')))),
    );
    setSelectedLeaveTypeId(str('leaveTypeId'));
    setLeaveDuration(str('duration', '1'));
    setLeaveAttachmentId(str('attachmentFileId'));
    setIsNegativeLeave(p.isNegativeLeave === true);
    setOtType(str('otType', 'WEEKDAY') as typeof otType);
    setIsNightOt(p.isNightOt === true);
    setStartTime(str('startTime', '18:00'));
    setEndTime(str('endTime', '21:00'));
    setTripType(str('businessTripType', 'DOMESTIC') as typeof tripType);
    setDestination(str('destination'));
    setProjectId(str('projectId'));
    setProjectName(str('projectName'));
    setWorkItemId(str('workItemId'));
    setAllowOt(p.allowOt === true);
    setChangeType(str('changeType', 'SWAP') as typeof changeType);
    setCurrentShiftId(str('currentShiftId'));
    setRequestedShiftId(str('requestedShiftId'));
    setSwapWithEmployeeId(str('swapWithEmployeeId'));
    setRequestedAmount(str('requestedAmount', '0'));
    setNumberOfInstallments(str('numberOfInstallments', '1'));
    setCorrectionSessions(correctionDraftRows(p));
    const draftAttributes = (p.attributes || {}) as Record<string, unknown>;
    setDynamicValues(draftAttributes);
    touchedAttributeCodes.current = new Set(Object.keys(draftAttributes));
    draftAttributeCodes.current = Object.keys(draftAttributes);
    if (draft.kind === 'profile_correction') {
      const changes = (p.changes || {}) as Record<string, string>;
      if (changes.fullName !== undefined) setAdjustFullName(changes.fullName);
      if (changes.dateOfBirth !== undefined)
        setAdjustDateOfBirth(changes.dateOfBirth);
      if (changes.gender !== undefined) setAdjustGender(changes.gender);
      if (changes.identityCardNumber !== undefined)
        setAdjustIdentityCard(changes.identityCardNumber);
      if (changes.identityCardIssuedDate !== undefined)
        setAdjustIdentityDate(changes.identityCardIssuedDate);
      if (changes.identityCardIssuedPlace !== undefined)
        setAdjustIdentityPlace(changes.identityCardIssuedPlace);
      if (changes.taxCode !== undefined) setAdjustTaxCode(changes.taxCode);
      if (changes.socialInsuranceNumber !== undefined)
        setAdjustSocialInsurance(changes.socialInsuranceNumber);
    }
  };

  // Submit đơn theo đúng bảng nghiệp vụ riêng của từng domain (Mục 6 trong PLAN)
  const handleSubmitRequest = async (saveAsDraft = false) => {
    if (!saveAsDraft && !reason.trim()) {
      toast.error({
        title: 'Thiếu thông tin',
        description: 'Vui lòng nhập lý do khởi tạo yêu cầu.',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      let res: Response | null = null;
      const persistRequest = async (
        url: string,
        init: RequestInit,
      ): Promise<Response> => {
        const payload = JSON.parse(String(init.body));
        const saved = await fetch(
          hrmApiUrl(
            editingDraft
              ? `/request-drafts/${selectedCatalogId}/${editingDraft.id}`
              : `/request-drafts/${selectedCatalogId}`,
          ),
          {
            ...init,
            method: editingDraft ? 'PATCH' : 'POST',
            body: JSON.stringify({
              employeeId: profile.id,
              payload,
              expectedUpdatedAt: editingDraft?.updatedAt,
            }),
          },
        );
        if (!saved.ok || saveAsDraft) return saved;
        const { data } = (await saved.json()) as { data: RequestDraft };
        setEditingDraft(data);
        return fetch(url, {
          ...init,
          body: JSON.stringify({
            employeeId: profile.id,
            draftId: data.id,
            expectedUpdatedAt: data.updatedAt,
          }),
        });
      };

      if (selectedCatalogId === 'leave') {
        const typeId = selectedLeaveTypeId || (leaveTypes[0]?.id ?? '');
        if (!typeId) {
          toast.error({
            title: 'Lỗi',
            description:
              'Chưa có loại nghỉ phép hợp lệ được cấu hình trên hệ thống.',
          });
          return;
        }
        let attachmentFileId = leaveAttachmentId;
        if (leaveFile && !attachmentFileId) {
          const uploaded = await hrmFetch<{
            data: { id: string; uploadUrl: string; contentType: string };
          }>('/attachments', {
            method: 'POST',
            body: JSON.stringify({
              employeeId: profile.id,
              fileName: leaveFile.name,
              contentType: leaveFile.type,
              sizeBytes: leaveFile.size,
            }),
          });
          const put = await fetch(uploaded.data.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': uploaded.data.contentType },
            body: leaveFile,
          });
          if (!put.ok)
            throw new Error('Không tải được chứng từ lên kho lưu trữ');
          await hrmFetch(`/attachments/${uploaded.data.id}/complete`, {
            method: 'POST',
          });
          attachmentFileId = uploaded.data.id;
          setLeaveAttachmentId(attachmentFileId);
        }
        res = await persistRequest(hrmApiUrl('/leave-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            leaveTypeId: typeId,
            attachmentFileId: attachmentFileId || undefined,
            fromDate,
            toDate,
            duration: parseFloat(leaveDuration) || 1.0,
            isNegativeLeave,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'ot') {
        const [sh, sm] = startTime.split(':').map(Number),
          [eh, em] = endTime.split(':').map(Number);
        const plannedMin = (eh * 60 + em - sh * 60 - sm + 1440) % 1440;

        res = await persistRequest(hrmApiUrl('/ot-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            workDate: fromDate,
            startTime,
            endTime,
            plannedMinutes: plannedMin,
            otType,
            isNightOt,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'business_trip') {
        const d1 = new Date(fromDate).getTime();
        const d2 = new Date(toDate).getTime();
        const days = Math.max(
          1,
          Math.round((d2 - d1) / (1000 * 3600 * 24)) + 1,
        );

        res = await persistRequest(hrmApiUrl('/business-trip-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            businessTripType: tripType,
            workItemId: workItemId || undefined,
            destination: destination || 'Công tác theo kế hoạch phòng ban',
            projectId: projectId || null,
            projectName: projectName || null,
            fromDate,
            toDate,
            daysCount: days,
            allowOt,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'shift_change') {
        if (!currentShiftId || !requestedShiftId) {
          toast.error({
            title: 'Thiếu thông tin ca',
            description: 'Vui lòng chọn ca hiện tại và ca muốn đổi.',
          });
          return;
        }

        res = await persistRequest(hrmApiUrl('/shift-change-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            changeType,
            currentShiftId,
            requestedShiftId,
            fromDate,
            toDate,
            swapWithEmployeeId:
              changeType === 'SWAP' ? swapWithEmployeeId || null : null,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'correction') {
        res = await persistRequest(hrmApiUrl('/attendance-corrections'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            requestDate: fromDate,
            sessions: correctionPayload(correctionSessions),
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'advance') {
        const amt = parseFloat(requestedAmount);
        if (isNaN(amt) || amt <= 0) {
          toast.error({
            title: 'Số tiền không hợp lệ',
            description: 'Vui lòng nhập số tiền tạm ứng lớn hơn 0.',
          });
          return;
        }

        res = await persistRequest(hrmApiUrl('/salary-advance-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            requestDate: fromDate,
            requestedAmount: amt,
            numberOfInstallments: parseInt(numberOfInstallments, 10) || 1,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'profile_correction') {
        const changes: string[] = [];
        const oldName = rawProfile.fullName || profile.fullName || '';
        if (adjustFullName.trim() && adjustFullName.trim() !== oldName) {
          changes.push(`Họ và tên: "${oldName}" -> "${adjustFullName.trim()}"`);
        }

        const oldDob = rawProfile.dateOfBirth
          ? String(rawProfile.dateOfBirth).slice(0, 10)
          : '';
        if (adjustDateOfBirth && adjustDateOfBirth !== oldDob) {
          changes.push(
            `Ngày sinh: "${oldDob || '----'}" -> "${adjustDateOfBirth}"`,
          );
        }

        const oldGender = rawProfile.gender || 'MALE';
        if (adjustGender && adjustGender !== oldGender) {
          changes.push(`Giới tính: "${oldGender}" -> "${adjustGender}"`);
        }

        const oldCccd = rawProfile.identityCardNumber || '';
        if (
          adjustIdentityCard.trim() &&
          adjustIdentityCard.trim() !== oldCccd
        ) {
          changes.push(
            `Số CCCD/CMND: "${oldCccd || '----'}" -> "${adjustIdentityCard.trim()}"`,
          );
        }

        const oldCccdDate = rawProfile.identityCardIssuedDate
          ? String(rawProfile.identityCardIssuedDate).slice(0, 10)
          : '';
        if (adjustIdentityDate && adjustIdentityDate !== oldCccdDate) {
          changes.push(
            `Ngày cấp: "${oldCccdDate || '----'}" -> "${adjustIdentityDate}"`,
          );
        }

        const oldCccdPlace = rawProfile.identityCardIssuedPlace || '';
        if (
          adjustIdentityPlace.trim() &&
          adjustIdentityPlace.trim() !== oldCccdPlace
        ) {
          changes.push(
            `Nơi cấp: "${oldCccdPlace || '----'}" -> "${adjustIdentityPlace.trim()}"`,
          );
        }

        const oldTax = rawProfile.taxCode || '';
        if (adjustTaxCode.trim() && adjustTaxCode.trim() !== oldTax) {
          changes.push(
            `Mã số thuế: "${oldTax || '----'}" -> "${adjustTaxCode.trim()}"`,
          );
        }

        const oldBhxh = rawProfile.socialInsuranceNumber || '';
        if (
          adjustSocialInsurance.trim() &&
          adjustSocialInsurance.trim() !== oldBhxh
        ) {
          changes.push(
            `Số sổ BHXH: "${oldBhxh || '----'}" -> "${adjustSocialInsurance.trim()}"`,
          );
        }

        if (changes.length === 0) {
          toast.error({
            title: 'Chưa có thông tin thay đổi',
            description:
              'Bạn chưa thay đổi trường dữ liệu nào so với hồ sơ hiện tại.',
          });
          return;
        }

        const formattedReason = `[Đề nghị điều chỉnh hồ sơ (${changes.length} mục)]\n- ${changes.join('\n- ')}\n${profileEvidenceDoc.trim() ? `• Minh chứng kèm theo: ${profileEvidenceDoc.trim()}\n` : ''}• Lý do điều chỉnh: ${reason.trim()}`;

        const patch: Record<string, string> = {
          fullName: adjustFullName,
          dateOfBirth: adjustDateOfBirth,
          gender: adjustGender,
          identityCardNumber: adjustIdentityCard,
          identityCardIssuedDate: adjustIdentityDate,
          identityCardIssuedPlace: adjustIdentityPlace,
          taxCode: adjustTaxCode,
          socialInsuranceNumber: adjustSocialInsurance,
        };
        const changed = Object.fromEntries(
          Object.entries(patch).filter(
            ([key, value]) =>
              value &&
              value !==
                String(rawProfile[key] || '').slice(
                  0,
                  key === 'dateOfBirth' || key === 'identityCardIssuedDate'
                    ? 10
                    : undefined,
                ),
          ),
        );
        res = await persistRequest(hrmApiUrl('/profile-corrections'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            changes: changed,
            reason: formattedReason,
            attributes: dynamicValues,
          }),
        });
      }

      if (res && res.ok) {
        setDraftRefresh((value) => value + 1);
        setIsCreateModalOpen(false);
        setReason('');
        toast.success({
          title: saveAsDraft ? 'Đã lưu bản nháp' : 'Đã gửi đơn',
          description: saveAsDraft
            ? 'Nháp chưa phát sinh hiệu lực nghiệp vụ.'
            : 'Đơn đã được ghi nhận; theo dõi trạng thái trong danh sách.',
        });
        await loadData();
        setActiveTab(saveAsDraft ? 'drafts' : 'pending');
      } else {
        let errMsg = 'Không thể gửi đơn yêu cầu. Vui lòng thử lại sau.';
        let unavailable = false;
        try {
          const errData = await res?.json();
          const info = apiErrorInfo(errData);
          if (info.message) errMsg = info.message;
          if (res?.status === 409 && info.code === 'PROCEDURE_UNAVAILABLE') {
            unavailable = true;
            errMsg = PROCEDURE_UNAVAILABLE_MESSAGE;
          }
        } catch {
          // ignore
        }
        toast.error({
          title: unavailable
            ? 'Procedure Engine không khả dụng'
            : 'Tạo đơn thất bại',
          description: errMsg,
        });
      }
    } catch (err) {
      console.error('Lỗi khi gửi đơn yêu cầu:', err);
      toast.error({
        title: 'Lỗi kết nối',
        description:
          err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ.',
      });
    } finally {
      setIsSubmitting(false);
    }
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
        await loadData();
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
        await loadData();
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
    setActiveTab('history');
    void handleOpenDetailDrawer(request);
  }, [notificationRequestId, requestsList, handleOpenDetailDrawer]);

  const leaveTypeOptions: SearchableSelectOption[] = useMemo(() => {
    return leaveTypes.map((t) => ({
      value: t.id,
      label: t.name,
      badge: t.code,
      description: t.paid ? 'Có hưởng lương' : 'Không hưởng lương',
    }));
  }, [leaveTypes]);

  const shiftOptions: SearchableSelectOption[] = useMemo(() => {
    return shiftsList.map((s) => ({
      value: s.id,
      label: `${s.name} (${s.startTime} - ${s.endTime})`,
      badge: s.code,
    }));
  }, [shiftsList]);

  const colleagueOptions: SearchableSelectOption[] = useMemo(() => {
    return colleaguesList.map((e) => ({
      value: e.id,
      label: `${e.fullName} (${e.employeeCode})`,
      badge: e.department || 'Nhân sự',
      description: e.position || undefined,
    }));
  }, [colleaguesList]);

  const projectOptions: SearchableSelectOption[] = useMemo(() => {
    return workspaceProjects.map((p) => ({
      value: p.id,
      label: `${p.name} (${p.code})`,
      badge: p.code,
      description:
        p.status === 'active'
          ? 'Đang triển khai'
          : p.status === 'planning'
            ? 'Đang lập kế hoạch'
            : p.status,
    }));
  }, [workspaceProjects]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Đơn từ & Yêu cầu
            </h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
              ESS / {requestCatalog.length} loại đơn
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Trung tâm khởi tạo và giám sát tiến độ toàn bộ các giao dịch phát
            sinh cần phê duyệt của nhân viên.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-medium gap-1.5 h-9 border-slate-200 hover:bg-slate-50"
            onClick={() => {
              toast.success({
                title: 'Đang xuất lịch sử',
                description: 'File Lich_su_don_tu.xlsx đã được tải về.',
              });
            }}
          >
            <Download className="size-3.5" />
            <span>Xuất lịch sử đơn</span>
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold gap-1.5 h-9 shadow-xs"
            onClick={() =>
              handleOpenCreateForType('leave', 'Đơn xin nghỉ phép')
            }
          >
            <Plus className="size-3.5" />
            <span>Tạo đơn mới</span>
          </Button>
        </div>
      </div>

      {/* 2. Employee Profile Snapshot */}
      <EmployeeHeroCard profile={profile} />

      {/* 3. Sub-tabs Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('drafts')}
            className={`py-3 border-b-2 ${activeTab === 'drafts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}
          >
            Bản nháp
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'catalog'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FilePlus className="size-4" />
            <span>Tạo đơn mới (Request Catalog)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
              {requestCatalog.length} loại đơn
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pending'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Clock className="size-4" />
            <span>Đơn đang chờ duyệt (Pending)</span>
            {totalPendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {totalPendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="size-4" />
            <span>Lịch sử đơn từ (History)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
              {requestsList.length}
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'drafts' && (
        <HrmRequestDrafts
          key={draftRefresh}
          employeeId={profile.id}
          onEdit={editSavedDraft}
          onSubmitted={loadData}
        />
      )}
      {/* SUB-TAB 1: REQUEST CATALOG (6 System Requests) */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {requestCatalog.map((cat) => (
              <div
                key={cat.id}
                className="bg-white rounded-xl border border-slate-200 hover:border-blue-500 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className={`size-10 rounded-xl ${cat.iconBg} flex items-center justify-center font-bold shadow-xs`}
                    >
                      <FileText className="size-5" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold ${
                        cat.tagColor === 'emerald'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : cat.tagColor === 'amber'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : cat.tagColor === 'rose'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {cat.tag}
                    </Badge>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                    {cat.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 mb-3 leading-relaxed line-clamp-2">
                    {cat.desc}
                  </p>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] font-medium text-slate-600 mb-4">
                    {cat.balanceLabel}
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold gap-1.5 h-8"
                  onClick={() => handleOpenCreateForType(cat.id, cat.title)}
                >
                  <Plus className="size-3.5" />
                  <span>Khởi tạo đơn này</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: PENDING APPROVAL */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Header Title */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-900 text-xs uppercase tracking-wide">
                Danh sách yêu cầu đang chờ phê duyệt ({pendingRequests.length})
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Tự động gửi thông báo nhắc duyệt SLA 24h
              </span>
            </div>

            {/* Filter Toolbar for Pending Requests */}
            <div className="p-3 bg-slate-50/50 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <div className="w-full sm:w-56">
                  <Input
                    placeholder="Tìm mã đơn, loại hoặc lý do..."
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả loại đơn' },
                      { value: 'leave', label: 'Nghỉ phép' },
                      { value: 'ot', label: 'Làm thêm giờ (OT)' },
                      { value: 'business_trip', label: 'Công tác' },
                      { value: 'shift_change', label: 'Đổi ca' },
                      { value: 'correction', label: 'Bổ sung công' },
                      { value: 'advance', label: 'Tạm ứng lương' },
                      {
                        value: 'profile_correction',
                        label: 'Đính chính nhân sự',
                      },
                    ]}
                    value={pendingKind}
                    onChange={(val) => setPendingKind(val || 'ALL')}
                    placeholder="Lọc loại đơn..."
                    clearable={false}
                  />
                </div>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả giai đoạn' },
                      { value: 'PENDING_APPROVAL', label: 'Chờ quản lý duyệt' },
                      { value: 'PENDING_PEER', label: 'Chờ đồng nghiệp' },
                    ]}
                    value={pendingStatus}
                    onChange={(val) => setPendingStatus(val || 'ALL')}
                    placeholder="Lọc giai đoạn..."
                    clearable={false}
                  />
                </div>
                {workflowFilterControls}
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="text-[11px] whitespace-nowrap">
                    Từ ngày:
                  </span>
                  <div className="w-32">
                    <DatePickerInput
                      value={pendingFromDate}
                      onChange={(val) => setPendingFromDate(val || '')}
                      placeholder="dd/mm/yyyy"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                  <span className="text-[11px] whitespace-nowrap">Đến:</span>
                  <div className="w-32">
                    <DatePickerInput
                      value={pendingToDate}
                      onChange={(val) => setPendingToDate(val || '')}
                      placeholder="dd/mm/yyyy"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                </div>
                {(pendingSearch ||
                  waitAssignee ||
                  waitStep ||
                  pendingKind !== 'ALL' ||
                  pendingStatus !== 'ALL' ||
                  pendingFromDate ||
                  pendingToDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 text-slate-500 hover:text-slate-800"
                    onClick={() => {
                      setPendingSearch('');
                      setWaitAssignee('');
                      setWaitStep('');
                      setPendingKind('ALL');
                      setPendingStatus('ALL');
                      setPendingFromDate('');
                      setPendingToDate('');
                    }}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Đặt lại
                  </Button>
                )}
              </div>
              <div className="text-xs text-slate-500 font-medium text-right shrink-0">
                Hiển thị <strong>{pendingRequests.length}</strong> /{' '}
                {totalPendingCount} yêu cầu
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin text-[#021E73]" />
                  <span>Đang tải danh sách đơn từ...</span>
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  Không tìm thấy yêu cầu nào đang chờ duyệt phù hợp với bộ lọc.
                </div>
              ) : (
                pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-lg bg-blue-100 text-[#021E73] flex items-center justify-center font-bold shrink-0 mt-0.5">
                        <FileText className="size-4" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 text-xs">
                            {req.code}
                          </span>
                          <span className="font-bold text-slate-900 text-xs">
                            {req.typeName}
                          </span>
                          <Badge
                            className={
                              req.workflowStatus === 'PENDING_PEER'
                                ? 'bg-indigo-100 text-indigo-800 text-[10px] font-bold border border-indigo-200'
                                : 'bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200'
                            }
                          >
                            {req.statusText}
                          </Badge>
                        </div>
                        <p className="text-slate-500 text-[11px]">
                          Tạo ngày:{' '}
                          <strong className="text-slate-700">
                            {req.createdAt}
                          </strong>{' '}
                          • Hiệu lực:{' '}
                          <strong className="text-slate-700">
                            {req.effectiveDate}
                          </strong>{' '}
                          ({req.duration}) • Lý do: {req.reason}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 ml-12 md:ml-0">
                      <div className="text-right hidden sm:block">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">
                          Người phê duyệt
                        </span>
                        <span className="font-semibold text-slate-800 text-xs">
                          {approverText(req)}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 border-slate-300"
                        onClick={() => handleOpenDetailDrawer(req)}
                      >
                        Chi tiết
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: HISTORY (Standard 3-Zone Enterprise Table) */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Zone 1: Header - Controls & Multi-criteria Filters */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <div className="w-full sm:w-56">
                  <Input
                    placeholder="Tìm theo mã đơn, loại hoặc lý do..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả loại đơn' },
                      { value: 'leave', label: 'Nghỉ phép' },
                      { value: 'ot', label: 'Làm thêm giờ (OT)' },
                      { value: 'business_trip', label: 'Công tác' },
                      { value: 'shift_change', label: 'Đổi ca' },
                      { value: 'correction', label: 'Bổ sung công' },
                      { value: 'advance', label: 'Tạm ứng lương' },
                      {
                        value: 'profile_correction',
                        label: 'Đính chính nhân sự',
                      },
                    ]}
                    value={filterKind}
                    onChange={(val) => setFilterKind(val || 'ALL')}
                    placeholder="Lọc loại đơn..."
                    clearable={false}
                  />
                </div>
                <div className="w-40">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả trạng thái' },
                      { value: 'PENDING', label: 'Đang chờ duyệt' },
                      { value: 'APPROVED', label: 'Đã duyệt / Áp dụng' },
                      { value: 'REJECTED', label: 'Đã từ chối' },
                      { value: 'CANCELLED', label: 'Đã rút / hủy' },
                    ]}
                    value={filterStatus}
                    onChange={(val) => setFilterStatus(val || 'ALL')}
                    placeholder="Lọc trạng thái..."
                    clearable={false}
                  />
                </div>
                {workflowFilterControls}
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="text-[11px] whitespace-nowrap">
                    Từ ngày:
                  </span>
                  <div className="w-32">
                    <DatePickerInput
                      value={historyFromDate}
                      onChange={(val) => setHistoryFromDate(val || '')}
                      placeholder="dd/mm/yyyy"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                  <span className="text-[11px] whitespace-nowrap">Đến:</span>
                  <div className="w-32">
                    <DatePickerInput
                      value={historyToDate}
                      onChange={(val) => setHistoryToDate(val || '')}
                      placeholder="dd/mm/yyyy"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                </div>
                {(searchQuery ||
                  waitAssignee ||
                  waitStep ||
                  filterKind !== 'ALL' ||
                  filterStatus !== 'ALL' ||
                  historyFromDate ||
                  historyToDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 text-slate-500 hover:text-slate-800"
                    onClick={() => {
                      setSearchQuery('');
                      setWaitAssignee('');
                      setWaitStep('');
                      setFilterKind('ALL');
                      setFilterStatus('ALL');
                      setHistoryFromDate('');
                      setHistoryToDate('');
                    }}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Đặt lại
                  </Button>
                )}
              </div>
              <div className="text-xs text-slate-500 font-medium text-right shrink-0">
                Tìm thấy <strong>{filteredHistory.length}</strong> /{' '}
                {requestsList.length} hồ sơ
              </div>
            </div>

            {/* Zone 2: Body - Data Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="p-3 pl-4">Mã đơn</th>
                    <th className="p-3">Loại yêu cầu</th>
                    <th className="p-3">Ngày tạo</th>
                    <th className="p-3">Thời gian hiệu lực</th>
                    <th className="p-3">Thời lượng / Giá trị</th>
                    <th className="p-3">Lý do</th>
                    <th className="p-3">Người duyệt</th>
                    <th className="p-3">Trạng thái Quy trình</th>
                    <th className="p-3">Kết quả Hậu xử lý</th>
                    <th className="p-3 pr-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-8 text-center text-slate-400"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#021E73]" />
                          <span>Đang tải lịch sử đơn từ...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredHistory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-8 text-center text-slate-400"
                      >
                        Không tìm thấy hồ sơ đơn từ nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((req) => (
                      <tr
                        key={req.id}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="p-3 pl-4 font-mono font-bold text-[#021E73]">
                          {req.code}
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          {req.typeName}
                        </td>
                        <td className="p-3 text-slate-600 font-mono text-[11px]">
                          {req.createdAt}
                        </td>
                        <td className="p-3 text-slate-600">
                          {req.effectiveDate}
                        </td>
                        <td className="p-3 font-mono font-semibold">
                          {req.duration}
                        </td>
                        <td
                          className="p-3 text-slate-500 text-[11px] max-w-[180px] truncate"
                          title={req.reason}
                        >
                          {req.reason}
                        </td>
                        <td className="p-3 text-slate-700 text-[11px]">
                          {approverText(req)}
                        </td>
                        <td className="p-3">
                          <Badge
                            className={
                              req.workflowStatus === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px]'
                                : req.workflowStatus === 'PENDING_PEER'
                                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px]'
                                  : req.workflowStatus === 'PENDING_APPROVAL'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200 text-[10px]'
                                    : 'bg-rose-100 text-rose-700 border border-rose-200 text-[10px]'
                            }
                          >
                            {req.requestStatus === 'CANCELLED'
                              ? 'Đã rút / hủy'
                              : req.workflowStatus === 'APPROVED'
                                ? 'Đã duyệt'
                                : req.workflowStatus === 'PENDING_PEER'
                                  ? 'Chờ đồng nghiệp'
                                  : req.workflowStatus === 'REJECTED'
                                    ? 'Đã từ chối'
                                    : 'Chờ duyệt'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {req.requestStatus === 'APPLIED' ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">
                              Đã cập nhật công
                            </Badge>
                          ) : req.requestStatus === 'DISBURSED' ? (
                            <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px]">
                              Đã giải ngân
                            </Badge>
                          ) : (
                            <span className="text-slate-400 text-[11px]">
                              {['CANCELLED', 'REJECTED'].includes(
                                req.requestStatus,
                              )
                                ? 'Không áp dụng'
                                : 'Chưa áp dụng'}
                            </span>
                          )}
                        </td>
                        <td className="p-3 pr-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7 text-blue-700 hover:bg-blue-50"
                            onClick={() => handleOpenDetailDrawer(req)}
                          >
                            Chi tiết
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Zone 3: Footer - Pagination Standard Info */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div>
                Hiển thị <strong>1 – {filteredHistory.length}</strong> trong
                tổng số <strong>{filteredHistory.length}</strong> đơn từ
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled
                >
                  Trang trước
                </Button>
                <span className="font-semibold text-slate-700">1 / 1</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled
                >
                  Trang sau
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: KHỞI TẠO ĐƠN THEO TỪNG LOẠI NGHIỆP VỤ */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white">
          <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FilePlus className="size-4 text-[#021E73]" />
                Khởi tạo: {selectedTypeTitle}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhập đầy đủ thông tin để gửi đơn chờ phê duyệt
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold">
              Chờ người có thẩm quyền duyệt
            </Badge>
          </div>

          <div className="p-6 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
            {/* THÔNG TIN HỖ TRỢ / ĐIỀU KIỆN (Mục 3 Khối 3 trong PLAN) */}
            {selectedCatalogId === 'leave' && (
              <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-600 block text-[11px]">
                    Quỹ khả dụng của loại nghỉ đã chọn:
                  </span>
                  <strong className="text-sm text-[#021E73] font-mono">
                    {leaveBalance.remaining} ngày
                  </strong>
                  {leaveBalance.entitlement !== '----' && (
                    <span className="text-slate-500 block text-[11px]">
                      Quỹ dự kiến năm {leaveBalance.entitlement} ngày ·{' '}
                      {leaveBalance.advanceAllowed
                        ? 'được ứng trước đến hết năm'
                        : 'chỉ dùng phần đã tích luỹ đến tháng này'}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">
                    Sau khi xin ({leaveDuration} ngày):
                  </span>
                  <strong className="text-sm text-emerald-700 font-mono">
                    {leaveBalance.remaining !== '----'
                      ? (
                          parseFloat(leaveBalance.remaining) -
                          parseFloat(leaveDuration)
                        ).toFixed(1)
                      : '----'}{' '}
                    ngày
                  </strong>
                </div>
              </div>
            )}

            {selectedCatalogId === 'advance' && (
              <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-600 block text-[11px]">
                    Số tiền tạm ứng:
                  </span>
                  <strong className="text-sm text-indigo-900 font-mono">
                    Theo số tiền được phê duyệt
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">
                    Dự kiến trừ mỗi kỳ:
                  </span>
                  <strong className="text-sm text-emerald-700 font-mono">
                    {(
                      parseFloat(requestedAmount || '0') /
                      (parseInt(numberOfInstallments, 10) || 1)
                    ).toLocaleString('vi-VN')}{' '}
                    đ
                  </strong>
                </div>
              </div>
            )}

            {/* FORM 1: NGHỈ PHÉP */}
            {selectedCatalogId === 'leave' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">
                    Loại hình nghỉ phép *
                  </label>
                  <SearchableSelect
                    options={leaveTypeOptions}
                    value={selectedLeaveTypeId}
                    onChange={(val) => setSelectedLeaveTypeId(val)}
                    placeholder="Chọn loại phép..."
                    clearable={false}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Từ ngày *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Đến ngày *
                    </label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-800 block">
                    Thời lượng nghỉ
                  </label>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={leaveDuration}
                    onChange={(e) => setLeaveDuration(e.target.value)}
                    aria-label="Số ngày hoặc giờ nghỉ theo loại phép"
                  />
                  <p className="text-slate-500">
                    Nhập số ngày hoặc giờ theo đơn vị của loại nghỉ; không tính
                    OFF và lễ.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('1.0')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '1.0'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      Cả ngày (1.0)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('0.5')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '0.5'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      Nửa ngày (0.5)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('2.0')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '2.0'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      2 ngày (2.0)
                    </button>
                  </div>
                </div>

                {/* Chế độ Ứng phép & Âm phép theo HRM_PLAN_1 */}
                <div className="p-3 bg-amber-50/70 rounded-lg border border-amber-200 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="negativeLeaveCheck"
                      checked={isNegativeLeave}
                      onChange={(e) => setIsNegativeLeave(e.target.checked)}
                      className="rounded border-amber-300 text-amber-700 focus:ring-amber-500 size-4"
                    />
                    <label
                      htmlFor="negativeLeaveCheck"
                      className="text-xs font-bold text-amber-900 cursor-pointer"
                    >
                      Đơn có dùng phép ứng trước / âm phép
                    </label>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed pl-6">
                    Số ngày được ứng theo chính sách của loại nghỉ và đã tính
                    trong quỹ khả dụng ở trên. Khi nghỉ việc, phần đã dùng vượt
                    quỹ thực hưởng sẽ bị thu hồi và trừ vào lương.
                  </p>
                </div>
                <label className="block space-y-1 font-semibold">
                  Chứng từ (PDF, PNG, JPEG; tối đa 10 MB)
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      setLeaveFile(e.target.files?.[0] || null);
                      setLeaveAttachmentId('');
                    }}
                  />
                </label>
                {leaveAttachmentId && (
                  <div className="flex items-center gap-2 text-xs">
                    <span>Đã lưu chứng từ vào kho.</span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void hrmFetch<{ data: { url: string } }>(
                          `/attachments/${leaveAttachmentId}/download`,
                        )
                          .then((result) =>
                            window.open(
                              result.data.url,
                              '_blank',
                              'noopener,noreferrer',
                            ),
                          )
                          .catch((e) => toast.error(e.message))
                      }
                    >
                      Xem chứng từ
                    </Button>
                    <Popconfirm
                      title="Gỡ chứng từ khỏi bản nháp?"
                      description="Chứng từ của đơn đã gửi được giữ lại trong lịch sử."
                      onConfirm={async () => {
                        try {
                          const result = await hrmFetch<{
                            data: {
                              changedDrafts: {
                                id: string;
                                revision: number;
                                updatedAt: string;
                              }[];
                            };
                          }>(`/attachments/${leaveAttachmentId}`, {
                            method: 'DELETE',
                            body: JSON.stringify({
                              reason:
                                'Người lập gỡ chứng từ khỏi bản nháp để cập nhật hồ sơ',
                            }),
                          });
                          setLeaveAttachmentId('');
                          setLeaveFile(null);
                          setEditingDraft((draft) => {
                            const updated = result.data.changedDrafts.find(
                              (item) => item.id === draft?.id,
                            );
                            if (!draft || !updated) return draft;
                            const payload = { ...draft.payload };
                            delete payload.attachmentFileId;
                            return { ...draft, ...updated, payload };
                          });
                        } catch (e) {
                          toast.error(
                            e instanceof Error
                              ? e.message
                              : 'Không gỡ được chứng từ',
                          );
                        }
                      }}
                    >
                      <Button type="button" variant="outline">
                        Gỡ chứng từ
                      </Button>
                    </Popconfirm>
                  </div>
                )}
              </>
            )}

            {/* FORM 2: LÀM THÊM GIỜ (OT) */}
            {selectedCatalogId === 'ot' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Ngày làm thêm (OT) *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Loại OT (Hệ số lương) *
                    </label>
                    <SearchableSelect
                      options={[
                        { value: 'WEEKDAY', label: 'Ngày thường' },
                        {
                          value: 'WEEKEND',
                          label: 'Ngày nghỉ',
                        },
                        { value: 'NIGHT', label: 'Làm thêm ca đêm' },
                        { value: 'HOLIDAY', label: 'Lễ / Tết' },
                      ]}
                      value={otType}
                      onChange={(val) => setOtType(val as any)}
                      clearable={false}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Giờ bắt đầu *
                    </label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Giờ kết thúc *
                    </label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="nightOtCheck"
                    checked={isNightOt}
                    onChange={(e) => setIsNightOt(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 size-4"
                  />
                  <label
                    htmlFor="nightOtCheck"
                    className="text-xs text-slate-700 font-medium cursor-pointer"
                  >
                    Áp dụng phụ trội ca đêm (tính thêm $\ge 30\%$ theo Bộ luật
                    Lao động)
                  </label>
                </div>

                <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-200 text-[11px] text-blue-800 space-y-1">
                  <span className="font-bold block">
                    Quy tắc đối soát 2 vòng tự động:
                  </span>
                  <span>
                    Giờ OT được thanh toán ={' '}
                    <strong>
                      min(Giờ đăng ký duyệt, Giờ quẹt thẻ thực tế)
                    </strong>
                    . Hệ thống tự động kiểm soát trần tối đa 4h/ngày và
                    40h/tháng.
                  </span>
                </div>
              </>
            )}

            {/* FORM 3: CÔNG TÁC */}
            {selectedCatalogId === 'business_trip' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Loại hình công tác *
                    </label>
                    <SearchableSelect
                      options={[
                        { value: 'DOMESTIC', label: 'Nội địa (Domestic)' },
                        { value: 'OVERSEAS', label: 'Quốc tế (Overseas)' },
                        {
                          value: 'INTERSITE',
                          label: 'Nội bộ liên chi nhánh (Intersite)',
                        },
                      ]}
                      value={tripType}
                      onChange={(val) => setTripType(val as any)}
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Địa điểm công tác *
                    </label>
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="VD: Trạm biến áp 500kV Phố Nối"
                      className="text-xs"
                    />
                  </div>
                </div>

                {/* Liên kết Dự án từ Workspace phục vụ điều phối và Cost Allocation */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800 block">
                      Dự án liên kết (từ Workspace)
                    </label>
                    {projectId && (
                      <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono font-medium">
                        Mã:{' '}
                        {workspaceProjects.find((p) => p.id === projectId)
                          ?.code || projectId}
                      </span>
                    )}
                  </div>
                  <SearchableSelect
                    options={projectOptions}
                    value={projectId}
                    onChange={(val) => {
                      setProjectId(val);
                      const prj = workspaceProjects.find((p) => p.id === val);
                      if (prj) {
                        setProjectName(prj.name);
                      } else {
                        setProjectName('');
                      }
                    }}
                    placeholder="-- Chọn dự án trong Workspace (hoặc gõ tìm kiếm) --"
                    clearable={true}
                  />
                  <p className="text-[11px] text-slate-500">
                    Chọn dự án thực hiện công tác để liên kết và phân bổ chi phí chuẩn xác với Workspace.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Từ ngày *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Đến ngày *
                    </label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="allowOtCheck"
                    checked={allowOt}
                    onChange={(e) => setAllowOt(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 size-4"
                  />
                  <label
                    htmlFor="allowOtCheck"
                    className="text-xs text-slate-700 font-medium cursor-pointer"
                  >
                    Cho phép tính làm thêm giờ (OT) trong chuyến công tác nếu có
                    phát sinh
                  </label>
                </div>
              </>
            )}

            {/* FORM 4: ĐỔI CA */}
            {selectedCatalogId === 'shift_change' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">
                    Hình thức đổi ca *
                  </label>
                  <SearchableSelect
                    options={[
                      {
                        value: 'SWAP',
                        label:
                          'Hoán đổi ca với đồng nghiệp (Cần xác nhận chéo)',
                      },
                      {
                        value: 'CHANGE_SHIFT',
                        label: 'Đề nghị chuyển ca làm việc cá nhân',
                      },
                    ]}
                    value={changeType}
                    onChange={(val) => setChangeType(val as any)}
                    clearable={false}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Ca làm việc hiện tại *
                    </label>
                    <SearchableSelect
                      options={shiftOptions}
                      value={currentShiftId}
                      onChange={(val) => setCurrentShiftId(val)}
                      placeholder="Chọn ca hiện tại..."
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Ca làm việc đề xuất chuyển *
                    </label>
                    <SearchableSelect
                      options={shiftOptions}
                      value={requestedShiftId}
                      onChange={(val) => setRequestedShiftId(val)}
                      placeholder="Chọn ca mong muốn..."
                      clearable={false}
                    />
                  </div>
                </div>
                {changeType === 'SWAP' && (
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Đồng nghiệp hoán đổi ca *
                    </label>
                    <SearchableSelect
                      options={colleagueOptions}
                      value={swapWithEmployeeId}
                      onChange={(val) => setSwapWithEmployeeId(val)}
                      placeholder="Chọn đồng nghiệp để gửi yêu cầu xác nhận..."
                      clearable={false}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Từ ngày áp dụng *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Đến ngày áp dụng *
                    </label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
              </>
            )}

            {/* FORM 5: BỔ SUNG CÔNG (CORRECTION) - So sánh hiện tại vs Đề xuất theo Mục 4.1 trong PLAN */}
            {selectedCatalogId === 'correction' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">
                    Ngày phát sinh điều chỉnh *
                  </label>
                  <DatePickerInput
                    value={fromDate}
                    onChange={(val) => setFromDate(val)}
                    placeholder="dd/mm/yyyy"
                  />
                </div>
                <HrmCorrectionSessions
                  rows={correctionSessions}
                  onChange={setCorrectionSessions}
                />
              </>
            )}

            {/* FORM 6: TẠM ỨNG LƯƠNG */}
            {selectedCatalogId === 'advance' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Ngày yêu cầu tạm ứng *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Số tiền tạm ứng (VNĐ) *
                    </label>
                    <Input
                      type="number"
                      value={requestedAmount}
                      onChange={(e) => setRequestedAmount(e.target.value)}
                      placeholder="VD: 5000000"
                      className="text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">
                    Số kỳ khấu trừ hoàn trả *
                  </label>
                  <SearchableSelect
                    options={[
                      {
                        value: '1',
                        label: '1 kỳ (Khấu trừ toàn bộ vào kỳ lương tới)',
                      },
                      { value: '2', label: '2 kỳ (Chia đều 2 tháng)' },
                      { value: '3', label: '3 kỳ (Chia đều 3 tháng)' },
                      { value: '4', label: '4 kỳ (Chia đều 4 tháng)' },
                    ]}
                    value={numberOfInstallments}
                    onChange={(val) => setNumberOfInstallments(val)}
                    clearable={false}
                  />
                </div>
              </>
            )}

            {/* FORM 7: ĐỀ NGHỊ ĐIỀU CHỈNH THÔNG TIN NHÂN SỰ (PROFILE CORRECTION - MULTI-FIELD) */}
            {selectedCatalogId === 'profile_correction' && (
              <>
                <div className="bg-blue-50/70 p-3 rounded-lg border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
                  <Info className="size-4 shrink-0 text-blue-700 mt-0.5" />
                  <span>
                    Bạn có thể chỉnh sửa trực tiếp một hoặc nhiều trường bên
                    dưới. Hệ thống sẽ tự động so sánh đối chiếu và tổng hợp các
                    mục thay đổi gửi tới phòng Nhân sự phê duyệt.
                  </span>
                </div>

                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {/* Họ và tên & Ngày sinh */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Họ và tên pháp lý
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {rawProfile.fullName || profile.fullName || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustFullName}
                        onChange={(e) => setAdjustFullName(e.target.value)}
                        placeholder="Nhập họ và tên..."
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Ngày sinh (date_of_birth)
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {formatVnDate(rawProfile.dateOfBirth)})
                        </span>
                      </label>
                      <DatePickerInput
                        value={adjustDateOfBirth}
                        onChange={(val) => setAdjustDateOfBirth(val)}
                        placeholder="dd/mm/yyyy"
                      />
                    </div>
                  </div>

                  {/* Giới tính & Số CCCD */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Giới tính
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {rawProfile.gender === 'FEMALE'
                            ? 'Nữ'
                            : rawProfile.gender === 'OTHER'
                              ? 'Khác'
                              : 'Nam'}
                          )
                        </span>
                      </label>
                      <SearchableSelect
                        options={[
                          { value: 'MALE', label: 'Nam' },
                          { value: 'FEMALE', label: 'Nữ' },
                          { value: 'OTHER', label: 'Khác' },
                        ]}
                        value={adjustGender}
                        onChange={(val) => setAdjustGender(val || 'MALE')}
                        clearable={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Số CCCD / CMND
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.identityCardNumber || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustIdentityCard}
                        onChange={(e) => setAdjustIdentityCard(e.target.value)}
                        placeholder="Số CCCD 12 chữ số..."
                        className="text-xs font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Ngày cấp & Nơi cấp */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Ngày cấp CCCD
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {formatVnDate(rawProfile.identityCardIssuedDate)})
                        </span>
                      </label>
                      <DatePickerInput
                        value={adjustIdentityDate}
                        onChange={(val) => setAdjustIdentityDate(val)}
                        placeholder="dd/mm/yyyy"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Nơi cấp CCCD
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {rawProfile.identityCardIssuedPlace || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustIdentityPlace}
                        onChange={(e) => setAdjustIdentityPlace(e.target.value)}
                        placeholder="VD: Cục Cảnh sát QLHC về TTXH"
                        className="text-xs"
                      />
                    </div>
                  </div>

                  {/* Mã số thuế & Số sổ BHXH */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Mã số thuế TNCN
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.taxCode || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustTaxCode}
                        onChange={(e) => setAdjustTaxCode(e.target.value)}
                        placeholder="Mã số thuế..."
                        className="text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Mã số BHXH
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {rawProfile.socialInsuranceNumber || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustSocialInsurance}
                        onChange={(e) =>
                          setAdjustSocialInsurance(e.target.value)
                        }
                        placeholder="Số sổ BHXH..."
                        className="text-xs font-mono"
                      />
                    </div>
                  </div>

                  {/* Minh chứng đính kèm */}
                  <div className="space-y-1 pt-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Tài liệu minh chứng / Ghi chú đính kèm
                    </label>
                    <Input
                      value={profileEvidenceDoc}
                      onChange={(e) => setProfileEvidenceDoc(e.target.value)}
                      placeholder="VD: Đã gửi bản scan 2 mặt CCCD gắn chip qua email hr@svn.vn"
                      className="text-xs"
                    />
                    <span className="text-[11px] text-slate-500 italic block mt-0.5">
                      * Ban Nhân sự sẽ căn cứ vào bản scan hoặc bản sao có chứng
                      thực để phê duyệt cập nhật vào Core.
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* LÝ DO CHUNG */}
            <div className="space-y-1">
              <label className="font-semibold text-slate-800 block">
                Lý do khởi tạo đơn yêu cầu *
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập chi tiết lý do và thông tin giải trình liên quan..."
                className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            {/* THUỘC TÍNH ĐỘNG TỪ PROCEDURE ENGINE NODE S */}
            {procedureAvailable === false && (
              <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                Procedure Engine đang không khả dụng. Đơn thuộc quy trình duyệt
                qua Procedure sẽ bị từ chối cho đến khi dịch vụ hoạt động lại.
              </div>
            )}
            {bindingState?.status === 'subtype-required' && (
              <div className="p-2.5 rounded-md border border-blue-200 bg-blue-50 text-[11px] text-blue-800">
                {bindingState.message}
              </div>
            )}
            {bindingState?.status === 'error' && (
              <div className="p-2.5 rounded-md border border-red-200 bg-red-50 text-[11px] text-red-700 flex items-center justify-between gap-2">
                <span>{bindingState.message}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 shrink-0"
                  onClick={() => setBindingReload((value) => value + 1)}
                >
                  Thử lại
                </Button>
              </div>
            )}
            {attributeNotice && (
              <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                {attributeNotice}
              </div>
            )}
            {loadingAttributes ? (
              <div className="py-2 text-center text-slate-400 text-xs flex items-center justify-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin text-[#021E73]" />
                <span>
                  Đang tải cấu hình thuộc tính xét duyệt từ Procedure Engine...
                </span>
              </div>
            ) : (
              <DynamicAttributeForm
                attributes={visibleDynamicAttributes(dynamicAttributes)}
                values={dynamicValues}
                onChange={(code, val) =>
                  setDynamicValues((prev) => {
                    const next = { ...prev };
                    touchedAttributeCodes.current.add(code);
                    if (val === undefined) delete next[code];
                    else next[code] = val;
                    return next;
                  })
                }
                userOptions={colleagueOptions}
                onUploadFile={(file) => uploadHrmAttachment(profile.id, file)}
              />
            )}

            {/* QUY TRÌNH DUYỆT (Mục 3 Khối 4 trong PLAN) */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
              <span>
                Quy trình áp dụng:{' '}
                <strong>
                  {procedureDefName ||
                    (selectedCatalogId === 'advance'
                      ? 'Quy trình Tạm ứng lương'
                      : 'Quy trình xét duyệt đơn từ nhân sự')}
                </strong>
              </span>
              <span className="font-mono text-slate-400">Node S khởi tạo</span>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Hủy
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => void handleSubmitRequest(true)}
            >
              Lưu nháp
            </Button>
            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1"
              onClick={() => void handleSubmitRequest(false)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span>{isSubmitting ? 'Đang gửi...' : 'Gửi duyệt đơn'}</span>
            </Button>
          </div>
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
                    ? 'bg-emerald-100 text-emerald-800 text-[10px]'
                    : isRejected
                      ? 'bg-rose-100 text-rose-700 text-[10px]'
                      : isPendingPeer
                        ? 'bg-indigo-100 text-indigo-800 text-[10px]'
                        : 'bg-amber-100 text-amber-800 text-[10px]';

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
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
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
                    <span className="text-slate-500 block">
                      Lý do khởi tạo:
                    </span>
                    <p className="p-2.5 rounded bg-white text-slate-700 leading-relaxed text-xs border border-slate-100">
                      {selectedRequest?.reason}
                      {typeof selectedRequest?.rawDetails.attachmentFileId ===
                        'string' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={async () => {
                            try {
                              const file = await hrmFetch<{
                                data: { url: string };
                              }>(
                                `/attachments/${selectedRequest.rawDetails.attachmentFileId}/download`,
                              );
                              window.open(
                                file.data.url,
                                '_blank',
                                'noopener,noreferrer',
                              );
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : 'Không tải được chứng từ',
                              );
                            }
                          }}
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
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <Info className="size-3.5 text-blue-600" />
                  Thông tin hỗ trợ & Điều kiện áp dụng
                </h4>
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
                  {selectedRequest?.kind === 'leave' && (
                    <>
                      <div className="flex justify-between">
                        <span>Quỹ phép khả dụng của nhân viên:</span>
                        <strong className="text-[#021E73]">
                          {leaveBalance.remaining} ngày
                        </strong>
                      </div>
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
                      {Boolean(selectedRequest.rawDetails?.isNightOt) && (
                        <div className="flex justify-between text-blue-700 font-semibold">
                          <span>Phụ trội ca đêm:</span>
                          <span>Cộng thêm $\ge 30\%$</span>
                        </div>
                      )}
                    </>
                  )}
                  {selectedRequest?.kind === 'business_trip' && (
                    <>
                      {(Boolean(selectedRequest.rawDetails?.projectId) ||
                        Boolean(selectedRequest.rawDetails?.projectName)) && (
                        <div className="flex justify-between items-center">
                          <span>Dự án liên kết:</span>
                          <span className="font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-right">
                            {selectedRequest.rawDetails?.projectName
                              ? String(selectedRequest.rawDetails.projectName)
                              : String(
                                  selectedRequest.rawDetails?.projectId || '',
                                )}
                            {Boolean(
                              selectedRequest.rawDetails?.projectName &&
                                selectedRequest.rawDetails?.projectId,
                            ) && (
                              <span className="text-[10px] text-slate-500 font-mono block">
                                Mã:{' '}
                                {workspaceProjects.find(
                                  (p) =>
                                    p.id ===
                                    selectedRequest.rawDetails?.projectId,
                                )?.code ||
                                  String(
                                    selectedRequest.rawDetails?.projectId,
                                  ).slice(0, 8)}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Chế độ công tác:</span>
                        <span>Phụ cấp lưu trú + Công chuẩn Timesheet</span>
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
                emptyFallback={
                  <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="size-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                        ✓
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">
                          Nhân viên khởi tạo yêu cầu
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {selectedRequest?.createdAt}
                        </div>
                      </div>
                    </div>

                    {selectedRequest?.kind === 'shift_change' && (
                      <div className="flex items-center gap-3">
                        <div
                          className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            selectedRequest.workflowStatus !== 'PENDING_PEER'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {selectedRequest.workflowStatus !== 'PENDING_PEER'
                            ? '✓'
                            : '•'}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800">
                            Đồng nghiệp xác nhận đổi ca
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {selectedRequest.workflowStatus !== 'PENDING_PEER'
                              ? 'Đã xác nhận chéo'
                              : 'Đang chờ phản hồi'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          selectedRequest?.workflowStatus === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700'
                            : selectedRequest?.workflowStatus === 'REJECTED'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {selectedRequest?.workflowStatus === 'APPROVED'
                          ? '✓'
                          : selectedRequest?.workflowStatus === 'REJECTED'
                            ? '✕'
                            : '•'}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">
                          Cấp thẩm quyền phê duyệt:{' '}
                          <strong>{selectedRequest?.approver}</strong>
                        </div>
                        <div className="text-[11px] text-slate-500">
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
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
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
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
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
    </div>
  );
}
