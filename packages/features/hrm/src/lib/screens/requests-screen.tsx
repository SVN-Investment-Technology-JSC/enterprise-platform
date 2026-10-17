'use client';
import {
  CORRECTION_DEFAULT_TIME,
  correctionPunchAt,
  correctionPunchPayload,
  type CorrectionPunchKind,
} from '../hrm-correction-sessions';
import { HrmCorrectionPunches } from '../ui/hrm-correction-punches';

import {
  AlertCircle,
  Check,
  DollarSign,
  Download,
  FileCheck2,
  FilePlus,
  FileText,
  Info,
  Loader2,
  Plus,
  Send,
  Upload,
  Trash2,
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
import { ExtraTimeRanges } from '../ui/extra-time-ranges';
import { extraRangesProblem, rangeLabel, type ExtraRange } from '../request-ranges';
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
import { DatePickerInput } from '../ui/date-picker-input';
import type {
  HrmRequestTimePreview,
  HrmRequestType,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import { splitDateTime } from '../ui/date-time-input';
import { RequestTimeRange } from '../ui/request-time-range';
import {
  GenericRequestForm,
  customTimeError,
  missingRequiredFields,
} from '../ui/generic-request-form';
import { timeModeLabel } from '../ui/request-type-dialog';
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
import { ProjectLinkField } from '../ui/project-link-field';
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
  EMPTY_TRANSPORT,
  SearchableSelect,
  type SearchableSelectOption,
  Popconfirm,
  TransportField,
  type TransportFieldValue,
  formatDate,
  fromLocalInput,
  toTransportPayload,
  transportError,
} from '@enterprise-platform/shared-ui';
import { useFleetAvailability } from '../use-fleet-availability';
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
import { MAX_ATTRIBUTE_FILE_BYTES, uploadHrmAttachment } from '../hrm-attachment-upload';
import {
  choiceFromLeaveType,
  descriptionMandatoryFor,
  isReasonedRequestKind,
  reasonBlockMessage,
  reasonCell,
  reasonPayload,
  requestReasonView,
} from '../request-reason-form';
import {
  ApproverPreview,
  RequestReasonSection,
  useApprovalRoutePreview,
  useRequestReasonCatalog,
} from '../ui/request-reason-fields';
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
import { HRM_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-hrm';
import {
  useAssistantAction,
  type AssistantActionContext,
} from '@enterprise-platform/feature-module-shell';
import {
  assistantRequestPatch,
  type AssistantRequestKind,
} from '../assistant-request-draft';

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

type RequestKind =
  | 'leave'
  | 'ot'
  | 'business_trip'
  | 'shift_change'
  | 'correction'
  | 'advance'
  | 'profile_correction'
  | 'custom';

/** Engine của loại đơn hệ thống -> kind của đường duyệt (loại tuỳ chỉnh dùng kind `custom`). */
const ENGINE_KIND: Record<string, RequestKind> = {
  LEAVE: 'leave',
  OVERTIME: 'ot',
  BUSINESS_TRIP: 'business_trip',
  SHIFT_CHANGE: 'shift_change',
  ATTENDANCE_CORRECTION: 'correction',
  ADVANCE: 'advance',
  PROFILE_CORRECTION: 'profile_correction',
};

/** Một thẻ loại đơn trong danh mục tạo đơn. */
interface CatalogCard {
  id: RequestKind;
  title: string;
  desc: string;
  tag: string;
  tagColor: string;
  balanceLabel: string;
  iconBg: string;
  /** Loại tuỳ chỉnh (kind `custom`); loại hệ thống là null. */
  customType: HrmRequestType | null;
}

/** 'YYYY-MM-DD' + 'HH:mm' -> 'YYYY-MM-DDTHH:mm' (rỗng khi chưa có ngày). */
const dateTimeOf = (date: string, time: string) =>
  date ? `${date}T${time || '00:00'}` : '';

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

interface LeaveTypeItem {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unit: string;
  /** Lý do nghỉ phép năm (mỗi tenant đúng một): chỉ lý do này trừ quỹ phép. */
  isAnnual?: boolean;
  deductBalance?: boolean;
  allowAdvance?: boolean;
  negativeLimit?: number;
}

export interface BusinessTripSurchargeItem {
  id: string;
  name: string;
  amount: number;
}

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
 * Danh sách lý do nghỉ (loại nghỉ) cho người dùng chọn: mọi lý do đang dùng do quản trị cấu hình
 * (có lương, không lương...), chỉ bỏ loại thâm niên cũ vì thâm niên là công thức trong chính sách phép năm.
 */
export function selectableLeaveTypesOf(types: LeaveTypeItem[]): LeaveTypeItem[] {
  return types.filter((t) => !isSeniorityLeaveType(t));
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
  const [editingDraft, setEditingDraft] = useState<RequestDraft | null>(null);
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canCreateRequest = can('hrm.self.request');
  const [historyPage, setHistoryPage] = useState(1);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] =
    useState<RequestKind>('leave');
  const [selectedTypeTitle, setSelectedTypeTitle] =
    useState('Đơn xin nghỉ phép');
  // Danh mục loại đơn cấu hình (GET /request-types) và loại tuỳ chỉnh đang mở form.
  const [requestTypes, setRequestTypes] = useState<HrmRequestType[]>([]);
  const [selectedCustomType, setSelectedCustomType] =
    useState<HrmRequestType | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [customFromAt, setCustomFromAt] = useState('');
  const [customToAt, setCustomToAt] = useState('');
  // Phương tiện của loại đơn bật "Cần phương tiện"; loại đơn không nhập giờ (chỉ ngày) thì giờ dùng xe nhập riêng.
  const [customTransport, setCustomTransport] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const [customTransportRange, setCustomTransportRange] = useState({ startAt: '', endAt: '' });
  // Các khoảng thời gian bổ sung của đơn nghỉ, làm thêm giờ, công tác (mỗi khoảng gửi thành một đơn).
  const [extraRanges, setExtraRanges] = useState<ExtraRange[]>([]);
  // Kết quả tính giờ của máy chủ cho khoảng thời gian đang chọn (nghỉ, làm thêm giờ, công tác).
  const [timePreview, setTimePreview] = useState<HrmRequestTimePreview | null>(
    null,
  );

  // Master Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>([]);
  const selectableLeaveTypes = useMemo(
    () => selectableLeaveTypesOf(leaveTypes),
    [leaveTypes],
  );
  const [dayPreview, setDayPreview] = useState<LeaveDayPreviewItem[] | null>(null);
  const [shiftsList, setShiftsList] = useState<ShiftItem[]>([]);
  const [colleaguesList] = useState<EmployeeItem[]>([]);
  // Dự án Workspace người dùng tham gia, cho trường "Dự án liên kết".
  const [workspaceProjects, setWorkspaceProjects] = useState<
    LinkableProject[]
  >([]);

  // LÝ DO (chọn từ danh mục; đơn nghỉ là loại nghỉ) và MÔ TẢ (tự do) là hai thông tin riêng của đơn.
  const [reasonId, setReasonId] = useState('');
  const [description, setDescription] = useState('');
  const selectedLeaveTypeId = selectedCatalogId === 'leave' ? reasonId : '';
  const catalogReasons = useRequestReasonCatalog(
    selectedCatalogId,
    isCreateModalOpen,
    selectedCatalogId === 'custom' ? selectedCustomType?.code : undefined,
  );
  const leaveReasonChoices = useMemo(
    () => selectableLeaveTypes.map(choiceFromLeaveType),
    [selectableLeaveTypes],
  );

  // State form nhập liệu chung & từng loại đơn
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveStartTime, setLeaveStartTime] = useState('07:30');
  const [leaveEndTime, setLeaveEndTime] = useState('17:00');
  /** Mã nhân viên của người đang đăng nhập, để lần tải lại danh sách không phải hỏi lại hồ sơ. */
  const empIdRef = useRef('');
  // Người dùng đã tự sửa giờ: không tự điền lại theo ca của nhân viên nữa.
  const leaveTimesTouched = useRef(false);
  const [leaveDuration, setLeaveDuration] = useState('1.0');
  const [leaveFile, setLeaveFile] = useState<File | null>(null);
  const [leaveAttachmentId, setLeaveAttachmentId] = useState('');

  // Chính sách xử lý & kiểm định tính hợp lệ của lý do nghỉ phép
  const selectedLeaveType = useMemo(
    () => leaveTypes.find((t) => t.id === selectedLeaveTypeId) || null,
    [leaveTypes, selectedLeaveTypeId],
  );
  const currentLeavePolicy = useMemo(
    () => resolveLeavePolicy(selectedLeaveType),
    [selectedLeaveType],
  );
  const leaveDurationValidation = useMemo(
    () =>
      validateLeaveDurationPolicy(
        parseFloat(leaveDuration) || 0,
        currentLeavePolicy,
      ),
    [leaveDuration, currentLeavePolicy],
  );

  // OT state (loại ngày/đêm do hệ thống suy ra theo chính sách OT, người làm đơn không chọn)
  const [otShiftId, setOtShiftId] = useState('');
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
  const [tripTransport, setTripTransport] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const [tripRequiredFinger, setTripRequiredFinger] = useState(false);
  const [tripStartTime, setTripStartTime] = useState('08:00');
  const [tripEndTime, setTripEndTime] = useState('17:30');
  const [tripSurcharges, setTripSurcharges] = useState<
    BusinessTripSurchargeItem[]
  >([]);
  const [projectId, setProjectId] = useState('');
  const [projectCode, setProjectCode] = useState('');
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
  // Mỗi đơn giải trình chỉ một mốc giờ vào hoặc giờ ra; ngày của mốc giờ luôn là "Ngày phát sinh điều chỉnh" (fromDate).
  const [correctionKind, setCorrectionKind] = useState<CorrectionPunchKind | ''>('IN');
  const [correctionTime, setCorrectionTime] = useState(CORRECTION_DEFAULT_TIME.IN);
  // Giờ bắt đầu / kết thúc ca được gán của ngày phát sinh điều chỉnh: làm giờ gợi ý cho giờ vào / giờ ra.
  const [correctionShift, setCorrectionShift] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const correctionDefaults = useMemo(
    () => ({
      IN: correctionShift.start || CORRECTION_DEFAULT_TIME.IN,
      OUT: correctionShift.end || CORRECTION_DEFAULT_TIME.OUT,
    }),
    [correctionShift],
  );
  const prevCorrectionDefaults = useRef(correctionDefaults);

  useEffect(() => {
    if (selectedCatalogId !== 'correction' || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return;
    let live = true;
    hrmFetch<{ data: HrmTimesheetBoard }>(`/timesheet-board?${new URLSearchParams({ month: fromDate.slice(0, 7), self: '1' })}`)
      .then((res) => {
        if (!live) return;
        const day = res.data.employees[0]?.days[fromDate];
        setCorrectionShift({ start: day?.shiftStart ?? null, end: day?.shiftEnd ?? null });
      })
      .catch(() => live && setCorrectionShift({ start: null, end: null }));
    return () => {
      live = false;
    };
  }, [selectedCatalogId, fromDate]);

  // Ca của ngày đổi thì giờ gợi ý đổi theo, trừ khi người dùng đã tự sửa giờ.
  useEffect(() => {
    const previous = prevCorrectionDefaults.current;
    if (previous === correctionDefaults) return;
    prevCorrectionDefaults.current = correctionDefaults;
    if (correctionKind && correctionTime === previous[correctionKind]) setCorrectionTime(correctionDefaults[correctionKind]);
  }, [correctionDefaults, correctionKind, correctionTime]);

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

  // Lý do nhập tự do chỉ còn cho đơn ứng lương và đính chính hồ sơ (không có danh mục lý do).
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
  const [filterStatus, setFilterStatus] = useState<RequestStatusFilter>('ALL');
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

  // Lý do chọn được của loại đơn đang mở: đơn nghỉ lấy từ loại nghỉ, 4 loại còn lại từ danh mục request_reasons.
  const reasonedKind = isReasonedRequestKind(selectedCatalogId)
    ? selectedCatalogId
    : null;
  const reasonChoices =
    selectedCatalogId === 'leave' ? leaveReasonChoices : catalogReasons.choices;
  const selectedReasonChoice = reasonChoices.find(
    (choice) => choice.id === reasonId,
  );
  const reasonBlock = reasonedKind
    ? reasonBlockMessage({
        kind: reasonedKind,
        choices: reasonChoices,
        reasonId,
        description,
        loading: selectedCatalogId === 'leave' ? loading : catalogReasons.loading,
        error: selectedCatalogId === 'leave' ? '' : catalogReasons.error,
      })
    : null;
  // Khoảng thời gian "từ ngày giờ đến ngày giờ" của nghỉ, làm thêm giờ, công tác: dựng từ các ô ngày và giờ
  // dùng chung của form; chọn trong RequestTimeRange thì ghi ngược vào đúng các ô đó.
  const leaveFromAt = dateTimeOf(fromDate, leaveStartTime);
  const leaveToAt = dateTimeOf(toDate || fromDate, leaveEndTime);
  const otFromAt = dateTimeOf(fromDate, startTime);
  // Làm thêm giờ qua đêm: người dùng tự chọn ngày kết thúc (ngày kế tiếp); không tự cuộn sang ngày sau, vì ngày hiển thị
  // sẽ bị ghi ngược vào ô ngày kết thúc và làm lệch lựa chọn. Kết thúc không sau bắt đầu chỉ hiện lỗi, không đổi lựa chọn.
  const otToAt = !fromDate ? '' : dateTimeOf(toDate || fromDate, endTime);
  const tripFromAt = dateTimeOf(fromDate, tripStartTime);
  const tripToAt = dateTimeOf(toDate || fromDate, tripEndTime);
  // Khung giờ dùng xe công ty = thời gian công tác; xe và tài xế bận trong khung này không chọn được.
  const tripTransportRange = tripFromAt && tripToAt ? { startAt: fromLocalInput(tripFromAt), endAt: fromLocalInput(tripToAt) } : null;
  const tripFleet = useFleetAvailability(tripTransportRange, tripTransport.mode === 'COMPANY_VEHICLE');
  const customNeedsTransport = selectedCatalogId === 'custom' && selectedCustomType?.requiresTransport === true;
  const customTimeIsDateTime = selectedCustomType?.timeMode === 'RANGE_DATETIME';
  const customTransportWindow = customTimeIsDateTime
    ? customFromAt && customToAt
      ? { startAt: fromLocalInput(customFromAt), endAt: fromLocalInput(customToAt) }
      : null
    : customTransportRange;
  const customFleet = useFleetAvailability(
    customTransportWindow,
    customNeedsTransport && customTransport.mode === 'COMPANY_VEHICLE',
  );
  const applyTimeRange =
    (setStart: (t: string) => void, setEnd: (t: string) => void, touched?: () => void) =>
    (next: { fromAt: string; toAt: string }) => {
      const from = splitDateTime(next.fromAt);
      const to = splitDateTime(next.toAt);
      touched?.();
      setFromDate(from.date);
      setToDate(to.date || from.date);
      if (from.time) setStart(from.time);
      if (to.time) setEnd(to.time);
    };
  const handleTimePreview = (preview: HrmRequestTimePreview | null) => {
    setTimePreview(preview);
    // Số ngày nghỉ theo máy chủ là con số sẽ được lưu: dùng để kiểm tra chính sách và dự kiến phép dư.
    if (
      selectedCatalogId === 'leave' &&
      preview &&
      preview.errors.length === 0 &&
      preview.totalDays > 0
    ) {
      setLeaveDuration(
        Number.isInteger(preview.totalDays)
          ? preview.totalDays.toFixed(1)
          : String(preview.totalDays),
      );
    }
  };

  // Đơn ứng lương và đính chính hồ sơ không có lý do danh mục nhưng vẫn cho biết người duyệt.
  const plainApprovalPreview = useApprovalRoutePreview({
    kind: selectedCatalogId,
    employeeId: profile.id,
    // Đơn tuỳ chỉnh: "lý do" của đường duyệt là loại đơn.
    reasonId: selectedCatalogId === 'custom' ? selectedCustomType?.id : undefined,
    enabled: isCreateModalOpen && !reasonedKind,
  });

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
  // Tổng số ngày nghỉ của mọi khoảng: khoảng chính cộng các khoảng bổ sung (số ngày do máy chủ tính cho từng khoảng).
  const totalLeaveDays = useMemo(
    () =>
      Math.round(
        ((parseFloat(leaveDuration) || 0) +
          extraRanges.reduce((n, r) => n + (r.preview?.totalDays ?? 0), 0)) *
          100,
      ) / 100,
    [leaveDuration, extraRanges],
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
        duration: totalLeaveDays,
        headroom,
      }),
    };
  }, [leaveBalance, totalLeaveDays, selectedLeaveType]);

  // Quỹ phép chỉ có với lý do trừ quỹ phép năm; các lý do nghỉ khác không có quỹ.
  const showLeaveFund =
    Boolean(selectedLeaveType) && leaveDisplayGroup(currentLeavePolicy) === 'DEDUCT';

  // Phép năm cần có quỹ: chưa có quỹ hoặc quỹ bằng 0 thì không lập được đơn; nghỉ vượt hạn mức cũng không.
  const leaveFundError = useMemo(() => {
    if (!showLeaveFund || loading) return '';
    if (!leaveDisplay || leaveDisplay.available <= 0.005)
      return 'Chưa có quỹ phép năm khả dụng (quỹ hiện bằng 0): không thể lập đơn nghỉ phép năm. Liên hệ nhân sự để cấp phép hoặc chọn lý do nghỉ khác.';
    if (leaveDisplay.status === 'INSUFFICIENT')
      return `Số ngày nghỉ vượt quỹ phép năm khả dụng (còn ${leaveDisplay.available.toFixed(2)} ngày, tối đa nghỉ được ${leaveDisplay.maxUsable.toFixed(2)} ngày). Giảm số ngày nghỉ hoặc chọn lý do nghỉ khác.`;
    return '';
  }, [showLeaveFund, loading, leaveDisplay]);
  const leaveValidation = useMemo(
    () =>
      !leaveDurationValidation.isValid
        ? leaveDurationValidation
        : leaveFundError
          ? { isValid: false, errorMessage: leaveFundError }
          : leaveDurationValidation,
    [leaveDurationValidation, leaveFundError],
  );

  // Requests list fetched from API
  const [requestsList, setRequestsList] = useState<RequestItem[]>([]);
  // Danh mục của form tạo đơn (loại nghỉ, loại đơn, dự án) đã tải xong: Trợ lý mới mở form được.
  const [masterLoaded, setMasterLoaded] = useState(false);
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

  // Danh mục loại đơn hệ thống
  const systemCatalog = [
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

  /**
   * Danh mục hiển thị: loại đơn cấu hình từ API (tên, mô tả, thứ tự do quản trị đặt, chỉ gồm loại đang bật);
   * chưa tải được thì dùng 7 loại hệ thống.
   */
  // Đơn đổi ca không dùng: ca làm việc cố định, áp dụng chung toàn công ty (đơn cũ vẫn xem được ở lịch sử và duyệt).
  const requestCatalog: CatalogCard[] = requestTypes.length
    ? requestTypes.filter((type) => type.engine !== 'SHIFT_CHANGE').flatMap<CatalogCard>((type) => {
        if (type.engine === 'GENERIC')
          return [
            {
              id: 'custom' as RequestKind,
              title: type.name,
              desc: type.description || 'Loại đơn do quản trị cấu hình.',
              tag: timeModeLabel(type.timeMode),
              tagColor: 'blue',
              balanceLabel: type.requiresAttachment
                ? 'Cần chứng từ đính kèm'
                : 'Ghi nhận và gửi duyệt',
              iconBg: 'bg-slate-100 text-slate-700',
              customType: type,
            },
          ];
        const base = systemCatalog.find((c) => c.id === ENGINE_KIND[type.engine]);
        return base
          ? [
              {
                ...base,
                title: type.name,
                desc: type.description || base.desc,
                customType: null,
              },
            ]
          : [];
      })
    : systemCatalog.filter((c) => c.id !== 'shift_change').map((c) => ({ ...c, customType: null }));

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
        if (sList.length > 0) {
          if (!currentShiftId) setCurrentShiftId(sList[0].id);
          if (!requestedShiftId && sList.length > 1)
            setRequestedShiftId(sList[1].id);
        }
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
                  projectedSeniority?: number;
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
                    // Thâm niên cả năm theo chính sách (cột sổ `seniorityDays` chỉ có khi đã cộng).
                    seniorityDays: String(
                      Math.max(b.projectedSeniority ?? 0, b.seniorityDays ?? 0),
                    ),
                  },
                ],
              ),
            ),
          );
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
      if (!opts?.listsOnly)
        void loadMaster()
          .catch(() => undefined)
          .finally(() => setMasterLoaded(true));

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
    const todayStr = new Date().toISOString().slice(0, 10);
    setFromDate(todayStr);
    setToDate(todayStr);
  }, []);

  // Tổng số lượng đơn đang chờ duyệt thực tế (dùng cho badge hiển thị trên Tab)
  // Bộ lọc danh sách: tháng (theo ngày tạo), từ khóa, loại đơn và bước quy trình; trạng thái lọc thêm ở bên dưới.
  const baseFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requestsList.filter((item) => {
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

  const handleOpenCreateForType = async (
    catId: RequestKind,
    typeTitle: string,
    customType: HrmRequestType | null = null,
  ) => {
    setEditingDraft(null);
    setSelectedCatalogId(catId);
    setSelectedCustomType(customType);
    setCustomValues({});
    setCustomFromAt('');
    setCustomToAt('');
    setCustomTransport(EMPTY_TRANSPORT);
    setCustomTransportRange({ startAt: '', endAt: '' });
    setTimePreview(null);
    setSelectedTypeTitle(typeTitle);
    const todayStr = new Date().toISOString().slice(0, 10);
    setFromDate(todayStr);
    setToDate(todayStr);
    setReason('');
    setReasonId('');
    setDescription('');
    setFormErrorMessage(null);
    setIsNightOt(false);
    setProjectId('');
    setProjectCode('');
    setProjectName('');
    setWorkItemId('');
    setDynamicValues({});
    touchedAttributeCodes.current = new Set();
    setDynamicAttributes([]);

    setLeaveFile(null);
    setLeaveAttachmentId('');
    setLeaveStartTime('07:30');
    setLeaveEndTime('17:00');
    setExtraRanges([]);
    leaveTimesTouched.current = false;
    setStartTime('17:30');
    setEndTime('20:30');
    setOtShiftId(shiftsList[0]?.id || 'Ca_HC');
    setTripStartTime('08:00');
    setTripEndTime('17:30');
    setTripType('DOMESTIC');
    setDestination('');
    setTripAddress('');
    setTripDepartment(rawProfile.department || profile.department || '');
    setTripTransport(EMPTY_TRANSPORT);
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
  // Cách duyệt và biểu mẫu quy trình chọn theo MÃ LÝ DO của đơn (đơn nghỉ: mã loại nghỉ).
  const currentSubTypeCode = requestSubTypeCode(selectedCatalogId, {
    leaveTypeCode: selectedLeaveType?.code,
    reasonCode: selectedReasonChoice?.code,
    customTypeCode: selectedCustomType?.code,
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
      // Đơn có danh mục: form.reason là TÊN lý do, form.reason_code là mã, form.description là mô tả tự do.
      'form.reason': reasonedKind ? selectedReasonChoice?.name : reason,
      'form.reason_code': selectedReasonChoice?.code,
      'form.description': reasonedKind ? description : undefined,
      'form.leave_type_code': selectedLeaveType?.code,
      'form.from_date': fromDate,
      'form.to_date': toDate,
      'form.work_date': fromDate,
      'form.request_date': fromDate,
      'form.duration': leaveDuration,
      'form.leave_type_id': selectedLeaveTypeId,
      'form.is_negative_leave': false,
      'form.ot_hours': String(hoursBetween(startTime, endTime) ?? ''),
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
    reasonedKind,
    selectedReasonChoice,
    selectedLeaveType,
    description,
    fromDate,
    toDate,
    leaveDuration,
    selectedLeaveTypeId,
    startTime,
    endTime,
    isNightOt,
    tripType,
    destination,
    allowOt,
    requestedAmount,
    numberOfInstallments,
    changeType,
  ]);



  /**
   * Đơn điều chỉnh cho một đơn đã bị huỷ hiệu lực (link trong thông báo "Cần
   * gửi đơn điều chỉnh"): mở form cùng loại, điền sẵn nội dung đơn cũ.
   */
  const openAdjustment = async (original: RequestItem) => {
    const catalog = requestCatalog.find((entry) => entry.id === original.kind);
    await handleOpenCreateForType(original.kind, catalog?.title ?? original.typeName);
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
    if (from) setFromDate(from);
    if (to) setToDate(to);
    // Lý do chọn từ danh mục: đơn nghỉ là loại nghỉ, các loại khác là `reasonId`.
    const reasonRef = original.kind === 'leave' ? str('leaveTypeId') : str('reasonId');
    if (reasonRef) setReasonId(reasonRef);
    setDescription(`Điều chỉnh đơn ${original.code}`);
    if (original.kind === 'leave') setLeaveDuration(str('duration', '1'));
    if (original.kind === 'ot') {
      setStartTime(str('startTime', '18:00').slice(0, 5));
      setEndTime(str('endTime', '21:00').slice(0, 5));
    }
    if (original.kind === 'business_trip') {
      setTripType(str('businessTripType', 'DOMESTIC') as typeof tripType);
      setDestination(str('destination'));
      setAllowOt(d.allowOt === true);
      setProjectId(str('projectId'));
      setProjectCode(str('projectCode'));
      setProjectName(str('projectName'));
    }
    if (original.kind === 'advance') {
      setRequestedAmount(str('requestedAmount', '0'));
      setNumberOfInstallments(str('numberOfInstallments', '1'));
    }
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

  // Trợ lý Savina mở form tạo đơn với bản nháp; người dùng xem lại rồi gửi như khi tự nhập.
  // Phiên Trợ lý của form đang mở: báo "đã gửi" khi gửi xong, "đã huỷ" khi đóng form không gửi.
  const assistantSession = useRef<AssistantActionContext | null>(null);
  // Lệnh đến khi hồ sơ, quyền, danh mục chưa tải xong (vừa chuyển trang) thì chờ ở đây.
  const assistantQueue = useRef<{
    kind: AssistantRequestKind;
    draft: Record<string, unknown>;
    context: AssistantActionContext;
  } | null>(null);
  const [assistantTick, setAssistantTick] = useState(0);

  const applyAssistantDraft = (
    kind: AssistantRequestKind,
    draft: Record<string, unknown>,
    fresh: boolean,
    customType: HrmRequestType | null,
  ) => {
    const patch = assistantRequestPatch(kind, draft, {
      current: fresh ? null : { toDate, customToAt },
      leaveTypeIds: selectableLeaveTypes.map((t) => t.id),
      projects: workspaceProjects,
      customType,
    });
    if (patch.fromDate !== undefined) setFromDate(patch.fromDate);
    if (patch.toDate !== undefined) setToDate(patch.toDate);
    if (kind !== 'custom') {
      const [setStart, setEnd] =
        kind === 'leave'
          ? [setLeaveStartTime, setLeaveEndTime]
          : kind === 'ot'
            ? [setStartTime, setEndTime]
            : [setTripStartTime, setTripEndTime];
      // Giờ do Trợ lý điền là giờ người dùng nói: không tự điền lại theo ca.
      if (kind === 'leave' && (patch.startTime || patch.endTime)) leaveTimesTouched.current = true;
      if (patch.startTime) setStart(patch.startTime);
      if (patch.endTime) setEnd(patch.endTime);
    }
    if (patch.reasonId !== undefined) setReasonId(patch.reasonId);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.destination !== undefined) setDestination(patch.destination);
    if (patch.tripType !== undefined) setTripType(patch.tripType);
    if (patch.allowOt !== undefined) setAllowOt(patch.allowOt);
    if (patch.project) {
      setProjectId(patch.project.id);
      setProjectCode(patch.project.code);
      setProjectName(patch.project.name);
    }
    if (patch.customFromAt !== undefined) setCustomFromAt(patch.customFromAt);
    if (patch.customToAt !== undefined) setCustomToAt(patch.customToAt);
    const customPatch = patch.customValues;
    if (customPatch) setCustomValues((prev) => ({ ...prev, ...customPatch }));
  };

  const runAssistantDraft = async (job: NonNullable<typeof assistantQueue.current>) => {
    const { kind, draft, context } = job;
    const active = assistantSession.current;
    // Cùng yêu cầu khi form còn mở: chỉ cập nhật các ô có trong bản nháp mới.
    if (active?.requestId === context.requestId && isCreateModalOpen) {
      applyAssistantDraft(kind, draft, false, selectedCustomType);
      return;
    }
    if (!canCreateRequest) {
      context.report('unavailable', { message: 'Tài khoản không có quyền tạo đơn từ.' });
      return;
    }
    if (!profile.id) {
      context.report('unavailable', { message: 'Tài khoản chưa liên kết hồ sơ nhân viên.' });
      return;
    }
    if (isCreateModalOpen && !active) {
      context.report('unavailable', {
        message: 'Người dùng đang nhập dở một đơn khác; đóng form đó rồi thử lại.',
      });
      return;
    }
    const card =
      kind === 'custom'
        ? requestCatalog.find((c) => c.customType && c.customType.id === context.variant)
        : requestCatalog.find((c) => c.id === kind && !c.customType);
    if (!card) {
      context.report('unavailable', {
        message:
          kind === 'custom'
            ? 'Không tìm thấy loại đơn này hoặc loại đơn đã ngừng sử dụng.'
            : 'Loại đơn này đang tắt trong cấu hình của công ty.',
      });
      return;
    }
    if (active) {
      assistantSession.current = null;
      active.report('cancelled');
    }
    await handleOpenCreateForType(card.id, card.title, card.customType);
    assistantSession.current = context;
    applyAssistantDraft(kind, draft, true, card.customType);
  };

  const queueAssistantDraft =
    (kind: AssistantRequestKind) =>
    (draft: Partial<Record<string, unknown>>, context: AssistantActionContext) => {
      const queued = assistantQueue.current;
      if (queued?.context.requestId === context.requestId) {
        queued.draft = { ...queued.draft, ...draft };
      } else {
        queued?.context.report('cancelled');
        assistantQueue.current = { kind, draft, context };
      }
      setAssistantTick((tick) => tick + 1);
    };
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createLeaveRequest.key, queueAssistantDraft('leave'));
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createOtRequest.key, queueAssistantDraft('ot'));
  useAssistantAction(
    HRM_ASSISTANT_ACTIONS.createBusinessTripRequest.key,
    queueAssistantDraft('business_trip'),
  );
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createCustomRequest.key, queueAssistantDraft('custom'));

  useEffect(() => {
    const job = assistantQueue.current;
    // Hồ sơ không tải được (chưa liên kết nhân viên) thì không chờ danh mục: báo lại cho Trợ lý ngay.
    if (!job || loading || permissionsLoading || (!masterLoaded && profile.id)) return;
    assistantQueue.current = null;
    void runAssistantDraft(job);
    // Chỉ chạy khi có lệnh mới hoặc dữ liệu của form vừa tải xong; hàm luôn đọc state của lần render này.
  }, [assistantTick, loading, permissionsLoading, masterLoaded, profile.id]);

  // Form đóng mà không gửi (huỷ, bấm ra ngoài, lưu nháp): báo Trợ lý.
  useEffect(() => {
    if (isCreateModalOpen) return;
    const session = assistantSession.current;
    if (!session) return;
    assistantSession.current = null;
    session.report('cancelled');
  }, [isCreateModalOpen]);

  /** Phiên Trợ lý của form đang mở (nếu có) để báo kết quả gửi đơn; form đóng sau đó không báo "huỷ" nữa. */
  const takeAssistantSession = () => {
    const session = assistantSession.current;
    assistantSession.current = null;
    return session;
  };

  // Submit đơn theo đúng bảng nghiệp vụ riêng của từng domain (Mục 6 trong PLAN)
  const handleSubmitRequest = async (saveAsDraft = false) => {
    if (!saveAsDraft) {
      // Năm loại đơn có danh mục: lý do luôn bắt buộc, mô tả chỉ bắt buộc khi lý do cấu hình "cần mô tả".
      if (reasonedKind && reasonBlock) {
        notifyFormError('Thiếu thông tin', reasonBlock);
        return;
      }
      // Ứng lương và đính chính hồ sơ: lý do nhập tự do (không có danh mục).
      if (!reasonedKind && selectedCatalogId !== 'custom' && !reason.trim()) {
        toast.error({
          title: 'Thiếu thông tin',
          description: 'Vui lòng nhập lý do khởi tạo yêu cầu.',
        });
        return;
      }
    }

    if (
      !saveAsDraft &&
      timePreview &&
      timePreview.errors.length > 0 &&
      (selectedCatalogId === 'leave' ||
        selectedCatalogId === 'ot' ||
        selectedCatalogId === 'business_trip')
    ) {
      notifyFormError('Thời gian không hợp lệ', timePreview.errors[0]);
      return;
    }
    if (!saveAsDraft && selectedCatalogId === 'custom' && selectedCustomType) {
      const timeError = customTimeError(
        selectedCustomType.timeMode,
        customFromAt,
        customToAt,
      );
      if (timeError) {
        notifyFormError('Thời gian không hợp lệ', timeError);
        return;
      }
      if (catalogReasons.loading) {
        notifyFormError('Thiếu thông tin', 'Đang tải danh sách lý do.');
        return;
      }
      if (catalogReasons.choices.length > 0 && !reasonId) {
        notifyFormError('Thiếu thông tin', 'Vui lòng chọn lý do.');
        return;
      }
      const missing = missingRequiredFields(
        selectedCustomType.fields,
        customValues,
      );
      if (missing.length > 0) {
        notifyFormError(
          'Thiếu thông tin',
          `Vui lòng nhập: ${missing.map((f) => f.label).join(', ')}.`,
        );
        return;
      }
      if (selectedCustomType.requiresAttachment && !leaveFile && !leaveAttachmentId) {
        notifyFormError(
          'Thiếu chứng từ',
          `Loại đơn "${selectedCustomType.name}" bắt buộc đính kèm chứng từ.`,
        );
        return;
      }
    }

    try {
      setIsSubmitting(true);
      let res: Response | null = null;
      // Nhiều khoảng thời gian: mỗi khoảng là một đơn; ghi lại khoảng lỗi và số đơn đã gửi để báo rõ.
      let rangeFailure: { index: number; sent: number; kind: 'leave' | 'ot' | 'trip' } | null = null;
      let submittedCount = 1;
      const rangeOf = (fromAt: string, toAt: string, duration: number) => {
        const from = splitDateTime(fromAt);
        const to = splitDateTime(toAt);
        return {
          fromAt,
          toAt,
          fromDate: from.date,
          toDate: to.date || from.date,
          startTime: from.time,
          endTime: to.time,
          duration,
        };
      };
      // `fresh`: khoảng thứ hai trở đi của cùng lần tạo đơn luôn dùng bản nháp mới, không dùng lại bản nháp đang mở.
      const persistRequest = async (
        url: string,
        init: RequestInit,
        fresh = false,
      ): Promise<Response> => {
        const payload = JSON.parse(String(init.body));
        const draft = fresh ? null : editingDraft;
        const saved = await fetch(
          hrmApiUrl(
            draft
              ? `/request-drafts/${selectedCatalogId}/${draft.id}`
              : `/request-drafts/${selectedCatalogId}`,
          ),
          {
            ...init,
            method: draft ? 'PATCH' : 'POST',
            body: JSON.stringify({
              employeeId: profile.id,
              payload,
              expectedUpdatedAt: draft?.updatedAt,
            }),
          },
        );
        if (!saved.ok || saveAsDraft) return saved;
        const { data } = (await saved.json()) as { data: RequestDraft };
        if (!fresh) setEditingDraft(data);
        return fetch(url, {
          ...init,
          body: JSON.stringify({
            employeeId: profile.id,
            draftId: data.id,
            expectedUpdatedAt: data.updatedAt,
          }),
        });
      };

      type SubmitRange = ReturnType<typeof rangeOf>;
      const sendRanges = async (
        kind: 'leave' | 'ot' | 'trip',
        url: string,
        mainRange: SubmitRange,
        build: (range: SubmitRange) => Record<string, unknown>,
      ): Promise<Response> => {
        const list: SubmitRange[] = saveAsDraft
          ? [mainRange]
          : [
              mainRange,
              ...extraRanges.map((r) => rangeOf(r.fromAt, r.toAt, r.preview?.totalDays ?? 0)),
            ];
        let last: Response | null = null;
        for (let i = 0; i < list.length; i++) {
          last = await persistRequest(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken(),
              },
              credentials: 'same-origin',
              body: JSON.stringify(build(list[i])),
            },
            i > 0,
          );
          if (!last.ok) {
            rangeFailure = { index: i, sent: i, kind };
            return last;
          }
        }
        submittedCount = list.length;
        return last as Response;
      };

      if (selectedCatalogId === 'leave') {
        // Lý do của đơn nghỉ là loại nghỉ (danh mục Phép năm và lý do nghỉ).
        const typeId = selectedLeaveTypeId;
        if (!typeId) {
          notifyFormError('Thiếu thông tin', 'Vui lòng chọn lý do nghỉ.');
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
        if (!saveAsDraft && extraRanges.length) {
          const problem = extraRangesProblem(
            'leave',
            { fromAt: leaveFromAt, toAt: leaveToAt },
            extraRanges,
          );
          if (problem) {
            notifyFormError(problem.title, problem.message);
            return;
          }
          for (const [i, r] of extraRanges.entries()) {
            const rule = validateLeaveDurationPolicy(r.preview?.totalDays ?? 0, currentLeavePolicy);
            if (!rule.isValid) {
              notifyFormError(
                `${rangeLabel(i + 1, 'leave')} chưa hợp lệ`,
                `${rangeLabel(i + 1, 'leave')}: ${rule.errorMessage}`,
              );
              return;
            }
          }
        }
        let attachmentFileId = leaveAttachmentId;
        if (leaveFile && !attachmentFileId) {
          attachmentFileId = (await uploadHrmAttachment(profile.id, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }
        res = await sendRanges(
          'leave',
          hrmApiUrl('/leave-requests'),
          rangeOf(leaveFromAt, leaveToAt, parseFloat(leaveDuration) || 1.0),
          (range) => ({
            employeeId: profile.id,
            ...reasonPayload('leave', typeId, description),
            attachmentFileId: attachmentFileId || undefined,
            fromDate: range.fromDate,
            toDate: range.toDate,
            fromAt: range.fromAt,
            toAt: range.toAt,
            startTime: range.startTime,
            endTime: range.endTime,
            projectId: projectId || undefined,
            duration: range.duration,
            isNegativeLeave: false,
            attributes: dynamicValues,
          }),
        );
      } else if (selectedCatalogId === 'ot') {
        if (!fromDate) {
          notifyFormError('Thiếu thông tin', 'Vui lòng chọn ngày làm thêm.');
          return;
        }

        const plannedMin = Math.round(
          (new Date(otToAt).getTime() - new Date(otFromAt).getTime()) / 60000,
        );

        if (!saveAsDraft && plannedMin <= 0) {
          notifyFormError(
            'Thời gian không hợp lệ',
            'Giờ kết thúc làm thêm phải sau giờ bắt đầu (tổng số phút phải lớn hơn 0).',
          );
          return;
        }

        if (!saveAsDraft && extraRanges.length) {
          const problem = extraRangesProblem('ot', { fromAt: otFromAt, toAt: otToAt }, extraRanges);
          if (problem) {
            notifyFormError(problem.title, problem.message);
            return;
          }
        }

        let attachmentFileId = leaveAttachmentId;
        if (leaveFile && !attachmentFileId) {
          attachmentFileId = (await uploadHrmAttachment(profile.id, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }

        const selectedShift = shiftsList.find((s) => s.id === otShiftId);

        // Loại OT (ngày thường, đêm, cuối tuần, lễ) do máy chủ suy ra theo chính sách OT nên không gửi otType.
        res = await sendRanges(
          'ot',
          hrmApiUrl('/ot-requests'),
          rangeOf(otFromAt, otToAt, plannedMin),
          (range) => ({
            employeeId: profile.id,
            workDate: range.fromDate,
            startTime: range.startTime,
            endTime: range.endTime,
            fromAt: range.fromAt,
            toAt: range.toAt,
            plannedMinutes: Math.round(
              (new Date(range.toAt).getTime() - new Date(range.fromAt).getTime()) / 60000,
            ),
            ...reasonPayload('ot', reasonId, description),
            attributes: {
              ...dynamicValues,
              shiftId: otShiftId || 'Ca_HC',
              shiftName: selectedShift
                ? selectedShift.name
                : 'Ca Hành chính (07:30 - 17:00)',
              projectId: projectId || undefined,
              projectCode: projectCode || undefined,
              projectName: projectName || undefined,
              attachmentFileId: attachmentFileId || undefined,
            },
          }),
        );
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

        if (!saveAsDraft) {
          const transportProblem = transportError(tripTransport, tripTransportRange);
          if (transportProblem) {
            notifyFormError('Thiếu thông tin phương tiện', transportProblem);
            return;
          }
        }

        if (!saveAsDraft && extraRanges.length) {
          const problem = extraRangesProblem('trip', { fromAt: tripFromAt, toAt: tripToAt }, extraRanges);
          if (problem) {
            notifyFormError(problem.title, problem.message);
            return;
          }
        }

        let attachmentFileId = leaveAttachmentId;
        if (leaveFile && !attachmentFileId) {
          attachmentFileId = (await uploadHrmAttachment(profile.id, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }

        res = await sendRanges(
          'trip',
          hrmApiUrl('/business-trip-requests'),
          rangeOf(tripFromAt, tripToAt, days),
          (range) => ({
            employeeId: profile.id,
            businessTripType: tripType,
            workItemId: workItemId || undefined,
            destination:
              destination.trim() || 'Công tác theo kế hoạch phòng ban',
            projectId: projectId || null,
            projectCode: projectCode || null,
            projectName: projectName || null,
            fromDate: range.fromDate,
            toDate: range.toDate,
            fromAt: range.fromAt,
            toAt: range.toAt,
            daysCount: Math.max(
              1,
              Math.round(
                (new Date(range.toDate).getTime() - new Date(range.fromDate).getTime()) /
                  (1000 * 3600 * 24),
              ) + 1,
            ),
            allowOt,
            // Mỗi khoảng thời gian của đơn giữ xe theo đúng khoảng đó.
            transport:
              toTransportPayload(
                tripTransport,
                { startAt: fromLocalInput(range.fromAt), endAt: fromLocalInput(range.toAt) },
                destination.trim(),
              ) ?? undefined,
            ...reasonPayload('business_trip', reasonId, description),
            attributes: {
              ...dynamicValues,
              tripStartTime: range.startTime,
              tripEndTime: range.endTime,
              destinationAddress: tripAddress.trim() || undefined,
              workDepartment: tripDepartment.trim() || undefined,
              vehicle:
                tripTransport.mode === 'COMPANY_VEHICLE'
                  ? 'Xe công ty'
                  : tripTransport.mode === 'EXTERNAL'
                    ? tripTransport.detail
                    : undefined,
              requiredFinger: tripRequiredFinger,
              surcharges: tripSurcharges.filter(
                (s) => s.name.trim() || s.amount > 0,
              ),
              totalSurcharges: tripTotalSurcharges,
              attachmentFileId: attachmentFileId || undefined,
            },
          }),
        );
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
            ...reasonPayload('shift_change', reasonId, description),
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'correction') {
        let punches: ReturnType<typeof correctionPunchPayload>;
        try {
          if (!saveAsDraft && !fromDate)
            throw new Error('Vui lòng chọn ngày phát sinh điều chỉnh.');
          // Ngày của mốc giờ lấy từ "Ngày phát sinh điều chỉnh" nên hai ngày luôn trùng nhau.
          punches = correctionPunchPayload([
            { kind: correctionKind, at: correctionPunchAt(fromDate, correctionTime) },
          ]);
        } catch (error) {
          notifyFormError(
            'Thời gian không hợp lệ',
            error instanceof Error ? error.message : 'Giờ chấm công không hợp lệ.',
          );
          return;
        }
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
            punches,
            ...reasonPayload('correction', reasonId, description),
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'custom' && selectedCustomType) {
        if (!saveAsDraft && customNeedsTransport) {
          const transportProblem = transportError(customTransport, customTransportWindow);
          if (transportProblem) {
            notifyFormError('Thiếu thông tin phương tiện', transportProblem);
            return;
          }
        }
        let attachmentFileId = leaveAttachmentId;
        if (leaveFile && !attachmentFileId) {
          attachmentFileId = (await uploadHrmAttachment(profile.id, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }
        res = await persistRequest(hrmApiUrl('/custom-requests'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            typeId: selectedCustomType.id,
            fromAt: customFromAt || null,
            toAt: customToAt || null,
            transport: customNeedsTransport
              ? (toTransportPayload(customTransport, customTransportWindow, null) ?? undefined)
              : undefined,
            fields: customValues,
            reasonId: reasonId || null,
            description,
            attachmentFileId: attachmentFileId || null,
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
        const assistant = saveAsDraft ? null : takeAssistantSession();
        setIsCreateModalOpen(false);
        if (assistant) {
          // Thân phản hồi chưa được đọc ở đâu khác: lấy mã đơn vừa tạo để Trợ lý mở lại.
          const created = (await res.json().catch(() => null)) as { data?: { id?: unknown } } | null;
          const id = typeof created?.data?.id === 'string' ? created.data.id : undefined;
          const period =
            fromDate && toDate && toDate !== fromDate
              ? `${formatVnDate(fromDate)} - ${formatVnDate(toDate)}`
              : formatVnDate(fromDate);
          assistant.report('saved', {
            ...(id ? { id, href: `/modules/hrm/requests?request=${encodeURIComponent(id)}` } : {}),
            label: [
              selectedTypeTitle,
              selectedCatalogId === 'custom' ? '' : period,
              submittedCount > 1 ? `(${submittedCount} đơn)` : '',
            ]
              .filter((part) => part && part !== '----')
              .join(' '),
          });
        }
        setReason('');
        setReasonId('');
        setDescription('');
        toast.success({
          title: saveAsDraft
            ? 'Đã lưu bản nháp'
            : submittedCount > 1
              ? `Đã gửi ${submittedCount} đơn`
              : 'Đã gửi đơn',
          description: saveAsDraft
            ? 'Nháp chưa phát sinh hiệu lực nghiệp vụ.'
            : submittedCount > 1
              ? `Mỗi khoảng thời gian là một đơn riêng; theo dõi trạng thái trong danh sách.`
              : 'Đơn đã được ghi nhận; theo dõi trạng thái trong danh sách.',
        });
        await loadData({ listsOnly: true });
        // Đưa người dùng tới đơn vừa gửi: tháng hiện tại, nhóm chờ duyệt.
        setListMonth(currentMonthVn());
        setFilterStatus('PENDING');
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
        const failure = rangeFailure as {
          index: number;
          sent: number;
          kind: 'leave' | 'ot' | 'trip';
        } | null;
        if (failure && failure.sent > 0) {
          // Các khoảng trước đã được gửi thành đơn: đóng form để không gửi trùng, báo rõ khoảng lỗi.
          takeAssistantSession()?.report('failed', { message: errMsg });
          notifyFormError(
            `${rangeLabel(failure.index, failure.kind)} gửi không thành công`,
            `${errMsg} Đã gửi thành công ${failure.sent} khoảng trước đó; kiểm tra danh sách đơn rồi tạo lại khoảng còn lại.`,
          );
          setIsCreateModalOpen(false);
          await loadData({ listsOnly: true });
        } else {
          notifyFormError(
            unavailable
              ? 'Procedure Engine không khả dụng'
              : failure
                ? `${rangeLabel(failure.index, failure.kind)} gửi không thành công`
                : 'Tạo đơn thất bại',
            errMsg,
          );
        }
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
          <Button
            permission="hrm.self.request"
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold"
            onClick={() => handleOpenCreateForType('leave', 'Đơn xin nghỉ phép')}
          >
            <Plus className="size-3.5" />
            <span>Tạo đơn mới</span>
          </Button>
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
                title="Xuất các dòng đang hiển thị trong danh sách ra file CSV"
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
            {/* LÝ DO (chọn từ danh mục) và MÔ TẢ (tự do) của 5 loại đơn có danh mục lý do; kèm Người duyệt */}
            {reasonedKind && (
              <RequestReasonSection
                kind={reasonedKind}
                choices={reasonChoices}
                loading={
                  selectedCatalogId === 'leave' ? loading : catalogReasons.loading
                }
                error={selectedCatalogId === 'leave' ? '' : catalogReasons.error}
                onRetry={catalogReasons.reload}
                reasonId={reasonId}
                onReasonChange={setReasonId}
                description={description}
                onDescriptionChange={setDescription}
                employeeId={profile.id}
                disabled={isSubmitting}
                descriptionMandatory={descriptionMandatoryFor(selectedCatalogId)}
                descriptionLabel={
                  selectedCatalogId === 'ot'
                    ? 'Mô tả nội dung công việc làm thêm'
                    : selectedCatalogId === 'business_trip'
                      ? 'Nội dung công việc công tác'
                      : undefined
                }
                descriptionPlaceholder={
                  selectedCatalogId === 'ot'
                    ? 'Nhập mô tả chi tiết công việc và lý do làm thêm (bắt buộc)...'
                    : selectedCatalogId === 'business_trip'
                      ? 'Nhập chi tiết nhiệm vụ và nội dung công việc thực hiện trong chuyến công tác (bắt buộc)...'
                      : undefined
                }
              />
            )}

            {selectedCatalogId === 'advance' && (
              <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-600 block text-[12px]">
                    Số tiền tạm ứng:
                  </span>
                  <strong className="text-sm text-indigo-900 font-mono">
                    Theo số tiền được phê duyệt
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[12px]">
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
                <RequestTimeRange
                  employeeId={profile.id}
                  fromAt={leaveFromAt}
                  toAt={leaveToAt}
                  leaveTypeId={selectedLeaveTypeId || undefined}
                  onChange={applyTimeRange(
                    setLeaveStartTime,
                    setLeaveEndTime,
                    () => {
                      leaveTimesTouched.current = true;
                    },
                  )}
                  onPreview={handleTimePreview}
                />
                <ExtraTimeRanges
                  kind="leave"
                  employeeId={profile.id}
                  leaveTypeId={selectedLeaveTypeId || undefined}
                  main={{ fromAt: leaveFromAt, toAt: leaveToAt }}
                  ranges={extraRanges}
                  onChange={setExtraRanges}
                  disabled={isSubmitting}
                />

                {/* Thông tin ngày nghỉ: số ngày tính toán; quỹ phép chỉ có với lý do trừ phép năm */}
                <div
                  data-testid="leave-info"
                  className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3"
                >
                  <div
                    className={`grid gap-3 ${showLeaveFund ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1'}`}
                  >
                    {showLeaveFund && (
                      <div data-testid="leave-fund" className="space-y-0.5">
                        <span className="block text-[12px] text-slate-600">
                          Quỹ phép năm khả dụng
                        </span>
                        <span className="font-mono text-sm font-bold text-[#021E73]">
                          {leaveBalance.remaining} ngày
                        </span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <span className="block text-[12px] text-slate-600">
                        Số ngày nghỉ tính toán
                      </span>
                      <span className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-mono text-sm font-bold text-[#021E73]">
                          {extraRanges.length > 0 ? totalLeaveDays : leaveDuration} ngày
                        </span>
                        {extraRanges.length > 0 && (
                          <span className="text-[12px] text-slate-500">
                            ({[leaveDuration, ...extraRanges.map((r) => r.preview?.totalDays ?? 0)]
                              .map((d, i) => `Khoảng ${i + 1}: ${d}`)
                              .join(' • ')})
                          </span>
                        )}
                        {currentLeavePolicy.stepRule === 'PERCENT_SHIFT' && (
                          <span className="font-mono text-[12px] font-medium text-emerald-700">
                            ({(parseFloat(leaveDuration) * 100).toFixed(1)}% ca •{' '}
                            {(parseFloat(leaveDuration) * 8).toFixed(1)}h)
                          </span>
                        )}
                        {currentLeavePolicy.stepRule === 'HALF_DAY_STEP' && (
                          <span className="text-[12px] text-slate-500">
                            {parseFloat(leaveDuration) === 0.5
                              ? '(Nửa ngày ca sáng hoặc chiều)'
                              : parseFloat(leaveDuration) === 1.0
                                ? '(Trọn 1 ngày công)'
                                : parseFloat(leaveDuration) % 0.5 === 0
                                  ? `(${parseFloat(leaveDuration)} ngày)`
                                  : '(Không tròn 0.5 ngày)'}
                          </span>
                        )}
                      </span>
                    </div>
                    {showLeaveFund && (
                      <>
                        <div className="space-y-0.5">
                          <span className="block text-[12px] text-slate-600">
                            Sau khi xin
                          </span>
                          <span className="font-mono text-sm font-bold text-emerald-700">
                            {leaveBalance.remaining !== '----'
                              ? (
                                  parseFloat(leaveBalance.remaining) -
                                  totalLeaveDays
                                ).toFixed(1)
                              : '----'}{' '}
                            ngày
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-[12px] text-slate-600">
                            Phép dư dự kiến
                          </span>
                          {leaveDisplay ? (
                            <span
                              className={`font-mono text-sm font-bold ${leaveDisplay.status === 'OK' ? 'text-emerald-700' : leaveDisplay.status === 'ADVANCE' ? 'text-amber-700' : 'text-rose-600'}`}
                            >
                              {leaveDisplay.after.toFixed(2)} ngày
                            </span>
                          ) : (
                            <span className="font-mono text-sm font-bold text-slate-500">
                              ----
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {showLeaveFund && leaveDisplay && (
                    <p className="text-[12px] leading-relaxed text-slate-500">
                      Hiện còn {leaveDisplay.available.toFixed(2)} ngày
                      {leaveDisplay.seniority > 0
                        ? ` (gồm ${leaveDisplay.seniority} ngày thâm niên)`
                        : ''}
                      {leaveBalance.entitlement !== '----'
                        ? ` • Quỹ dự kiến năm ${leaveBalance.entitlement} ngày, ${
                            leaveBalance.advanceAllowed
                              ? 'được ứng trước đến hết năm'
                              : 'chỉ dùng phần đã tích luỹ đến tháng này'
                          }`
                        : ''}
                      {leaveDisplay.headroom > 0
                        ? ` • Có thể nghỉ tối đa ${leaveDisplay.maxUsable.toFixed(2)} ngày`
                        : ''}
                    </p>
                  )}
                  {showLeaveFund && leaveDisplay?.status === 'ADVANCE' && (
                    <p className="text-[12px] font-semibold text-amber-700">
                      Ứng {Math.abs(leaveDisplay.after).toFixed(2)} ngày phép theo hạn mức của quỹ phép năm.
                    </p>
                  )}
                  {showLeaveFund && leaveDisplay?.status === 'INSUFFICIENT' && (
                    <p className="text-[12px] font-semibold text-rose-600">
                      Vượt hạn mức được nghỉ.
                    </p>
                  )}
                </div>

                {previewBreakdown && previewBreakdown.breakdown.length > 1 && (
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-[12px] text-slate-600">
                    <strong className="block font-semibold text-slate-700">
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
                        <span className="flex-1 text-right text-slate-500">
                          {item.note}
                        </span>
                        <span className="w-12 text-right font-mono font-semibold">
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
                {leaveFundError && (
                  <div
                    role="alert"
                    data-testid="leave-fund-error"
                    className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                    <div className="space-y-0.5">
                      <strong className="block font-semibold">
                        Không đủ quỹ phép năm
                      </strong>
                      <p className="text-[12px] leading-relaxed">{leaveFundError}</p>
                    </div>
                  </div>
                )}
                {!leaveDurationValidation.isValid && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="space-y-0.5">
                      <strong className="block font-semibold">
                        Thời gian nghỉ chưa thỏa mãn quy định
                      </strong>
                      <p className="text-[12px] leading-relaxed">
                        {leaveDurationValidation.errorMessage}
                      </p>
                    </div>
                  </div>
                )}

                {/* Dự án liên quan (không bắt buộc) và tệp đính kèm (không bắt buộc) */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block font-semibold text-slate-800">
                        Dự án liên quan (Workspace)
                      </label>
                      {projectId && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-blue-700">
                          Mã:{' '}
                          {workspaceProjects.find((p) => p.id === projectId)?.code ||
                            projectId}
                        </span>
                      )}
                    </div>
                    <SearchableSelect
                      height={36}
                      options={projectOptions}
                      value={projectId}
                      onChange={(val) => {
                        setProjectId(val);
                        const prj = workspaceProjects.find((p) => p.id === val);
                        setProjectCode(prj ? prj.code : '');
                        setProjectName(prj ? prj.name : '');
                      }}
                      placeholder="Chọn dự án nếu có (không bắt buộc)"
                      clearable={true}
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="block font-semibold text-slate-800">
                      Tệp đính kèm (không bắt buộc)
                    </span>
                    <label className="flex min-h-[38px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-center text-[12px] text-slate-500 hover:border-[#ffc90a] hover:bg-amber-50/40">
                      <span>
                        <Upload className="mr-1 inline size-3.5 align-text-bottom" />
                        Kéo tệp vào đây hoặc{' '}
                        <span className="font-semibold text-blue-700">chọn tệp</span>
                      </span>
                      <span className="text-[12px] text-slate-400">
                        Hỗ trợ: PDF, DOC, DOCX, JPG, PNG (tối đa 10MB)
                      </span>
                      <input
                        type="file"
                        aria-label="Tệp đính kèm"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (file && file.size > MAX_ATTRIBUTE_FILE_BYTES) {
                            toast.error('Tệp vượt quá dung lượng tối đa 10 MB');
                            e.target.value = '';
                            return;
                          }
                          setLeaveFile(file);
                          setLeaveAttachmentId('');
                        }}
                      />
                    </label>
                    {leaveFile && !leaveAttachmentId && (
                      <div className="flex items-center justify-between gap-2 text-[12px] text-slate-600">
                        <span className="truncate" title={leaveFile.name}>
                          {leaveFile.name}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 font-semibold text-rose-600 hover:underline"
                          onClick={() => setLeaveFile(null)}
                        >
                          Bỏ tệp
                        </button>
                      </div>
                    )}
                  </div>
                </div>
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

            {/* FORM: LOẠI ĐƠN TUỲ CHỈNH (do quản trị cấu hình) */}
            {selectedCatalogId === 'custom' && selectedCustomType && (
              <>
                {selectedCustomType.description && (
                  <p className="text-xs text-slate-500">
                    {selectedCustomType.description}
                  </p>
                )}
                {(catalogReasons.loading || catalogReasons.choices.length > 0) && (
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">
                      Lý do <span className="text-red-500">*</span>
                    </label>
                    <SearchableSelect
                      height={36}
                      options={catalogReasons.choices.map((choice) => ({
                        value: choice.id,
                        label: choice.name,
                        description: choice.description ?? undefined,
                      }))}
                      value={reasonId}
                      onChange={(value) => setReasonId(value)}
                      placeholder={
                        catalogReasons.loading
                          ? 'Đang tải danh sách lý do...'
                          : 'Chọn lý do...'
                      }
                      disabled={isSubmitting || catalogReasons.loading}
                      clearable={false}
                    />
                  </div>
                )}
                <GenericRequestForm
                  type={selectedCustomType}
                  employeeId={profile.id}
                  fromAt={customFromAt}
                  toAt={customToAt}
                  onTimeChange={(next) => {
                    setCustomFromAt(next.fromAt);
                    setCustomToAt(next.toAt);
                  }}
                  values={customValues}
                  onValuesChange={setCustomValues}
                  disabled={isSubmitting}
                />
                {customNeedsTransport ? (
                  <TransportField
                    idPrefix="custom-transport"
                    selectHeight={36}
                    value={customTransport}
                    onChange={setCustomTransport}
                    range={customTransportWindow}
                    onRangeChange={customTimeIsDateTime ? undefined : setCustomTransportRange}
                    availability={customFleet.availability}
                    loading={customFleet.loading}
                    error={customFleet.error}
                    disabled={isSubmitting}
                    note="Xe được giữ chỗ ngay khi gửi đơn và tự xác nhận khi đơn được duyệt; đơn bị từ chối hoặc huỷ thì xe được trả lại."
                  />
                ) : null}
                <label className="block space-y-1 font-semibold">
                  Mô tả (nhập thêm chi tiết nếu cần)
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-normal outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100"
                  />
                </label>
                <label className="block space-y-1 font-semibold">
                  Tệp đính kèm
                  {selectedCustomType.requiresAttachment && (
                    <span className="text-red-500"> *</span>
                  )}
                  <Input
                    type="file"
                    className="text-xs"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      setLeaveFile(e.target.files?.[0] || null);
                      setLeaveAttachmentId('');
                    }}
                  />
                </label>
              </>
            )}

            {/* FORM 2: LÀM THÊM GIỜ (OT) */}
            {selectedCatalogId === 'ot' && (
              <>


                <RequestTimeRange
                  employeeId={profile.id}
                  fromAt={otFromAt}
                  toAt={otToAt}
                  kind="ot"
                  fromLabel="Từ ngày giờ làm thêm"
                  toLabel="Đến ngày giờ làm thêm"
                  onChange={applyTimeRange(setStartTime, setEndTime)}
                  onPreview={handleTimePreview}
                />
                <ExtraTimeRanges
                  kind="ot"
                  employeeId={profile.id}
                  main={{ fromAt: otFromAt, toAt: otToAt }}
                  ranges={extraRanges}
                  onChange={setExtraRanges}
                  disabled={isSubmitting}
                />

                {/* Hàng 4: Lý do (Tăng ca, Thí nghiệm) + Dự án liên quan (Workspace) */}


                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Dự án liên quan (Workspace)
                    </label>
                    {projectId && (
                      <span className="text-[12px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono font-medium">
                        Mã:{' '}
                        {workspaceProjects.find((p) => p.id === projectId)
                          ?.code || projectId}
                      </span>
                    )}
                  </div>
                  <SearchableSelect
                    height={36}
                    options={projectOptions}
                    value={projectId}
                    onChange={(val) => {
                      setProjectId(val);
                      const prj = workspaceProjects.find((p) => p.id === val);
                      setProjectCode(prj ? prj.code : '');
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
                <RequestTimeRange
                  employeeId={profile.id}
                  fromAt={tripFromAt}
                  toAt={tripToAt}
                  kind="trip"
                  onChange={applyTimeRange(setTripStartTime, setTripEndTime)}
                  onPreview={handleTimePreview}
                />
                <ExtraTimeRanges
                  kind="trip"
                  employeeId={profile.id}
                  main={{ fromAt: tripFromAt, toAt: tripToAt }}
                  ranges={extraRanges}
                  onChange={setExtraRanges}
                  disabled={isSubmitting}
                />

                {/* Hàng 2: Hình thức công tác & Phòng ban */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block text-xs">
                      Hình thức công tác *
                    </label>
                    <SearchableSelect
                      height={36}
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

                {/* Hàng 4: Phương tiện di chuyển (lý do công tác chọn ở khối Lý do đầu form) */}
                <TransportField
                  idPrefix="trip-transport"
                  selectHeight={36}
                  value={tripTransport}
                  onChange={setTripTransport}
                  range={tripTransportRange}
                  availability={tripFleet.availability}
                  loading={tripFleet.loading}
                  error={tripFleet.error}
                  note="Xe được giữ chỗ ngay khi gửi đơn và tự xác nhận khi đơn được duyệt; đơn bị từ chối hoặc huỷ thì xe được trả lại."
                />

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
                              height={36}
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

                {/* Trường dùng chung "Dự án liên kết": đơn gửi duyệt được ghi vào tab Đơn từ của dự án. */}
                <ProjectLinkField
                  projects={workspaceProjects}
                  value={projectId}
                  onChange={(project) => {
                    setProjectId(project?.id ?? '');
                    setProjectCode(project?.code ?? '');
                    setProjectName(project?.name ?? '');
                  }}
                />

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
                    height={36}
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
                      height={36}
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
                      height={36}
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
                      height={36}
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
                      height={36}
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
                      height={36}
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
                    height={36}
                    value={fromDate}
                    onChange={(val) => setFromDate(val)}
                    placeholder="dd/mm/yyyy"
                  />
                </div>
                <HrmCorrectionPunches
                  kind={correctionKind}
                  time={correctionTime}
                  onChange={(next) => {
                    setCorrectionKind(next.kind);
                    setCorrectionTime(next.time);
                  }}
                  defaults={correctionDefaults}
                  disabled={isSubmitting}
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
                      height={36}
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
                    height={36}
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {formatVnDate(rawProfile.dateOfBirth)})
                        </span>
                      </label>
                      <DatePickerInput
                        height={36}
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                        height={36}
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
                          (Hiện tại:{' '}
                          {formatVnDate(rawProfile.identityCardIssuedDate)})
                        </span>
                      </label>
                      <DatePickerInput
                        height={36}
                        value={adjustIdentityDate}
                        onChange={(val) => setAdjustIdentityDate(val)}
                        placeholder="dd/mm/yyyy"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Nơi cấp CCCD
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                        <span className="text-[12px] text-slate-400 font-normal ml-1">
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
                    <span className="text-[12px] text-slate-500 italic block mt-0.5">
                      * Ban Nhân sự sẽ căn cứ vào bản scan hoặc bản sao có chứng
                      thực để phê duyệt cập nhật vào Core.
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Ứng lương và đính chính hồ sơ: không có danh mục lý do, lý do nhập tự do; vẫn cho biết người duyệt */}
            {!reasonedKind && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block text-xs">
                    Lý do khởi tạo đơn yêu cầu *
                  </label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Nhập chi tiết lý do và thông tin giải trình liên quan..."
                    className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    required
                  />
                </div>
                <ApproverPreview preview={plainApprovalPreview} />
              </>
            )}

            {/* THUỘC TÍNH ĐỘNG TỪ PROCEDURE ENGINE NODE S */}
            {procedureAvailable === false && (
              <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50 text-[12px] text-amber-800">
                Procedure Engine đang không khả dụng. Đơn thuộc quy trình duyệt
                qua Procedure sẽ bị từ chối cho đến khi dịch vụ hoạt động lại.
              </div>
            )}
            {bindingState?.status === 'subtype-required' && (
              <div className="p-2.5 rounded-md border border-blue-200 bg-blue-50 text-[12px] text-blue-800">
                {reasonedKind && !selectedReasonChoice
                  ? 'Chọn lý do để tải biểu mẫu quy trình.'
                  : bindingState.message}
              </div>
            )}
            {bindingState?.status === 'error' && (
              <div className="p-2.5 rounded-md border border-red-200 bg-red-50 text-[12px] text-red-700 flex items-center justify-between gap-2">
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
              <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50 text-[12px] text-amber-800">
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
                Boolean(reasonBlock) ||
                (selectedCatalogId === 'custom' && catalogReasons.loading) ||
                (selectedCatalogId === 'leave' && !leaveValidation.isValid) ||
                (selectedCatalogId === 'business_trip' &&
                  (!fromDate || !toDate || !destination.trim()))
              }
              title={
                reasonBlock
                  ? reasonBlock
                  : selectedCatalogId === 'leave' && !leaveValidation.isValid
                    ? leaveValidation.errorMessage
                    : selectedCatalogId === 'business_trip' &&
                      (!fromDate || !toDate || !destination.trim())
                      ? 'Vui lòng điền đủ ngày và địa điểm công tác'
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
