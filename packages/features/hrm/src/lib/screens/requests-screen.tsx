'use client';
import { TimeTextInput } from '../ui/time-text-input';
import {
  correctionPayload,
  type CorrectionSessionRow,
} from '../hrm-correction-sessions';
import { HrmCorrectionSessions } from '../ui/hrm-correction-sessions';

import {
  AlertCircle,
  Check,
  Clock,
  DollarSign,
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
  Trash2,
  X,
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
import { useHrmPermissions } from '../hrm-permissions';
import {
  REQUEST_HISTORY_PAGE_SIZE,
  approverFallbackLabel,
  exportRequestHistory,
  paginate,
} from '../request-history-view';
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

/** Bản nháp đơn do máy chủ trả về khi lưu qua /request-drafts. */
interface RequestDraft {
  id: string;
  employeeId: string;
  kind: string;
  status: 'DRAFT';
  payload: Record<string, unknown>;
  updatedAt: string;
  revision: number;
}

type RequestSubTab = 'catalog' | 'pending' | 'history';
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
  deductBalance?: boolean;
  allowAdvance?: boolean;
  negativeLimit?: number;
}

export interface BusinessTripSurchargeItem {
  id: string;
  name: string;
  amount: number;
}

export const TRIP_REASON_OPTIONS: SearchableSelectOption[] = [
  {
    value: 'Thực hiện công tác thí nghiệm / kiểm định',
    label: 'Thực hiện công tác thí nghiệm / kiểm định',
    description: 'Thí nghiệm thiết bị, kiểm định trạm/nhà máy',
  },
  {
    value: 'Bàn giao, lắp đặt thiết bị / công trình',
    label: 'Bàn giao, lắp đặt thiết bị / công trình',
    description: 'Lắp đặt vật tư, bàn giao đưa vào vận hành',
  },
  {
    value: 'Khảo sát hiện trường / nhà máy / trạm',
    label: 'Khảo sát hiện trường / nhà máy / trạm',
    description: 'Khảo sát mặt bằng, lập phương án thi công',
  },
  {
    value: 'Tham gia nghiệm thu / hoàn thiện hồ sơ nghiệm thu',
    label: 'Tham gia nghiệm thu / hoàn thiện hồ sơ nghiệm thu',
    description: 'Nghiệm thu đóng điện, hoàn thiện hồ sơ 87B/COD',
  },
  {
    value: 'Sửa chữa, khắc phục sự cố kỹ thuật',
    label: 'Sửa chữa, khắc phục sự cố kỹ thuật',
    description: 'Xử lý sự cố đột xuất tại công trình/nhà máy',
  },
  {
    value: 'Theo yêu cầu cấp trên / Ban Giám Đốc',
    label: 'Theo yêu cầu cấp trên / Ban Giám Đốc',
    description: 'Công tác đột xuất hoặc theo chỉ đạo điều hành',
  },
  {
    value: 'Hội thảo, đào tạo & làm việc đối tác',
    label: 'Hội thảo, đào tạo & làm việc đối tác',
    description: 'Họp với chủ đầu tư, tập huấn kỹ thuật',
  },
  {
    value: 'Lý do khác',
    label: 'Lý do khác',
    description: 'Mô tả cụ thể trong nội dung công việc',
  },
];

export const TRIP_VEHICLE_OPTIONS: SearchableSelectOption[] = [
  { value: 'Xe công ty', label: 'Xe công ty (xe công vụ điều động)' },
  { value: 'Xe ngoài', label: 'Xe ngoài (xe khách, taxi, xe hợp đồng)' },
  { value: 'Máy bay', label: 'Máy bay (chuyến bay công tác xa)' },
  { value: 'Phương tiện cá nhân', label: 'Phương tiện cá nhân' },
];

export const TRIP_TYPE_OPTIONS: SearchableSelectOption[] = [
  { value: 'DOMESTIC', label: 'Công tác trong nước (Nội địa)' },
  { value: 'OVERSEAS', label: 'Công tác nước ngoài (Quốc tế)' },
  { value: 'INTERSITE', label: 'Công tác nội bộ liên chi nhánh' },
];

export const SURCHARGE_PRESET_OPTIONS: SearchableSelectOption[] = [
  { value: 'Vé máy bay / Tàu xe', label: 'Vé máy bay / Tàu xe' },
  { value: 'Lưu trú khách sạn', label: 'Lưu trú khách sạn' },
  { value: 'Phụ cấp công tác phí', label: 'Phụ cấp công tác phí (tiền ăn)' },
  { value: 'Chi phí tiếp khách đối tác', label: 'Chi phí tiếp khách đối tác' },
  { value: 'Đi lại tại chỗ / Thuê xe', label: 'Đi lại tại chỗ / Thuê xe' },
  { value: 'Phụ phí xăng dầu / Cầu đường', label: 'Phụ phí xăng dầu / Cầu đường' },
  { value: 'Phụ phí khác', label: 'Phụ phí khác' },
];

/**
 * Quy chuẩn ca Hành chính (HC) hệ thống:
 * - Khung giờ ca làm việc: 07:30 - 17:00 (tổng khoảng thời gian 570 phút)
 * - Nghỉ trưa: 11:30 - 13:00 (90 phút, không tính vào giờ làm việc)
 * - Ca sáng: 07:30 - 11:30 = 240 phút = 4 giờ làm việc = 0.5 ngày công
 * - Ca chiều: 13:00 - 17:00 = 240 phút = 4 giờ làm việc = 0.5 ngày công
 * - Tổng thời gian làm việc chuẩn của 1 ngày (1 ca HC): 480 phút = 8 giờ làm việc = 1.0 ngày công
 */
export const STANDARD_SHIFT_HC = {
  startTime: '07:30',
  endTime: '17:00',
  breakStart: '11:30',
  breakEnd: '13:00',
  startMinutes: 7 * 60 + 30, // 450
  endMinutes: 17 * 60, // 1020
  breakStartMinutes: 11 * 60 + 30, // 690
  breakEndMinutes: 13 * 60, // 780
  workMinutesPerDay: 480, // 8h = 480 phút
};

/**
 * Tính số phút làm việc thực tế trong khoảng [startTimeStr, endTimeStr] của 1 ngày theo ca HC chuẩn
 */
export function calculateWorkingMinutesInShift(
  startTimeStr: string,
  endTimeStr: string,
): number {
  const parseMin = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const s = parseMin(startTimeStr);
  const e = parseMin(endTimeStr);
  if (e <= s) return 0;

  // Giới hạn trong khoảng giờ ca HC (07:30 - 17:00)
  const effStart = Math.max(s, STANDARD_SHIFT_HC.startMinutes);
  const effEnd = Math.min(e, STANDARD_SHIFT_HC.endMinutes);
  if (effEnd <= effStart) return 0;

  // Ca sáng: 07:30 - 11:30
  const morningMinutes = Math.max(
    0,
    Math.min(effEnd, STANDARD_SHIFT_HC.breakStartMinutes) -
    Math.max(effStart, STANDARD_SHIFT_HC.startMinutes),
  );

  // Ca chiều: 13:00 - 17:00
  const afternoonMinutes = Math.max(
    0,
    Math.min(effEnd, STANDARD_SHIFT_HC.endMinutes) -
    Math.max(effStart, STANDARD_SHIFT_HC.breakEndMinutes),
  );

  return morningMinutes + afternoonMinutes;
}

export type LeavePolicyCategory =
  | 'ANNUAL'
  | 'UNPAID'
  | 'COMPENSATORY'
  | 'CUSTOM';

export type DurationStepRule =
  | 'HALF_DAY_STEP'
  | 'PERCENT_SHIFT'
  | 'EXACT_DAYS';

export interface LeaveReasonPolicy {
  category: LeavePolicyCategory;
  name: string;
  isPaid: boolean;
  deductAnnualBalance: boolean; // Có tính trừ vào quỹ phép năm tồn hay không
  stepRule: DurationStepRule; // Bắt buộc bội số 0.5 hay tính chuẩn theo % ca
  badgeLabel: string;
  policyNote: string;
}

function normalizeVnString(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Cơ chế phân giải chính sách lý do nghỉ phép:
 * - Nghỉ phép năm: có tính lương, trừ quỹ phép tồn, bắt buộc bội số 0.5 ngày
 * - Nghỉ không lương: không tính lương, không trừ quỹ phép tồn, bắt buộc bội số 0.5 ngày
 * - Nghỉ bù do làm thêm tăng ca: có tính lương, không trừ quỹ phép năm, tính chuẩn theo % ca
 * - Các lý do tùy chỉnh (tạo thêm trong admin/hệ thống): tự động fallback theo cấu hình
 */
export function resolveLeavePolicy(
  leaveType?: LeaveTypeItem | null,
): LeaveReasonPolicy {
  if (!leaveType) {
    return {
      category: 'ANNUAL',
      name: 'Nghỉ phép năm',
      isPaid: true,
      deductAnnualBalance: true,
      stepRule: 'HALF_DAY_STEP',
      badgeLabel: 'Có tính lương • Trừ quỹ phép',
      policyNote:
        'Bắt buộc ngày nghỉ là bội số của 0.5 ngày (0.5, 1.0, 1.5...)',
    };
  }

  const code = (leaveType.code || '').toUpperCase();
  const normName = normalizeVnString(leaveType.name || '');

  // 1. Nghỉ phép năm (Annual Leave)
  if (code.includes('ANNUAL') || normName.includes('phep nam')) {
    return {
      category: 'ANNUAL',
      name: leaveType.name || 'Nghỉ phép năm',
      isPaid: true,
      deductAnnualBalance: true,
      stepRule: 'HALF_DAY_STEP',
      badgeLabel: 'Có tính lương • Trừ quỹ phép',
      policyNote:
        'Bắt buộc ngày nghỉ là bội số của 0.5 ngày (0.5, 1.0, 1.5...)',
    };
  }

  // 2. Nghỉ không lương (Unpaid Leave)
  if (
    code.includes('UNPAID') ||
    normName.includes('khong luong') ||
    leaveType.paid === false
  ) {
    return {
      category: 'UNPAID',
      name: leaveType.name || 'Nghỉ không lương',
      isPaid: false,
      deductAnnualBalance: false, // Không tính toán lương tồn / không trừ quỹ phép
      stepRule: 'HALF_DAY_STEP',
      badgeLabel: 'Không tính lương • Không trừ quỹ phép',
      policyNote:
        'Bắt buộc ngày nghỉ là bội số của 0.5 ngày (0.5, 1.0, 1.5...)',
    };
  }

  // 3. Nghỉ bù do làm thêm tăng ca (Compensatory Leave)
  if (
    code.includes('COMP') ||
    code.includes('OFF_IN_LIEU') ||
    normName.includes('nghi bu') ||
    normName.includes('tang ca') ||
    normName.includes('lam them')
  ) {
    return {
      category: 'COMPENSATORY',
      name: leaveType.name || 'Nghỉ bù tăng ca',
      isPaid: true,
      deductAnnualBalance: false,
      stepRule: 'PERCENT_SHIFT',
      badgeLabel: 'Có tính lương • Chuẩn % ca',
      policyNote: 'Tính chuẩn theo tỷ lệ phần trăm ca làm việc thực tế',
    };
  }

  // 4. Các lý do tạo thêm từ khu vực Quản trị & Hệ thống (CUSTOM)
  const isPaid = leaveType.paid ?? true;
  const deductAnnual =
    leaveType.deductBalance !== undefined
      ? Boolean(leaveType.deductBalance)
      : isPaid && leaveType.unit === 'DAYS';
  const stepRule: DurationStepRule =
    leaveType.unit === 'HOURS'
      ? 'PERCENT_SHIFT'
      : isPaid && deductAnnual
        ? 'HALF_DAY_STEP'
        : 'PERCENT_SHIFT';

  return {
    category: 'CUSTOM',
    name: leaveType.name,
    isPaid,
    deductAnnualBalance: deductAnnual,
    stepRule,
    badgeLabel: `${isPaid ? 'Có tính lương' : 'Không tính lương'} • ${deductAnnual ? 'Trừ quỹ phép' : 'Không trừ quỹ phép'}`,
    policyNote:
      stepRule === 'HALF_DAY_STEP'
        ? 'Bắt buộc ngày nghỉ là bội số của 0.5 ngày'
        : 'Tính theo phần trăm ca / thời lượng thực tế',
  };
}

/**
 * Kiểm tra tính hợp lệ của số ngày nghỉ theo chính sách của lý do
 */
export function validateLeaveDurationPolicy(
  durationNum: number,
  policy: LeaveReasonPolicy,
): { isValid: boolean; errorMessage?: string } {
  if (durationNum <= 0) {
    return {
      isValid: false,
      errorMessage: 'Thời gian nghỉ phải lớn hơn 0.',
    };
  }

  if (policy.stepRule === 'HALF_DAY_STEP') {
    const remainder = Math.abs(durationNum % 0.5);
    const isMultipleOfHalf =
      remainder < 0.001 || Math.abs(remainder - 0.5) < 0.001;
    if (!isMultipleOfHalf) {
      return {
        isValid: false,
        errorMessage: `Lý do "${policy.name}" bắt buộc số ngày nghỉ phải là bội số của 0.5 ngày (nửa ngày hoặc cả ngày: 0.5, 1.0, 1.5...). Thời lượng hiện tại (${durationNum} ngày) chưa hợp lệ. Vui lòng chọn khung giờ trọn buổi (07:30 - 11:30, 13:00 - 17:00 hoặc 07:30 - 17:00).`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Nhóm hiển thị số dư: Phép năm (gồm phép thâm niên) trừ quỹ phép; Nghỉ không lương
 * và Nghỉ bù gộp một nhóm vì đều không trừ phép năm.
 */
export function leaveDisplayGroup(
  policy: LeaveReasonPolicy,
): 'DEDUCT' | 'NON_DEDUCT' {
  return policy.deductAnnualBalance ? 'DEDUCT' : 'NON_DEDUCT';
}

export type LeaveBalanceStatus = 'OK' | 'ADVANCE' | 'INSUFFICIENT';

/**
 * Số dư dự kiến sau khi nghỉ. `available` = còn lại - đang chờ duyệt (server cũng
 * trừ pending trước khi so). Vượt phần tích luỹ nhưng nằm trong `headroom` (hạn mức
 * ứng phép hoặc hạn mức âm của loại nghỉ) là ADVANCE; vượt cả hạn mức là INSUFFICIENT.
 */
export function projectLeaveBalance(input: {
  available: number;
  duration: number;
  headroom: number;
}): { after: number; status: LeaveBalanceStatus; maxUsable: number } {
  const headroom = Math.max(0, input.headroom);
  const after = Math.round((input.available - input.duration) * 100) / 100;
  const status: LeaveBalanceStatus =
    after >= -0.005
      ? 'OK'
      : after >= -headroom - 0.005
        ? 'ADVANCE'
        : 'INSUFFICIENT';
  return {
    after,
    status,
    maxUsable: Math.round((input.available + headroom) * 100) / 100,
  };
}

/** Phép thâm niên là công thức cộng thêm trong cấu hình định mức phép năm, không phải một loại nghỉ để chọn. */
function isSeniorityLeaveType(t: LeaveTypeItem): boolean {
  const code = (t.code || '').toUpperCase();
  return code.includes('SENIOR') || normalizeVnString(t.name).includes('tham nien');
}

/**
 * Danh sách loại nghỉ cho người dùng chọn: bỏ loại thâm niên và gộp mọi loại không
 * lương (nghỉ ốm, việc riêng...) về một loại duy nhất; lý do cụ thể ghi ở ô "Lý do".
 */
export function selectableLeaveTypesOf(types: LeaveTypeItem[]): LeaveTypeItem[] {
  const out: LeaveTypeItem[] = [];
  let unpaid: LeaveTypeItem | undefined;
  for (const t of types) {
    if (isSeniorityLeaveType(t)) continue;
    if (resolveLeavePolicy(t).category === 'UNPAID') {
      const better =
        !unpaid ||
        ((t.code || '').toUpperCase().includes('UNPAID') &&
          !(unpaid.code || '').toUpperCase().includes('UNPAID'));
      if (better) unpaid = t;
      continue;
    }
    out.push(t);
  }
  if (unpaid) out.push(unpaid);
  return out;
}

export interface LeaveDayPreviewItem {
  date: string;
  kind: 'WORK' | 'OFF' | 'HOLIDAY' | 'NO_SHIFT';
  weight: number;
  shiftMinutes: number;
  startMinutes: number | null;
  endMinutes: number | null;
  breakStartMinutes: number | null;
  breakEndMinutes: number | null;
}

export interface LeaveDayBreakdownItem {
  date: string;
  value: number;
  note: string;
}

const toMinutes = (t: string) => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Tính số ngày nghỉ từ lịch từng ngày do server trả về: bỏ ngày nghỉ tuần/lễ, ca ngắn
 * (thứ Bảy nửa ngày) quy theo trọng số của ca, ngày đầu cắt từ giờ bắt đầu, ngày cuối
 * cắt tới giờ kết thúc; phần ngoài ca không bị tính.
 */
export function computeLeaveFromPreview(
  days: LeaveDayPreviewItem[],
  startTime: string,
  endTime: string,
): { total: number; breakdown: LeaveDayBreakdownItem[]; missingShift: boolean } {
  const breakdown: LeaveDayBreakdownItem[] = [];
  let total = 0;
  let missingShift = false;
  days.forEach((d, i) => {
    if (d.kind === 'OFF' || d.kind === 'HOLIDAY') {
      breakdown.push({
        date: d.date,
        value: 0,
        note: d.kind === 'HOLIDAY' ? 'Ngày lễ, không tính' : 'Nghỉ hằng tuần, không tính',
      });
      return;
    }
    if (d.kind === 'NO_SHIFT' || d.startMinutes == null || d.endMinutes == null) {
      missingShift = true;
      breakdown.push({ date: d.date, value: 0, note: 'Chưa phân ca' });
      return;
    }
    const from = i === 0 ? Math.max(d.startMinutes, toMinutes(startTime)) : d.startMinutes;
    const to = i === days.length - 1 ? Math.min(d.endMinutes, toMinutes(endTime)) : d.endMinutes;
    let minutes = Math.max(0, to - from);
    if (d.breakStartMinutes != null && d.breakEndMinutes != null) {
      minutes -= Math.max(
        0,
        Math.min(to, d.breakEndMinutes) - Math.max(from, d.breakStartMinutes),
      );
    }
    const fraction = d.shiftMinutes > 0 ? Math.min(1, minutes / d.shiftMinutes) : 0;
    const value = Math.round(d.weight * fraction * 1000) / 1000;
    total += value;
    breakdown.push({
      date: d.date,
      value,
      note:
        d.weight < 1 && fraction >= 1
          ? 'Ca ngắn, tính nửa ngày'
          : fraction < 1 && fraction > 0
            ? 'Một phần ca'
            : fraction === 0
              ? 'Ngoài ca làm việc'
              : '',
    });
  });
  return { total: Math.round(total * 1000) / 1000, breakdown, missingShift };
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
  const { can } = useHrmPermissions();
  const canCreateRequest = can('hrm.self.request');
  const [historyPage, setHistoryPage] = useState(1);
  const [activeTab, setActiveTab] = useState<RequestSubTab>('catalog');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] =
    useState<RequestKind>('leave');
  const [selectedTypeTitle, setSelectedTypeTitle] =
    useState('Đơn xin nghỉ phép');

  // Master Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>([]);
  const selectableLeaveTypes = useMemo(
    () => selectableLeaveTypesOf(leaveTypes),
    [leaveTypes],
  );
  const [dayPreview, setDayPreview] = useState<LeaveDayPreviewItem[] | null>(null);
  const [shiftsList, setShiftsList] = useState<ShiftItem[]>([]);
  const [colleaguesList, setColleaguesList] = useState<EmployeeItem[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<
    WorkspaceProjectItem[]
  >([]);

  // State form nhập liệu chung & từng loại đơn
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveStartTime, setLeaveStartTime] = useState('07:30');
  const [leaveEndTime, setLeaveEndTime] = useState('17:00');
  // Người dùng đã tự sửa giờ: không tự điền lại theo ca của nhân viên nữa.
  const leaveTimesTouched = useRef(false);
  const [leaveDuration, setLeaveDuration] = useState('1.0');
  const [leaveFile, setLeaveFile] = useState<File | null>(null);
  const [leaveAttachmentId, setLeaveAttachmentId] = useState('');

  // Chính sách xử lý & kiểm định tính hợp lệ của lý do nghỉ phép
  const selectedLeaveType = useMemo(
    () =>
      leaveTypes.find((t) => t.id === selectedLeaveTypeId) ||
      selectableLeaveTypes[0] ||
      null,
    [leaveTypes, selectableLeaveTypes, selectedLeaveTypeId],
  );
  const currentLeavePolicy = useMemo(
    () => resolveLeavePolicy(selectedLeaveType),
    [selectedLeaveType],
  );
  const leaveValidation = useMemo(
    () =>
      validateLeaveDurationPolicy(
        parseFloat(leaveDuration) || 0,
        currentLeavePolicy,
      ),
    [leaveDuration, currentLeavePolicy],
  );

  // OT state
  const [otType, setOtType] = useState<
    'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT'
  >('WEEKDAY');
  const [otReasonCategory, setOtReasonCategory] = useState<
    'Tăng ca' | 'Thí nghiệm'
  >('Tăng ca');
  const [otShiftId, setOtShiftId] = useState('');
  const [isNegativeLeave, setIsNegativeLeave] = useState(false);
  const [isNightOt, setIsNightOt] = useState(false);
  const [startTime, setStartTime] = useState('17:30');
  const [endTime, setEndTime] = useState('20:30');


  // Business trip state
  const [tripType, setTripType] = useState<
    'DOMESTIC' | 'OVERSEAS' | 'INTERSITE'
  >('DOMESTIC');
  const [destination, setDestination] = useState('');
  const [tripAddress, setTripAddress] = useState('');
  const [tripDepartment, setTripDepartment] = useState('');
  const [tripReasonCategory, setTripReasonCategory] = useState(
    'Thực hiện công tác thí nghiệm / kiểm định',
  );
  const [tripVehicle, setTripVehicle] = useState('Xe công ty');
  const [tripRequiredFinger, setTripRequiredFinger] = useState(false);
  const [tripStartTime, setTripStartTime] = useState('08:00');
  const [tripEndTime, setTripEndTime] = useState('17:30');
  const [tripSurcharges, setTripSurcharges] = useState<
    BusinessTripSurchargeItem[]
  >([]);
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [allowOt, setAllowOt] = useState(false);

  // Tính toán tổng phụ phí công tác
  const tripTotalSurcharges = useMemo(() => {
    return tripSurcharges.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0,
    );
  }, [tripSurcharges]);

  const handleAddSurcharge = () => {
    setTripSurcharges((prev) => [
      ...prev,
      {
        id: `sur-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: 'Vé máy bay / Tàu xe',
        amount: 0,
      },
    ]);
  };

  const handleUpdateSurcharge = (
    id: string,
    field: 'name' | 'amount',
    val: string | number,
  ) => {
    setTripSurcharges((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
            ...item,
            [field]: field === 'amount' ? Math.max(0, Number(val) || 0) : val,
          }
          : item,
      ),
    );
  };

  const handleRemoveSurcharge = (id: string) => {
    setTripSurcharges((prev) => prev.filter((item) => item.id !== id));
  };

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
  const [formErrorMessage, setFormErrorMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const notifyFormError = (title: string, description: string) => {
    toast.error({ title, description });
    setFormErrorMessage({ title, description });
  };

  // Dynamic Procedure Attributes from PE Node S
  const [dynamicAttributes, setDynamicAttributes] = useState<
    ProcedureAttributeItem[]
  >([]);
  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(
    {},
  );
  const [loadingAttributes, setLoadingAttributes] = useState(false);
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
      {
        remaining: string;
        entitlement: string;
        advanceAllowed?: boolean;
        advanceHeadroom?: string;
        seniorityDays?: string;
      }
    >
  >({});
  const leaveBalance = leaveBalances[selectedLeaveTypeId] || {
    remaining: '----',
    entitlement: '----',
    advanceAllowed: false,
  };

  const previewBreakdown = useMemo(
    () =>
      dayPreview && dayPreview.length && dayPreview[0].date === fromDate
        ? computeLeaveFromPreview(dayPreview, leaveStartTime, leaveEndTime)
        : null,
    [dayPreview, fromDate, leaveStartTime, leaveEndTime],
  );
  const leaveDisplay = useMemo(() => {
    const available = parseFloat(leaveBalance.remaining);
    if (Number.isNaN(available)) return null;
    const headroom = selectedLeaveType?.allowAdvance
      ? parseFloat(leaveBalance.advanceHeadroom ?? '0') || 0
      : (selectedLeaveType?.negativeLimit ?? 0);
    return {
      available,
      headroom,
      seniority: parseFloat(leaveBalance.seniorityDays ?? '0') || 0,
      ...projectLeaveBalance({
        available,
        duration: parseFloat(leaveDuration) || 0,
        headroom,
      }),
    };
  }, [leaveBalance, leaveDuration, selectedLeaveType]);

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
      title: 'Đơn đổi ca',
      desc: 'Hoán đổi ca với đồng nghiệp (cần đồng nghiệp xác nhận) hoặc đề nghị chuyển sang ca làm việc khác trong khoảng ngày chọn.',
      tag: 'Hoán đổi / Chuyển ca',
      tagColor: 'blue',
      balanceLabel: 'Đồng nghiệp xác nhận trước khi trình duyệt',
      iconBg: 'bg-indigo-100 text-indigo-800',
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
      title: 'Đơn tạm ứng lương',
      desc: 'Đề nghị tạm ứng một phần lương, hoàn trả bằng khấu trừ vào các kỳ lương tiếp theo.',
      tag: 'Khấu trừ vào lương',
      tagColor: 'amber',
      balanceLabel: 'Chia tối đa 4 kỳ khấu trừ',
      iconBg: 'bg-emerald-100 text-emerald-800',
    },
    {
      id: 'profile_correction' as RequestKind,
      title: 'Đơn đính chính hồ sơ',
      desc: 'Đề nghị đính chính họ tên, ngày sinh, CCCD, mã số thuế, BHXH. Nhân sự đối chiếu minh chứng rồi mới cập nhật vào hồ sơ.',
      tag: 'Cần minh chứng',
      tagColor: 'rose',
      balanceLabel: 'Hồ sơ chỉ đổi sau khi được duyệt',
      iconBg: 'bg-slate-100 text-slate-700',
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
                  entitlement?: number;
                  advanceAllowed?: boolean;
                  advanceHeadroom?: number;
                  seniorityDays?: number;
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
                      b.projectedEntitlement != null
                        ? String(b.projectedEntitlement)
                        : String(b.entitlement ?? '----'),
                    advanceAllowed: Boolean(b.advanceAllowed),
                    advanceHeadroom: String(b.advanceHeadroom ?? 0),
                    seniorityDays: String(b.seniorityDays ?? 0),
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.workDate ? new Date(item.workDate).toLocaleDateString('vi-VN') : '----'} (${item.startTime || '----'} - ${item.endTime || '----'})`,
            duration: `${plannedHrs} giờ (${item.otRateMultiplier || 1.5}x)`,
            reason: item.reason || '----',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: `${item.daysCount || 1} ngày`,
            reason: item.reason || '----',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration:
              item.changeType === 'SWAP' ? 'Hoán đổi ca trực' : 'Thay đổi ca',
            reason: item.reason || '----',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? new Date(item.requestDate).toLocaleDateString('vi-VN')
              : '----',
            duration: `Vào: ${inTime} | Ra: ${outTime}`,
            reason: item.reason || '----',
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
              ? new Date(item.createdAt).toLocaleDateString('vi-VN')
              : '----',
            rawCreatedAt: item.createdAt,
            createdTimeMs,
            effectiveDate: item.requestDate
              ? new Date(item.requestDate).toLocaleDateString('vi-VN')
              : '----',
            duration: `${Number(item.requestedAmount || 0).toLocaleString('vi-VN')} đ (${item.numberOfInstallments || 1} kỳ)`,
            reason: item.reason || '----',
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

  // Đổi bộ lọc thì quay về trang đầu để không đứng ở trang không còn dữ liệu.
  useEffect(() => {
    setHistoryPage(1);
  }, [
    waitAssignee,
    waitStep,
    searchQuery,
    filterKind,
    filterStatus,
    historyFromDate,
    historyToDate,
  ]);
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
      description: `Đã tải về ${filteredHistory.length} dòng (CSV, mã hóa UTF-8).`,
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
    setFormErrorMessage(null);
    setIsNegativeLeave(false);
    setIsNightOt(false);
    setProjectId('');
    setProjectName('');
    setWorkItemId('');
    setDynamicValues({});
    touchedAttributeCodes.current = new Set();
    setDynamicAttributes([]);

    setLeaveFile(null);
    setLeaveAttachmentId('');
    setLeaveStartTime('07:30');
    setLeaveEndTime('17:00');
    leaveTimesTouched.current = false;
    setStartTime('17:30');
    setEndTime('20:30');
    setOtType('WEEKDAY');
    setOtReasonCategory('Tăng ca');
    setOtShiftId(shiftsList[0]?.id || 'Ca_HC');
    setTripStartTime('08:00');
    setTripEndTime('17:30');
    setTripType('DOMESTIC');
    setDestination('');
    setTripAddress('');
    setTripDepartment(rawProfile.department || profile.department || '');
    setTripReasonCategory('Thực hiện công tác thí nghiệm / kiểm định');
    setTripVehicle('Xe công ty');
    setTripRequiredFinger(false);
    setTripSurcharges([]);
    setAllowOt(false);
    setChangeType('SWAP');
    setSwapWithEmployeeId('');
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
        setDynamicAttributes(state.attributes);
      } else {
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

  // Lịch từng ngày (nghỉ tuần, lễ, ca thực tế) của nhân viên cho khoảng nghỉ đang chọn.
  useEffect(() => {
    if (selectedCatalogId !== 'leave' || !fromDate || !profile.id) {
      setDayPreview(null);
      return;
    }
    const end = toDate || fromDate;
    if (end < fromDate) {
      setDayPreview(null);
      return;
    }
    let active = true;
    hrmFetch<{ data: LeaveDayPreviewItem[] }>(
      `/employees/${profile.id}/leave-day-preview?from=${fromDate}&to=${end}`,
    )
      .then((res) => {
        if (active) setDayPreview(res.data);
      })
      .catch(() => {
        if (active) setDayPreview(null);
      });
    return () => {
      active = false;
    };
  }, [selectedCatalogId, fromDate, toDate, profile.id]);

  // Mặc định 07:30 - 17:00 chỉ đúng với ca hành chính: điền giờ theo ca thực tế của nhân viên
  // (ngày làm việc đầu và cuối) để chọn nghỉ cả ngày không bị tính thiếu.
  useEffect(() => {
    if (!dayPreview || leaveTimesTouched.current) return;
    const work = dayPreview.filter(
      (d) => d.kind === 'WORK' && d.startMinutes != null && d.endMinutes != null,
    );
    if (!work.length) return;
    const first = work[0];
    const last = work[work.length - 1];
    // Ca qua đêm (giờ kết thúc nhỏ hơn giờ bắt đầu) không biểu diễn được trong ô giờ trong ngày.
    if ((first.endMinutes as number) <= (first.startMinutes as number)) return;
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    setLeaveStartTime(fmt(first.startMinutes as number));
    setLeaveEndTime(fmt(last.endMinutes as number));
  }, [dayPreview]);

  // Tự động tính toán số ngày nghỉ phép từ ngày + giờ theo ca HC (07:30 - 17:00, nghỉ trưa 11:30 - 13:00)
  useEffect(() => {
    if (selectedCatalogId !== 'leave') return;
    if (!fromDate) {
      setLeaveDuration('1.0');
      return;
    }
    const end = toDate || fromDate;
    // Tách theo giờ địa phương: `new Date('YYYY-MM-DD')` là nửa đêm UTC nên getDay() lệch ngày ở múi giờ âm.
    const parseLocalDate = (value: string) => {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const d1 = parseLocalDate(fromDate);
    const d2 = parseLocalDate(end);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return;

    if (d2.getTime() < d1.getTime()) {
      // Khoảng ngày ngược: không giữ lại số ngày của lần chọn trước.
      setLeaveDuration('0.0');
      return;
    }

    // Có lịch thật của nhân viên từ server: dùng, không đoán theo ca HC cứng.
    if (dayPreview && dayPreview.length && dayPreview[0].date === fromDate) {
      const { total } = computeLeaveFromPreview(
        dayPreview,
        leaveStartTime,
        leaveEndTime,
      );
      const decimals = currentLeavePolicy.stepRule === 'PERCENT_SHIFT' ? 1000 : 100;
      const rounded = Math.round(total * decimals) / decimals;
      setLeaveDuration(Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded));
      return;
    }

    if (d1.getTime() === d2.getTime()) {
      if (d1.getDay() === 0) {
        // Chủ nhật không phải ngày làm việc (đồng bộ với nhánh nhiều ngày).
        setLeaveDuration('0.0');
        return;
      }
      // Cùng ngày: tính theo số phút làm việc thực tế trong ca HC (480 phút = 1.0 ngày công)
      const workingMinutes = calculateWorkingMinutesInShift(
        leaveStartTime,
        leaveEndTime,
      );
      if (workingMinutes <= 0) {
        setLeaveDuration('0.0');
        return;
      }

      if (currentLeavePolicy.stepRule === 'PERCENT_SHIFT') {
        // Nghỉ bù tăng ca: tính chuẩn theo phần trăm ca (ví dụ 60p = 0.125, 120p = 0.25, 180p = 0.375, 240p = 0.5...)
        const ratio =
          Math.round(
            (workingMinutes / STANDARD_SHIFT_HC.workMinutesPerDay) * 1000,
          ) / 1000;
        setLeaveDuration(String(ratio));
      } else {
        // Phép năm / Nghỉ không lương: 240p = 0.5 ngày, 480p = 1.0 ngày
        if (workingMinutes === 240) {
          setLeaveDuration('0.5');
        } else if (workingMinutes === 480) {
          setLeaveDuration('1.0');
        } else {
          const ratio =
            Math.round(
              (workingMinutes / STANDARD_SHIFT_HC.workMinutesPerDay) * 100,
            ) / 100;
          setLeaveDuration(ratio.toFixed(2).replace(/\.00$/, '.0'));
        }
      }
    } else if (d2.getTime() > d1.getTime()) {
      // Nhiều ngày: duyệt từng ngày làm việc (bỏ qua Chủ nhật)
      let totalMinutes = 0;
      const cur = new Date(d1);
      while (cur <= d2) {
        const dayOfWeek = cur.getDay(); // 0: Chủ nhật
        if (dayOfWeek !== 0) {
          const isFirstDay = cur.getTime() === d1.getTime();
          const isLastDay = cur.getTime() === d2.getTime();

          if (isFirstDay) {
            totalMinutes += calculateWorkingMinutesInShift(
              leaveStartTime,
              STANDARD_SHIFT_HC.endTime,
            );
          } else if (isLastDay) {
            totalMinutes += calculateWorkingMinutesInShift(
              STANDARD_SHIFT_HC.startTime,
              leaveEndTime,
            );
          } else {
            totalMinutes += STANDARD_SHIFT_HC.workMinutesPerDay;
          }
        }
        cur.setDate(cur.getDate() + 1);
      }

      if (currentLeavePolicy.stepRule === 'PERCENT_SHIFT') {
        const ratio =
          Math.round(
            (totalMinutes / STANDARD_SHIFT_HC.workMinutesPerDay) * 1000,
          ) / 1000;
        setLeaveDuration(String(ratio));
      } else {
        const ratio =
          Math.round(
            (totalMinutes / STANDARD_SHIFT_HC.workMinutesPerDay) * 100,
          ) / 100;
        setLeaveDuration(ratio.toFixed(2).replace(/\.00$/, '.0'));
      }
    }
  }, [
    selectedCatalogId,
    fromDate,
    toDate,
    leaveStartTime,
    leaveEndTime,
    currentLeavePolicy.stepRule,
    dayPreview,
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



  // Submit đơn theo đúng bảng nghiệp vụ riêng của từng domain (Mục 6 trong PLAN)
  const handleSubmitRequest = async (saveAsDraft = false) => {
    if (!saveAsDraft && !reason.trim()) {
      toast.error({
        title: 'Thiếu thông tin',
        description: 'Vui lòng nhập mô tả chi tiết / lý do khởi tạo yêu cầu.',
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
        const typeId = selectedLeaveTypeId || (selectableLeaveTypes[0]?.id ?? '');
        if (!typeId) {
          notifyFormError(
            'Lỗi',
            'Chưa có loại nghỉ phép hợp lệ được cấu hình trên hệ thống.',
          );
          return;
        }

        // Bắt buộc kiểm tra tính hợp lệ của số ngày nghỉ theo chính sách lý do
        if (!saveAsDraft && !leaveValidation.isValid) {
          notifyFormError(
            'Thời gian nghỉ không hợp lệ',
            leaveValidation.errorMessage ||
            'Số ngày nghỉ chưa đáp ứng quy định chính sách của lý do đã chọn.',
          );
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
            startTime: leaveStartTime,
            endTime: leaveEndTime,
            projectId: projectId || undefined,
            duration: parseFloat(leaveDuration) || 1.0,
            isNegativeLeave: false,
            reason: reason.trim() || undefined,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'ot') {
        if (!fromDate) {
          notifyFormError('Thiếu thông tin', 'Vui lòng chọn ngày làm thêm.');
          return;
        }

        const [sh, sm] = (startTime || '00:00').split(':').map(Number);
        const [eh, em] = (endTime || '00:00').split(':').map(Number);
        const plannedMin = (eh * 60 + em - sh * 60 - sm + 1440) % 1440;

        if (!saveAsDraft && plannedMin <= 0) {
          notifyFormError(
            'Thời gian không hợp lệ',
            'Giờ kết thúc làm thêm phải sau giờ bắt đầu (tổng số phút phải lớn hơn 0).',
          );
          return;
        }

        if (!saveAsDraft && !reason.trim()) {
          notifyFormError(
            'Thiếu mô tả lý do',
            'Mô tả chi tiết lý do làm thêm là bắt buộc. Vui lòng nhập nội dung công việc làm thêm.',
          );
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

        const selectedShift = shiftsList.find((s) => s.id === otShiftId);
        const formattedReason = `[${otReasonCategory}] ${reason.trim()}`;

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
            reason: formattedReason,
            attributes: {
              ...dynamicValues,
              otReasonCategory,
              shiftId: otShiftId || 'Ca_HC',
              shiftName: selectedShift
                ? selectedShift.name
                : 'Ca Hành chính (07:30 - 17:00)',
              projectId: projectId || undefined,
              projectName: projectName || undefined,
              attachmentFileId: attachmentFileId || undefined,
            },
          }),
        });
      } else if (selectedCatalogId === 'business_trip') {
        if (!fromDate || !toDate) {
          notifyFormError(
            'Thiếu thời gian công tác',
            'Vui lòng chọn ngày bắt đầu và kết thúc công tác.',
          );
          return;
        }

        const d1 = new Date(fromDate).getTime();
        const d2 = new Date(toDate).getTime();
        if (d2 < d1) {
          notifyFormError(
            'Thời gian không hợp lệ',
            'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
          );
          return;
        }

        const days = Math.max(
          1,
          Math.round((d2 - d1) / (1000 * 3600 * 24)) + 1,
        );

        if (!saveAsDraft && !destination.trim()) {
          notifyFormError(
            'Thiếu địa điểm công tác',
            'Địa điểm công tác là bắt buộc. Vui lòng nhập địa điểm/đơn vị đến công tác.',
          );
          return;
        }

        if (!saveAsDraft && !reason.trim()) {
          notifyFormError(
            'Thiếu nội dung công việc',
            'Nội dung công việc là bắt buộc. Vui lòng mô tả chi tiết công việc thực hiện trong chuyến công tác.',
          );
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

        const formattedReason = `[${tripReasonCategory}] ${reason.trim()}`;

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
            destination:
              destination.trim() || 'Công tác theo kế hoạch phòng ban',
            projectId: projectId || null,
            projectName: projectName || null,
            fromDate,
            toDate,
            daysCount: days,
            allowOt,
            reason: formattedReason,
            attributes: {
              ...dynamicValues,
              tripStartTime,
              tripEndTime,
              destinationAddress: tripAddress.trim() || undefined,
              workDepartment: tripDepartment.trim() || undefined,
              tripReasonCategory,
              vehicle: tripVehicle,
              requiredFinger: tripRequiredFinger,
              surcharges: tripSurcharges.filter(
                (s) => s.name.trim() || s.amount > 0,
              ),
              totalSurcharges: tripTotalSurcharges,
              attachmentFileId: attachmentFileId || undefined,
            },
          }),
        });
      } else if (selectedCatalogId === 'shift_change') {
        if (!currentShiftId || !requestedShiftId) {
          notifyFormError(
            'Thiếu thông tin ca',
            'Vui lòng chọn ca hiện tại và ca muốn đổi.',
          );
          return;
        }
        if (currentShiftId === requestedShiftId) {
          notifyFormError(
            'Ca không thay đổi',
            'Ca đề xuất phải khác ca làm việc hiện tại.',
          );
          return;
        }
        if (changeType === 'SWAP' && !swapWithEmployeeId) {
          notifyFormError(
            'Thiếu đồng nghiệp hoán đổi',
            'Vui lòng chọn đồng nghiệp để hoán đổi ca.',
          );
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
          notifyFormError(
            'Số tiền không hợp lệ',
            'Vui lòng nhập số tiền tạm ứng lớn hơn 0.',
          );
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
        setIsCreateModalOpen(false);
        setReason('');
        toast.success({
          title: saveAsDraft ? 'Đã lưu bản nháp' : 'Đã gửi đơn',
          description: saveAsDraft
            ? 'Nháp chưa phát sinh hiệu lực nghiệp vụ.'
            : 'Đơn đã được ghi nhận; theo dõi trạng thái trong danh sách.',
        });
        await loadData();
        setActiveTab('pending');
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
        notifyFormError(
          unavailable
            ? 'Procedure Engine không khả dụng'
            : 'Tạo đơn thất bại',
          errMsg,
        );
      }
    } catch (err) {
      console.error('Lỗi khi gửi đơn yêu cầu:', err);
      notifyFormError(
        'Lỗi kết nối',
        err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ.',
      );
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
    // Giữ loại đang được chọn (đơn nháp cũ) dù đã bị gộp/ẩn.
    const shown = selectableLeaveTypes.some((t) => t.id === selectedLeaveTypeId)
      ? selectableLeaveTypes
      : [
        ...selectableLeaveTypes,
        ...leaveTypes.filter((t) => t.id === selectedLeaveTypeId),
      ];
    return shown.map((t) => ({
      value: t.id,
      label: t.name,
      badge: t.code,
      description: t.paid ? 'Có hưởng lương' : 'Không hưởng lương',
    }));
  }, [leaveTypes, selectableLeaveTypes, selectedLeaveTypeId]);

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
              Đơn từ của tôi
            </h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
              {requestCatalog.length} loại đơn
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Tạo đơn và theo dõi tiến độ phê duyệt các đơn do chính bạn gửi.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-medium gap-1.5 h-9 border-slate-200 hover:bg-slate-50"
            onClick={handleExportHistory}
            disabled={loading || filteredHistory.length === 0}
            title="Xuất các dòng đang hiển thị trong Lịch sử đơn từ ra file CSV"
          >
            <Download className="size-3.5" />
            <span>Xuất lịch sử đơn</span>
          </Button>
          <Button
            permission="hrm.self.request"
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
            onClick={() => setActiveTab('catalog')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${activeTab === 'catalog'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <FilePlus className="size-4" />
            <span>Tạo đơn mới</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
              {requestCatalog.length} loại đơn
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${activeTab === 'pending'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <Clock className="size-4" />
            <span>Đơn đang chờ duyệt</span>
            {totalPendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {totalPendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${activeTab === 'history'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <History className="size-4" />
            <span>Lịch sử đơn từ</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
              {requestsList.length}
            </span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: REQUEST CATALOG (7 loại đơn) */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          {!canCreateRequest && (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
            >
              Tài khoản của bạn chưa được cấp quyền tạo đơn. Bạn vẫn xem được
              lịch sử đơn của mình.
            </div>
          )}
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
                      className={`text-[10px] font-semibold ${cat.tagColor === 'emerald'
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
                  permission="hrm.self.request"
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
                    historySlice.items.map((req) => (
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
                Hiển thị{' '}
                <strong>
                  {historySlice.from}-{historySlice.to}
                </strong>{' '}
                / <strong>{historySlice.total}</strong> đơn từ
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={historySlice.page <= 1}
                  onClick={() => setHistoryPage(historySlice.page - 1)}
                >
                  Trước
                </Button>
                <span className="font-semibold text-slate-700">
                  {historySlice.page} / {historySlice.pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={historySlice.page >= historySlice.pageCount}
                  onClick={() => setHistoryPage(historySlice.page + 1)}
                >
                  Sau
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
                {selectedTypeTitle}
              </h3>
            </div>

          </div>

          {/* BANNER THÔNG BÁO LỖI NỔI BẬT NGAY TRÊN ĐẦU POPUP FORM */}
          {formErrorMessage && (
            <div className="mx-6 mt-4 p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-3 text-xs text-red-950 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
              <AlertCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <strong className="font-bold text-sm text-red-900 block">
                  {formErrorMessage.title}
                </strong>
                <p className="text-xs text-red-700 leading-relaxed font-medium">
                  {formErrorMessage.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormErrorMessage(null)}
                className="text-red-400 hover:text-red-800 p-1 rounded-md cursor-pointer transition-colors"
                title="Đóng thông báo"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

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
                    Lý do *
                  </label>
                  <SearchableSelect
                    options={leaveTypeOptions}
                    value={selectedLeaveTypeId}
                    onChange={(val) => setSelectedLeaveTypeId(val)}
                    placeholder="Chọn lý do xin nghỉ..."
                    clearable={false}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Từ giờ *
                    </label>
                    <TimeTextInput
                      value={leaveStartTime}
                      onChange={(v: string) => {
                        leaveTimesTouched.current = true;
                        setLeaveStartTime(v);
                      }}
                      className="text-xs font-mono h-9"
                    />
                  </div>
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
                      Đến giờ *
                    </label>
                    <TimeTextInput
                      value={leaveEndTime}
                      onChange={(v: string) => {
                        leaveTimesTouched.current = true;
                        setLeaveEndTime(v);
                      }}
                      className="text-xs font-mono h-9"
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

                {/* Kết quả tính toán tự động số ngày nghỉ & số dư dự kiến */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="space-y-0.5">
                      <span className="text-[11px] text-slate-500 font-medium block">
                        Số ngày nghỉ tính toán:
                      </span>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-[#021E73] font-mono">
                          {leaveDuration} ngày
                        </span>
                        {currentLeavePolicy.stepRule === 'PERCENT_SHIFT' && (
                          <span className="text-[11px] text-emerald-700 font-medium font-mono">
                            ({(parseFloat(leaveDuration) * 100).toFixed(1)}% ca
                            • {(parseFloat(leaveDuration) * 8).toFixed(1)}h)
                          </span>
                        )}
                        {currentLeavePolicy.stepRule === 'HALF_DAY_STEP' && (
                          <span className="text-[11px] text-slate-500">
                            {parseFloat(leaveDuration) === 0.5
                              ? '(Nửa ngày ca sáng hoặc chiều)'
                              : parseFloat(leaveDuration) === 1.0
                                ? '(Trọn 1 ngày công)'
                                : parseFloat(leaveDuration) % 0.5 === 0
                                  ? `(${parseFloat(leaveDuration)} ngày)`
                                  : '(Không tròn 0.5 ngày)'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-0.5 text-right">
                      {leaveDisplayGroup(currentLeavePolicy) === 'DEDUCT' ? (
                        <>
                          <span className="text-[11px] text-slate-500 font-medium block">
                            Phép dư dự kiến:
                          </span>
                          {leaveDisplay ? (
                            <>
                              <span
                                className={`text-sm font-bold font-mono ${leaveDisplay.status === 'OK' ? 'text-emerald-700' : leaveDisplay.status === 'ADVANCE' ? 'text-amber-700' : 'text-rose-600'}`}
                              >
                                {leaveDisplay.after.toFixed(2)} ngày
                              </span>
                              <span className="text-[10px] text-slate-500 block leading-tight">
                                Hiện còn {leaveDisplay.available.toFixed(2)}
                                {leaveDisplay.seniority > 0
                                  ? ` (gồm ${leaveDisplay.seniority} ngày thâm niên)`
                                  : ''}
                                {leaveDisplay.headroom > 0
                                  ? ` • Có thể ứng ${leaveDisplay.headroom.toFixed(2)} • Có thể nghỉ tối đa ${leaveDisplay.maxUsable.toFixed(2)}`
                                  : ''}
                              </span>
                              {leaveDisplay.status === 'ADVANCE' && (
                                <span className="text-[10px] text-amber-700 font-semibold block">
                                  Ứng {Math.abs(leaveDisplay.after).toFixed(2)} ngày phép
                                </span>
                              )}
                              {leaveDisplay.status === 'INSUFFICIENT' && (
                                <span className="text-[10px] text-rose-600 font-semibold block">
                                  Vượt hạn mức được nghỉ
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm font-bold font-mono text-slate-500">
                              ----
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] text-slate-500 font-medium block">
                            {currentLeavePolicy.category === 'COMPENSATORY'
                              ? 'Quỹ nghỉ bù còn lại:'
                              : 'Quỹ phép năm:'}
                          </span>
                          <span className="text-xs font-semibold text-slate-600 block">
                            Không trừ phép năm
                            {currentLeavePolicy.isPaid
                              ? ' • Có tính lương'
                              : ' • Không tính lương'}
                          </span>
                          {leaveDisplay &&
                            currentLeavePolicy.category === 'COMPENSATORY' && (
                              <span className="text-[10px] text-slate-500 block leading-tight">
                                Còn {leaveDisplay.available.toFixed(2)} • Sau khi nghỉ{' '}
                                {leaveDisplay.after.toFixed(2)} ngày
                              </span>
                            )}
                        </>
                      )}
                    </div>
                  </div>

                  {previewBreakdown && previewBreakdown.breakdown.length > 1 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600 space-y-1">
                      <strong className="text-slate-700 font-semibold block">
                        Chi tiết từng ngày
                      </strong>
                      {previewBreakdown.breakdown.map((item) => (
                        <div
                          key={item.date}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="font-mono">
                            {new Date(`${item.date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                          </span>
                          <span className="text-slate-500 flex-1 text-right">
                            {item.note}
                          </span>
                          <span className="font-mono font-semibold w-12 text-right">
                            {item.value}
                          </span>
                        </div>
                      ))}
                      {previewBreakdown.missingShift && (
                        <p className="text-amber-700">
                          Có ngày chưa phân ca; cần HR phân ca trước khi gửi đơn.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cảnh báo lỗi nếu không thoả mãn điều kiện chính sách */}
                  {!leaveValidation.isValid && (
                    <div className="p-3 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
                      <AlertCircle className="size-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <strong className="font-semibold block text-rose-900">
                          Thời gian nghỉ chưa thỏa mãn quy định
                        </strong>
                        <p className="text-[11px] leading-relaxed">
                          {leaveValidation.errorMessage}
                        </p>
                      </div>
                    </div>
                  )}
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

                {/* Gán liên quan dự án Workspace (không bắt buộc) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800 block">
                      Dự án liên quan (Workspace)
                    </label>
                    {projectId && (
                      <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono font-medium">
                        Mã:{' '}
                        {workspaceProjects.find((p) => p.id === projectId)?.code ||
                          projectId}
                      </span>
                    )}
                  </div>
                  <SearchableSelect
                    options={projectOptions}
                    value={projectId}
                    onChange={(val) => {
                      setProjectId(val);
                      const prj = workspaceProjects.find((p) => p.id === val);
                      setProjectName(prj ? prj.name : '');
                    }}
                    placeholder="-- Chọn dự án liên quan nếu có (không bắt buộc) --"
                    clearable={true}
                  />
                </div>

                <label className="block space-y-1 font-semibold">
                  Tệp đính kèm
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


                {/* Hàng 1: Ngày làm thêm + Ca làm việc */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Ngày làm thêm (OT) *
                    </label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>

                {/* Hàng 2: Từ giờ + Đến giờ */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Từ giờ *
                    </label>
                    <TimeTextInput
                      value={startTime}
                      onChange={(v: string) => setStartTime(v)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Đến giờ *
                    </label>
                    <TimeTextInput
                      value={endTime}
                      onChange={(v: string) => setEndTime(v)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>



                {/* Hàng 4: Lý do (Tăng ca, Thí nghiệm) + Dự án liên quan (Workspace) */}


                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Dự án liên quan (Workspace)
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
                      setProjectName(prj ? prj.name : '');
                    }}
                    placeholder="Chọn dự án liên quan nếu có (không bắt buộc)..."
                    clearable={true}
                  />
                </div>

                {/* Phụ trội ca đêm Checkbox */}


                {/* Đính kèm chứng từ / file minh chứng */}
                <div className="space-y-1 pt-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Tệp đính kèm
                  </label>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      setLeaveFile(e.target.files?.[0] || null);
                      setLeaveAttachmentId('');
                    }}
                    className="text-xs"
                  />
                  {leaveAttachmentId && (
                    <div className="flex items-center gap-2 text-xs pt-1">
                      <span className="text-emerald-700 font-medium">
                        Đã lưu chứng từ vào kho.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
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
                        title="Gỡ chứng từ khỏi đơn?"
                        description="Chứng từ sẽ được xoá khỏi đơn làm thêm này."
                        onConfirm={async () => {
                          try {
                            await hrmFetch(`/attachments/${leaveAttachmentId}`, {
                              method: 'DELETE',
                              body: JSON.stringify({
                                reason: 'Người lập gỡ chứng từ khỏi đơn OT',
                              }),
                            });
                            setLeaveAttachmentId('');
                            setLeaveFile(null);
                          } catch (e) {
                            toast.error(
                              e instanceof Error
                                ? e.message
                                : 'Không gỡ được chứng từ',
                            );
                          }
                        }}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-rose-600 hover:text-rose-700"
                        >
                          Gỡ chứng từ
                        </Button>
                      </Popconfirm>
                    </div>
                  )}
                </div>

                {/* Thông tin đối soát 2 vòng */}

              </>
            )}

            {/* FORM 3: CÔNG TÁC (Business Trip) */}
            {selectedCatalogId === 'business_trip' && (
              <>
                {/* Hàng 1: Thời gian Từ ngày/giờ - Đến ngày/giờ */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Từ ngày & giờ *
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-2">
                        <DatePickerInput
                          value={fromDate}
                          onChange={(val) => setFromDate(val)}
                          placeholder="dd/mm/yyyy"
                        />
                      </div>
                      <div>
                        <TimeTextInput
                          value={tripStartTime}
                          onChange={(v: string) => setTripStartTime(v)}
                          className="text-xs h-9 px-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Đến ngày & giờ *
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-2">
                        <DatePickerInput
                          value={toDate}
                          onChange={(val) => setToDate(val)}
                          placeholder="dd/mm/yyyy"
                        />
                      </div>
                      <div>
                        <TimeTextInput
                          value={tripEndTime}
                          onChange={(v: string) => setTripEndTime(v)}
                          className="text-xs h-9 px-2"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hàng 2: Hình thức công tác & Phòng ban */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Hình thức công tác *
                    </label>
                    <SearchableSelect
                      options={TRIP_TYPE_OPTIONS}
                      value={tripType}
                      onChange={(val) => setTripType(val as any)}
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Phòng ban công tác / cử đi
                    </label>
                    <Input
                      value={tripDepartment}
                      onChange={(e) => setTripDepartment(e.target.value)}
                      placeholder="VD: Phòng Kỹ thuật, Ban Quản lý Dự án..."
                      className="text-xs"
                    />
                  </div>
                </div>

                {/* Hàng 3: Địa điểm công tác * & Địa chỉ chi tiết */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Địa điểm công tác *
                    </label>
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="VD: Trạm biến áp 500kV Phố Nối, NM Đắc Sin 1..."
                      className="text-xs"
                    />
                  </div>

                </div>

                {/* Hàng 4: Lý do công tác nghiệp vụ & Phương tiện di chuyển */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Lý do công tác *
                    </label>
                    <SearchableSelect
                      options={TRIP_REASON_OPTIONS}
                      value={tripReasonCategory}
                      onChange={(val) => setTripReasonCategory(val)}
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Phương tiện di chuyển
                    </label>
                    <SearchableSelect
                      options={TRIP_VEHICLE_OPTIONS}
                      value={tripVehicle}
                      onChange={(val) => setTripVehicle(val)}
                      clearable={false}
                    />
                  </div>
                </div>

                {/* Các thiết lập tuỳ chọn: Cho phép OT & Chấm công GPS */}


                {/* KHỐI 4: DỰ TRÙ KINH PHÍ & PHỤ PHÍ CÔNG TÁC (Surcharges Dynamic Grid) */}
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="size-4 text-emerald-600" />
                      <span className="text-xs font-bold text-slate-800">
                        Dự trù kinh phí & Phụ phí công tác
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddSurcharge}
                      className="h-7 text-xs gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                    >
                      <Plus className="size-3" />
                      <span>Thêm phụ phí</span>
                    </Button>
                  </div>

                  {tripSurcharges.length === 0 ? (
                    <div className="text-center py-2.5 text-xs text-slate-400 bg-white rounded-lg border border-dashed border-slate-200">
                      Chưa có phụ phí dự trù. Bấm &quot;Thêm phụ phí&quot; để
                      khai báo vé xe, khách sạn, tiền ăn...
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tripSurcharges.map((sur) => (
                        <div
                          key={sur.id}
                          className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200 shadow-2xs"
                        >
                          <div className="flex-1">
                            <SearchableSelect
                              options={SURCHARGE_PRESET_OPTIONS}
                              value={sur.name}
                              onChange={(val) =>
                                handleUpdateSurcharge(sur.id, 'name', val)
                              }
                              placeholder="Chọn hoặc nhập loại phụ phí..."
                              clearable={false}
                            />
                          </div>
                          <div className="w-36 sm:w-44">
                            <Input
                              type="number"
                              min="0"
                              step="50000"
                              value={sur.amount || ''}
                              onChange={(e) =>
                                handleUpdateSurcharge(
                                  sur.id,
                                  'amount',
                                  e.target.value,
                                )
                              }
                              placeholder="Số tiền (VNĐ)"
                              className="text-right text-xs font-mono"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveSurcharge(sur.id)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Xóa phụ phí"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}

                      {/* Summary total */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                        <span className="font-semibold text-slate-600">
                          Tổng dự toán phụ phí ({tripSurcharges.length} khoản):
                        </span>
                        <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 text-sm">
                          {tripTotalSurcharges.toLocaleString('vi-VN')} VNĐ
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Hàng 5: Dự án liên quan (Workspace) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Dự án liên quan (Workspace)
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
                      setProjectName(prj ? prj.name : '');
                    }}
                    placeholder="-- Chọn dự án liên quan nếu có (không bắt buộc) --"
                    clearable={true}
                  />

                </div>

                {/* Đính kèm chứng từ / file kế hoạch công tác */}
                <div className="space-y-1 pt-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Tệp đính kèm (Lịch trình, quyết định, vé xe; tối đa 10 MB)
                  </label>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      setLeaveFile(e.target.files?.[0] || null);
                      setLeaveAttachmentId('');
                    }}
                    className="text-xs"
                  />
                  {leaveAttachmentId && (
                    <div className="flex items-center gap-2 text-xs pt-1">
                      <span className="text-emerald-700 font-medium">
                        Đã lưu chứng từ vào kho.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
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
                        title="Gỡ chứng từ khỏi đơn?"
                        description="Chứng từ sẽ được xoá khỏi đơn công tác này."
                        onConfirm={async () => {
                          try {
                            await hrmFetch(
                              `/attachments/${leaveAttachmentId}`,
                              {
                                method: 'DELETE',
                                body: JSON.stringify({
                                  reason:
                                    'Người lập gỡ chứng từ khỏi đơn công tác',
                                }),
                              },
                            );
                            setLeaveAttachmentId('');
                            setLeaveFile(null);
                          } catch (e) {
                            toast.error(
                              e instanceof Error
                                ? e.message
                                : 'Không gỡ được chứng từ',
                            );
                          }
                        }}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-rose-600 hover:text-rose-700"
                        >
                          Gỡ chứng từ
                        </Button>
                      </Popconfirm>
                    </div>
                  )}
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
              <label className="font-semibold text-slate-800 block text-xs">
                {selectedCatalogId === 'leave'
                  ? 'Mô tả chi tiết / Lý do cụ thể *'
                  : selectedCatalogId === 'ot'
                    ? 'Mô tả chi tiết lý do làm thêm *'
                    : selectedCatalogId === 'business_trip'
                      ? 'Nội dung công việc công tác *'
                      : 'Lý do khởi tạo đơn yêu cầu *'}
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  selectedCatalogId === 'ot'
                    ? 'Nhập mô tả chi tiết công việc và lý do làm thêm (bắt buộc)...'
                    : selectedCatalogId === 'business_trip'
                      ? 'Nhập chi tiết nhiệm vụ và nội dung công việc thực hiện trong chuyến công tác (bắt buộc)...'
                      : 'Nhập chi tiết lý do và thông tin giải trình liên quan...'
                }
                className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                required
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
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => void handleSubmitRequest(false)}
              disabled={
                isSubmitting ||
                (selectedCatalogId === 'leave' && !leaveValidation.isValid) ||
                (selectedCatalogId === 'business_trip' &&
                  (!fromDate ||
                    !toDate ||
                    !destination.trim() ||
                    !reason.trim()))
              }
              title={
                selectedCatalogId === 'leave' && !leaveValidation.isValid
                  ? leaveValidation.errorMessage
                  : selectedCatalogId === 'business_trip' &&
                    (!fromDate ||
                      !toDate ||
                      !destination.trim() ||
                      !reason.trim())
                    ? 'Vui lòng điền đủ ngày, địa điểm và nội dung công việc công tác'
                    : undefined
              }
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
                    {(Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.otReasonCategory,
                    ) ||
                      Boolean(
                        (selectedRequest.rawDetails as any)?.otReasonCategory,
                      )) && (
                        <div className="flex justify-between items-center">
                          <span>Phân loại lý do:</span>
                          <span className="font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.otReasonCategory ||
                              (selectedRequest.rawDetails as any)
                                ?.otReasonCategory ||
                              '',
                            )}
                          </span>
                        </div>
                      )}
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
                              <span className="text-[10px] text-slate-500 block font-normal">
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

                    {/* Lý do & Phương tiện */}
                    {Boolean(
                      (selectedRequest.rawDetails as any)?.attributes
                        ?.tripReasonCategory,
                    ) && (
                        <div className="flex justify-between items-center">
                          <span>Lý do nghiệp vụ:</span>
                          <span className="font-semibold text-slate-800 text-right">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.tripReasonCategory,
                            )}
                          </span>
                        </div>
                      )}
                    {Boolean(
                      (selectedRequest.rawDetails as any)?.attributes?.vehicle,
                    ) && (
                        <div className="flex justify-between items-center">
                          <span>Phương tiện:</span>
                          <span className="font-semibold text-slate-800">
                            {String(
                              (selectedRequest.rawDetails as any)?.attributes
                                ?.vehicle,
                            )}
                          </span>
                        </div>
                      )}

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
                            <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[11px]">
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
                                className="flex justify-between items-center text-[11px] text-slate-600"
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
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-200/60 text-[10px]">
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
              emptyFallback={
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="size-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                      <Check className="size-3.5" />
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
    </div >
  );
}
