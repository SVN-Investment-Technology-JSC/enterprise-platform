'use client';
import {
  CORRECTION_DEFAULT_TIME,
  correctionPunchAt,
  correctionPunchPayload,
  type CorrectionPunchKind,
} from '../hrm-correction-sessions';
import { HrmCorrectionPunches } from './hrm-correction-punches';

import {
  AlertCircle,
  DollarSign,
  FilePlus,
  Info,
  Loader2,
  Plus,
  Send,
  Upload,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useAssistantEmbed } from '@enterprise-platform/feature-module-shell';
import type {
  HrmBusinessTripType,
  HrmRequestTimePreview,
  HrmRequestType,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import {
  EMPTY_TRANSPORT,
  SearchableSelect,
  type SearchableSelectOption,
  Popconfirm,
  TransportField,
  type TransportFieldValue,
  fromLocalInput,
  toTransportPayload,
  transportError,
} from '@enterprise-platform/shared-ui';
import { Button } from './button';
import { Input } from './input';
import { ExtraTimeRanges } from './extra-time-ranges';
import { extraRangesProblem, rangeLabel, type ExtraRange } from '../request-ranges';
import { DatePickerInput } from './date-picker-input';
import { splitDateTime } from './date-time-input';
import { RequestTimeRange } from './request-time-range';
import {
  GenericRequestForm,
  customTimeError,
  missingRequiredFields,
} from './generic-request-form';
import { timeModeLabel } from './request-type-dialog';
import { toast } from './toast';
import { hrmApiUrl, hrmFetch } from '../hrm-api';
import { ProjectLinkField } from './project-link-field';
import type { LinkableProject } from '../workspace-projects';
import { useFleetAvailability } from '../use-fleet-availability';
import {
  DynamicAttributeForm,
  type ProcedureAttributeItem,
} from './dynamic-attribute-form';
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

/** 'YYYY-MM-DDTHH:mm' -> 'DD/MM HH:mm' cho bảng tách từng khoản của đơn nghỉ nhiều khoảng. */
const shortRangeTime = (value: string): string =>
  `${value.slice(8, 10)}/${value.slice(5, 7)} ${value.slice(11, 16)}`;
import {
  choiceFromLeaveType,
  descriptionMandatoryFor,
  isReasonedRequestKind,
  reasonBlockMessage,
  reasonPayload,
} from '../request-reason-form';
import {
  ApproverPreview,
  RequestReasonSection,
  useApprovalRoutePreview,
  useRequestReasonCatalog,
} from './request-reason-fields';
import type { RequestFormPatch } from '../assistant-request-draft';
import {
  STANDARD_SHIFT_HC,
  calculateWorkingMinutesInShift,
  computeLeaveFromPreview,
  leaveDisplayGroup,
  projectLeaveBalance,
  resolveLeavePolicy,
  selectableLeaveTypesOf,
  validateLeaveDurationPolicy,
  type LeaveBalanceView,
  type LeaveDayPreviewItem,
  type LeaveTypeItem,
  type ShiftItem,
} from '../request-form-model';

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

export type RequestKind =
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
export interface CatalogCard {
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

/**
 * Danh mục tạo đơn: loại đơn cấu hình từ API (tên, mô tả, thứ tự do quản trị đặt, chỉ gồm loại đang bật); chưa tải
 * được thì dùng các loại hệ thống. `leaveFund` là số ngày phép khả dụng ghi trên thẻ Đơn xin nghỉ phép.
 */
export function requestCatalogOf(
  requestTypes: readonly HrmRequestType[],
  leaveFund = '----',
): CatalogCard[] {
  // Danh mục loại đơn hệ thống
  const systemCatalog = [
    {
      id: 'leave' as RequestKind,
      title: 'Đơn xin nghỉ phép',
      desc: 'Nghỉ phép năm, nghỉ ốm BHXH, việc riêng có hưởng lương, nghỉ không lương theo quy chế.',
      tag: 'Tự động trừ quỹ phép',
      tagColor: 'emerald',
      balanceLabel: `Quỹ phép khả dụng: ${leaveFund !== '----' ? `${leaveFund} ngày` : '----'}`,
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

  // Đơn đổi ca không dùng: ca làm việc cố định, áp dụng chung toàn công ty (đơn cũ vẫn xem được ở lịch sử và duyệt).
  return requestTypes.length
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
}

/** 'YYYY-MM-DD' + 'HH:mm' -> 'YYYY-MM-DDTHH:mm' (rỗng khi chưa có ngày). */
const dateTimeOf = (date: string, time: string) =>
  date ? `${date}T${time || '00:00'}` : '';

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

interface EmployeeItem {
  id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  position?: string;
}

/** Đồng nghiệp để hoán đổi ca và chọn người trong thuộc tính quy trình: chưa có nguồn, danh sách luôn rỗng. */
const colleaguesList: EmployeeItem[] = [];

/** Mã chống CSRF trong cookie `ep_csrf`, gửi kèm các yêu cầu ghi. */
export function csrfToken() {
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

/** Hồ sơ của người dùng (GET /my-profile): đơn đính chính hồ sơ so từng ô với hồ sơ này; phòng ban cử đi công tác. */
export interface RequestFormProfile {
  readonly [field: string]: unknown;
  readonly fullName?: string | null;
  readonly department?: string | null;
  readonly dateOfBirth?: string | null;
  readonly gender?: string | null;
  readonly identityCardNumber?: string | null;
  readonly identityCardIssuedDate?: string | null;
  readonly identityCardIssuedPlace?: string | null;
  readonly taxCode?: string | null;
  readonly socialInsuranceNumber?: string | null;
}

/** Dữ liệu form tạo đơn cần, do nơi dựng form tải sẵn. */
export interface RequestFormData {
  /** Nhân viên làm đơn: chính người đang đăng nhập. */
  readonly employeeId: string;
  readonly profile: RequestFormProfile;
  readonly leaveTypes: LeaveTypeItem[];
  readonly shifts: ShiftItem[];
  /** Dự án Workspace người dùng gắn được vào đơn. */
  readonly projects: LinkableProject[];
  /** Quỹ phép theo loại nghỉ. */
  readonly leaveBalances: Readonly<Record<string, LeaveBalanceView>>;
  /** Danh mục loại nghỉ và quỹ phép còn đang tải. */
  readonly loading: boolean;
}

/** Giá trị điền sẵn lúc mở form; ô vắng mặt lấy giá trị mặc định. */
export type RequestFormInitial = RequestFormPatch & {
  leaveDuration?: string;
  requestedAmount?: string;
  numberOfInstallments?: string;
};

/** Một lần sửa tiếp khi form đang mở: `seq` tăng mỗi lần, `patch` tính các ô cần đổi từ giá trị hiện tại. */
export interface RequestFormUpdate {
  readonly seq: number;
  readonly patch: (current: { toDate: string; customToAt: string }) => RequestFormPatch;
}

export interface RequestFormResult {
  /** Mã đơn vừa tạo (gửi nhiều khoảng thời gian là đơn cuối cùng), khi máy chủ trả về. */
  readonly id?: string;
  /** Tên ngắn của đơn: loại đơn, thời gian, số đơn. */
  readonly label: string;
  /** Số đơn đã gửi (mỗi khoảng thời gian một đơn). */
  readonly count: number;
}

export interface CreateRequestFormProps {
  /** Loại đơn đã chọn trong danh mục; loại tuỳ chỉnh có `customType`. */
  readonly kind: RequestKind;
  readonly title: string;
  readonly customType: HrmRequestType | null;
  readonly data: RequestFormData;
  /** Giá trị điền sẵn lúc mở (đơn điều chỉnh, bản nháp của Trợ lý). */
  readonly initial?: RequestFormInitial;
  /** Sửa tiếp khi form đang mở (Trợ lý gửi thêm bản nháp): chỉ đổi các ô có trong bản vá. */
  readonly update?: RequestFormUpdate;
  readonly onCancel: () => void;
  /** Đơn đã gửi xong. */
  readonly onSubmitted: (result: RequestFormResult) => void | Promise<void>;
  /** Một phần khoảng thời gian đã thành đơn rồi gặp lỗi: form phải đóng để không gửi trùng. */
  readonly onAbandoned: (message: string) => void | Promise<void>;
}

/**
 * Form tạo đơn của trang Đơn từ: lý do, thời gian, trường riêng theo loại đơn, thuộc tính quy trình, kiểm tra và gửi
 * qua API của HRM (mỗi khoảng thời gian một đơn).
 *
 * Trang Đơn từ đặt form trong hộp thoại; trang form nhúng của Trợ lý (`useAssistantEmbed`) dựng ngay tại chỗ, chiếm hết
 * bề ngang card và cao theo nội dung. Mỗi lần mở form là một lần dựng mới (đặt `key`), nên mọi ô bắt đầu từ mặc định
 * hoặc `initial`.
 */
export function CreateRequestForm({
  kind,
  title,
  customType,
  data,
  initial,
  update,
  onCancel,
  onSubmitted,
  onAbandoned,
}: CreateRequestFormProps) {
  const inline = useAssistantEmbed();
  const { employeeId, profile, leaveTypes, shifts, projects, leaveBalances, loading } = data;
  const selectedCatalogId = kind;
  const selectedCustomType = customType;
  const selectedTypeTitle = title;
  const start: RequestFormInitial = initial ?? {};
  const [editingDraft, setEditingDraft] = useState<RequestDraft | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(start.customValues ?? {});
  const [customFromAt, setCustomFromAt] = useState(start.customFromAt ?? '');
  const [customToAt, setCustomToAt] = useState(start.customToAt ?? '');
  // Phương tiện của loại đơn bật "Cần phương tiện"; loại đơn không nhập giờ (chỉ ngày) thì giờ dùng xe nhập riêng.
  const [customTransport, setCustomTransport] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const [customTransportRange, setCustomTransportRange] = useState({ startAt: '', endAt: '' });
  // Các khoảng thời gian bổ sung của đơn nghỉ, làm thêm giờ, công tác (mỗi khoảng gửi thành một đơn).
  const [extraRanges, setExtraRanges] = useState<ExtraRange[]>([]);
  // Kết quả tính giờ của máy chủ cho khoảng thời gian đang chọn (nghỉ, làm thêm giờ, công tác).
  const [timePreview, setTimePreview] = useState<HrmRequestTimePreview | null>(
    null,
  );

  const selectableLeaveTypes = useMemo(
    () => selectableLeaveTypesOf(leaveTypes),
    [leaveTypes],
  );
  const [dayPreview, setDayPreview] = useState<LeaveDayPreviewItem[] | null>(null);

  // LÝ DO (chọn từ danh mục; đơn nghỉ là loại nghỉ) và MÔ TẢ (tự do) là hai thông tin riêng của đơn.
  const [reasonId, setReasonId] = useState(start.reasonId ?? '');
  const [description, setDescription] = useState(start.description ?? '');
  const selectedLeaveTypeId = selectedCatalogId === 'leave' ? reasonId : '';
  const catalogReasons = useRequestReasonCatalog(
    selectedCatalogId,
    true,
    selectedCatalogId === 'custom' ? selectedCustomType?.code : undefined,
  );
  const leaveReasonChoices = useMemo(
    () => selectableLeaveTypes.map(choiceFromLeaveType),
    [selectableLeaveTypes],
  );

  // State form nhập liệu chung & từng loại đơn
  const [fromDate, setFromDate] = useState(() => start.fromDate ?? new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => start.toDate ?? new Date().toISOString().slice(0, 10));
  const [leaveStartTime, setLeaveStartTime] = useState((kind === 'leave' && start.startTime) || '07:30');
  const [leaveEndTime, setLeaveEndTime] = useState((kind === 'leave' && start.endTime) || '17:00');
  // Người dùng đã tự sửa giờ (hoặc giờ được điền sẵn): không tự điền lại theo ca của nhân viên nữa.
  const leaveTimesTouched = useRef(kind === 'leave' && Boolean(start.startTime || start.endTime));
  const [leaveDuration, setLeaveDuration] = useState(start.leaveDuration ?? '1.0');
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
  const [otShiftId] = useState(() => shifts[0]?.id || 'Ca_HC');
  const isNightOt = false;
  const [startTime, setStartTime] = useState((kind === 'ot' && start.startTime) || '17:30');
  const [endTime, setEndTime] = useState((kind === 'ot' && start.endTime) || '20:30');


  // Business trip state (form không còn ô nhập địa chỉ chi tiết và chấm công GPS: gửi giá trị trống như trước)
  const [tripType, setTripType] = useState<HrmBusinessTripType>(start.tripType ?? 'DOMESTIC');
  const [destination, setDestination] = useState(start.destination ?? '');
  const tripAddress = '';
  const [tripDepartment, setTripDepartment] = useState<string>(profile.department || '');
  const [tripTransport, setTripTransport] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const tripRequiredFinger = false;
  const [tripStartTime, setTripStartTime] = useState((kind === 'business_trip' && start.startTime) || '08:00');
  const [tripEndTime, setTripEndTime] = useState((kind === 'business_trip' && start.endTime) || '17:30');
  const [tripSurcharges, setTripSurcharges] = useState<
    BusinessTripSurchargeItem[]
  >([]);
  const [projectId, setProjectId] = useState(start.project?.id ?? '');
  const [projectCode, setProjectCode] = useState(start.project?.code ?? '');
  const [projectName, setProjectName] = useState(start.project?.name ?? '');
  const [allowOt, setAllowOt] = useState(start.allowOt ?? false);

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
  const [currentShiftId, setCurrentShiftId] = useState(shifts[0]?.id ?? '');
  const [requestedShiftId, setRequestedShiftId] = useState(shifts[1]?.id ?? '');
  const [swapWithEmployeeId, setSwapWithEmployeeId] = useState('');
  // Danh sách ca tải xong sau lúc mở form: chọn sẵn ca hiện tại và ca đề xuất như trước.
  useEffect(() => {
    if (!shifts.length) return;
    setCurrentShiftId((current) => current || shifts[0].id);
    if (shifts.length > 1) setRequestedShiftId((current) => current || shifts[1].id);
  }, [shifts]);

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
  const [requestedAmount, setRequestedAmount] = useState(start.requestedAmount ?? '5000000');
  const [numberOfInstallments, setNumberOfInstallments] = useState(start.numberOfInstallments ?? '1');

  // Đơn công tác không còn ô chọn hạng mục công việc.
  const workItemId = '';

  // Profile correction state - Hỗ trợ nhập trực tiếp nhiều trường cùng lúc (mặc định là hồ sơ hiện tại)
  const [adjustFullName, setAdjustFullName] = useState<string>(profile.fullName || '');
  const [adjustDateOfBirth, setAdjustDateOfBirth] = useState<string>(
    profile.dateOfBirth ? String(profile.dateOfBirth).slice(0, 10) : '',
  );
  const [adjustGender, setAdjustGender] = useState<string>(profile.gender || 'MALE');
  const [adjustIdentityCard, setAdjustIdentityCard] = useState<string>(profile.identityCardNumber || '');
  const [adjustIdentityDate, setAdjustIdentityDate] = useState<string>(
    profile.identityCardIssuedDate ? String(profile.identityCardIssuedDate).slice(0, 10) : '',
  );
  const [adjustIdentityPlace, setAdjustIdentityPlace] = useState<string>(profile.identityCardIssuedPlace || '');
  const [adjustTaxCode, setAdjustTaxCode] = useState<string>(profile.taxCode || '');
  const [adjustSocialInsurance, setAdjustSocialInsurance] =
    useState<string>(profile.socialInsuranceNumber || '');
  const [profileEvidenceDoc, setProfileEvidenceDoc] = useState<string>('');

  // Lý do nhập tự do chỉ còn cho đơn ứng lương và đính chính hồ sơ (không có danh mục lý do).
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formErrorMessage, setFormErrorMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const notifyFormError = (title: string, description: string) => {
    // Trong card Trợ lý, thông báo nổi đè lên đầu form: chỉ hiện khung lỗi cạnh nút gửi.
    if (!inline) toast.error({ title, description });
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
    employeeId,
    // Đơn tuỳ chỉnh: "lý do" của đường duyệt là loại đơn.
    reasonId: selectedCatalogId === 'custom' ? selectedCustomType?.id : undefined,
    enabled: !reasonedKind,
  });

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

  // Mã loại con quyết định binding PE nào sẽ được dùng khi gửi đơn.
  // Cách duyệt và biểu mẫu quy trình chọn theo MÃ LÝ DO của đơn (đơn nghỉ: mã loại nghỉ).
  const currentSubTypeCode = requestSubTypeCode(selectedCatalogId, {
    leaveTypeCode: selectedLeaveType?.code,
    reasonCode: selectedReasonChoice?.code,
    customTypeCode: selectedCustomType?.code,
  });

  // Cờ procedureAvailable từ GET /v1/capabilities, đọc khi mở form.
  useEffect(() => {
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
  }, []);

  // Tải lại thuộc tính động mỗi khi đổi loại đơn hoặc loại con (loại phép, loại OT, loại công tác).
  useEffect(() => {
    if (!selectedCatalogId) return;
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
    selectedCatalogId,
    currentSubTypeCode,
    bindingReload,
  ]);

  // Lịch từng ngày (nghỉ tuần, lễ, ca thực tế) của nhân viên cho khoảng nghỉ đang chọn.
  useEffect(() => {
    if (selectedCatalogId !== 'leave' || !fromDate || !employeeId) {
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
      `/employees/${employeeId}/leave-day-preview?from=${fromDate}&to=${end}`,
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
  }, [selectedCatalogId, fromDate, toDate, employeeId]);

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
              employeeId: employeeId,
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
            employeeId: employeeId,
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
          attachmentFileId = (await uploadHrmAttachment(employeeId, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }
        res = await sendRanges(
          'leave',
          hrmApiUrl('/leave-requests'),
          rangeOf(leaveFromAt, leaveToAt, parseFloat(leaveDuration) || 1.0),
          (range) => ({
            employeeId: employeeId,
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
          attachmentFileId = (await uploadHrmAttachment(employeeId, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }

        const selectedShift = shifts.find((s) => s.id === otShiftId);

        // Loại OT (ngày thường, đêm, cuối tuần, lễ) do máy chủ suy ra theo chính sách OT nên không gửi otType.
        res = await sendRanges(
          'ot',
          hrmApiUrl('/ot-requests'),
          rangeOf(otFromAt, otToAt, plannedMin),
          (range) => ({
            employeeId: employeeId,
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
          attachmentFileId = (await uploadHrmAttachment(employeeId, leaveFile)).id;
          setLeaveAttachmentId(attachmentFileId);
        }

        res = await sendRanges(
          'trip',
          hrmApiUrl('/business-trip-requests'),
          rangeOf(tripFromAt, tripToAt, days),
          (range) => ({
            employeeId: employeeId,
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
            employeeId: employeeId,
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
            employeeId: employeeId,
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
          attachmentFileId = (await uploadHrmAttachment(employeeId, leaveFile)).id;
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
            employeeId: employeeId,
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
            employeeId: employeeId,
            requestDate: fromDate,
            requestedAmount: amt,
            numberOfInstallments: parseInt(numberOfInstallments, 10) || 1,
            reason,
            attributes: dynamicValues,
          }),
        });
      } else if (selectedCatalogId === 'profile_correction') {
        const changes: string[] = [];
        const oldName = profile.fullName || '';
        if (adjustFullName.trim() && adjustFullName.trim() !== oldName) {
          changes.push(`Họ và tên: "${oldName}" -> "${adjustFullName.trim()}"`);
        }

        const oldDob = profile.dateOfBirth
          ? String(profile.dateOfBirth).slice(0, 10)
          : '';
        if (adjustDateOfBirth && adjustDateOfBirth !== oldDob) {
          changes.push(
            `Ngày sinh: "${oldDob || '----'}" -> "${adjustDateOfBirth}"`,
          );
        }

        const oldGender = profile.gender || 'MALE';
        if (adjustGender && adjustGender !== oldGender) {
          changes.push(`Giới tính: "${oldGender}" -> "${adjustGender}"`);
        }

        const oldCccd = profile.identityCardNumber || '';
        if (
          adjustIdentityCard.trim() &&
          adjustIdentityCard.trim() !== oldCccd
        ) {
          changes.push(
            `Số CCCD/CMND: "${oldCccd || '----'}" -> "${adjustIdentityCard.trim()}"`,
          );
        }

        const oldCccdDate = profile.identityCardIssuedDate
          ? String(profile.identityCardIssuedDate).slice(0, 10)
          : '';
        if (adjustIdentityDate && adjustIdentityDate !== oldCccdDate) {
          changes.push(
            `Ngày cấp: "${oldCccdDate || '----'}" -> "${adjustIdentityDate}"`,
          );
        }

        const oldCccdPlace = profile.identityCardIssuedPlace || '';
        if (
          adjustIdentityPlace.trim() &&
          adjustIdentityPlace.trim() !== oldCccdPlace
        ) {
          changes.push(
            `Nơi cấp: "${oldCccdPlace || '----'}" -> "${adjustIdentityPlace.trim()}"`,
          );
        }

        const oldTax = profile.taxCode || '';
        if (adjustTaxCode.trim() && adjustTaxCode.trim() !== oldTax) {
          changes.push(
            `Mã số thuế: "${oldTax || '----'}" -> "${adjustTaxCode.trim()}"`,
          );
        }

        const oldBhxh = profile.socialInsuranceNumber || '';
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
              String(profile[key] || '').slice(
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
        // Thân phản hồi chưa được đọc ở đâu khác: lấy mã đơn vừa tạo (gửi nhiều khoảng là đơn cuối cùng).
        const created = (await res.json().catch(() => null)) as { data?: { id?: unknown } } | null;
        const id = typeof created?.data?.id === 'string' ? created.data.id : undefined;
        const period =
          fromDate && toDate && toDate !== fromDate
            ? `${formatVnDate(fromDate)} - ${formatVnDate(toDate)}`
            : formatVnDate(fromDate);
        // Card Trợ lý đóng form ngay khi nhận kết quả: không hiện thông báo nổi trong card.
        if (!inline)
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
        await onSubmitted({
          ...(id ? { id } : {}),
          label: [
            selectedTypeTitle,
            selectedCatalogId === 'custom' ? '' : period,
            submittedCount > 1 ? `(${submittedCount} đơn)` : '',
          ]
            .filter((part) => part && part !== '----')
            .join(' '),
          count: submittedCount,
        });
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
          const message = `${errMsg} Đã gửi thành công ${failure.sent} khoảng trước đó; kiểm tra danh sách đơn rồi tạo lại khoảng còn lại.`;
          notifyFormError(`${rangeLabel(failure.index, failure.kind)} gửi không thành công`, message);
          await onAbandoned(message);
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

  const shiftOptions: SearchableSelectOption[] = useMemo(() => {
    return shifts.map((s) => ({
      value: s.id,
      label: `${s.name} (${s.startTime} - ${s.endTime})`,
      badge: s.code,
    }));
  }, [shifts]);

  const colleagueOptions: SearchableSelectOption[] = useMemo(() => {
    return colleaguesList.map((e) => ({
      value: e.id,
      label: `${e.fullName} (${e.employeeCode})`,
      badge: e.department || 'Nhân sự',
      description: e.position || undefined,
    }));
  }, [colleaguesList]);

  const projectOptions: SearchableSelectOption[] = useMemo(() => {
    return projects.map((p) => ({
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
  }, [projects]);

  /** Đặt các ô có trong bản vá; ô vắng mặt giữ nguyên giá trị đang có. */
  const applyPatch = (patch: RequestFormPatch) => {
    if (patch.fromDate !== undefined) setFromDate(patch.fromDate);
    if (patch.toDate !== undefined) setToDate(patch.toDate);
    const setTimes =
      kind === 'leave'
        ? [setLeaveStartTime, setLeaveEndTime]
        : kind === 'ot'
          ? [setStartTime, setEndTime]
          : kind === 'business_trip'
            ? [setTripStartTime, setTripEndTime]
            : null;
    if (setTimes) {
      // Giờ điền sẵn là giờ người dùng nói: không tự điền lại theo ca.
      if (kind === 'leave' && (patch.startTime || patch.endTime)) leaveTimesTouched.current = true;
      if (patch.startTime) setTimes[0](patch.startTime);
      if (patch.endTime) setTimes[1](patch.endTime);
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

  // Sửa tiếp khi form đang mở: chỉ đổi các ô có trong bản vá, phần người dùng đã nhập giữ nguyên.
  const appliedUpdate = useRef(update?.seq);
  useEffect(() => {
    if (!update || update.seq === appliedUpdate.current) return;
    appliedUpdate.current = update.seq;
    applyPatch(update.patch({ toDate, customToAt }));
    // Chỉ chạy khi có bản vá mới; toDate, customToAt là giá trị của lần render này.
  }, [update]);

  // Lỗi khi gửi: hộp thoại hiện ngay dưới tiêu đề; trong card Trợ lý (cao theo nội dung) hiện sát nút gửi vừa bấm.
  const errorBanner = formErrorMessage && (
    <div
      className={`${inline ? 'mt-3' : 'mx-6 mt-4'} p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-3 text-xs text-red-950 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm`}
    >
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
  );

  return (
    <>
      {inline ? (
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
          <FilePlus className="size-4 shrink-0 text-[#021E73]" />
          {selectedTypeTitle}
        </h3>
      ) : (
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FilePlus className="size-4 text-[#021E73]" />
              {selectedTypeTitle}
            </h3>
          </div>
        </div>
      )}

      {/* BANNER THÔNG BÁO LỖI NỔI BẬT NGAY TRÊN ĐẦU POPUP FORM */}
      {!inline && errorBanner}

      <div className={inline ? 'space-y-3 text-xs' : 'p-6 space-y-4 text-xs max-h-[75vh] overflow-y-auto'}>
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
            employeeId={employeeId}
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
              employeeId={employeeId}
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
              employeeId={employeeId}
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
                        ({extraRanges.length + 1} khoảng)
                      </span>
                    )}
                    {extraRanges.length === 0 && currentLeavePolicy.stepRule === 'PERCENT_SHIFT' && (
                      <span className="font-mono text-[12px] font-medium text-emerald-700">
                        ({(parseFloat(leaveDuration) * 100).toFixed(1)}% ca •{' '}
                        {(parseFloat(leaveDuration) * 8).toFixed(1)}h)
                      </span>
                    )}
                    {extraRanges.length === 0 && currentLeavePolicy.stepRule === 'HALF_DAY_STEP' && (
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

            {extraRanges.length > 0 && (
              <div
                data-testid="leave-range-breakdown"
                className="overflow-hidden rounded-md border border-blue-200 bg-white"
              >
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-blue-50 text-left text-slate-600">
                      <th className="px-2.5 py-1.5 font-semibold">Khoản</th>
                      <th className="px-2.5 py-1.5 font-semibold">Thời gian</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Số ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      {
                        id: 'main',
                        fromAt: leaveFromAt,
                        toAt: leaveToAt,
                        days: parseFloat(leaveDuration) || 0,
                        pending: false,
                        error: null as string | null,
                      },
                      ...extraRanges.map((r) => ({
                        id: r.id,
                        fromAt: r.fromAt,
                        toAt: r.toAt,
                        days: r.preview?.totalDays ?? 0,
                        pending: !r.preview,
                        error: r.preview?.errors[0] ?? null,
                      })),
                    ].map((row, i) => (
                      <tr key={row.id} data-testid={`leave-range-row-${i + 1}`}>
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-slate-800">
                          {rangeLabel(i, 'leave')}
                        </td>
                        <td className="px-2.5 py-1.5 text-slate-600">
                          {row.fromAt && row.toAt
                            ? `${shortRangeTime(row.fromAt)} - ${shortRangeTime(row.toAt)}`
                            : 'Chưa chọn thời gian'}
                          {row.error && (
                            <span className="block text-rose-600">{row.error}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono font-bold text-[#021E73]">
                          {row.pending ? '...' : `${row.days} ngày`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-blue-50/60">
                      <td className="px-2.5 py-1.5 font-semibold text-slate-800" colSpan={2}>
                        Tổng cộng
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono font-bold text-[#021E73]">
                        {totalLeaveDays} ngày
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

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
                      {projects.find((p) => p.id === projectId)?.code ||
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
                    const prj = projects.find((p) => p.id === val);
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
              employeeId={employeeId}
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
              employeeId={employeeId}
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
              employeeId={employeeId}
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
                    {projects.find((p) => p.id === projectId)
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
                  const prj = projects.find((p) => p.id === val);
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
              employeeId={employeeId}
              fromAt={tripFromAt}
              toAt={tripToAt}
              kind="trip"
              onChange={applyTimeRange(setTripStartTime, setTripEndTime)}
              onPreview={handleTimePreview}
            />
            <ExtraTimeRanges
              kind="trip"
              employeeId={employeeId}
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
                  onChange={(val) => setTripType(val as HrmBusinessTripType)}
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
              projects={projects}
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
                onChange={(val) => setChangeType(val as 'SWAP' | 'CHANGE_SHIFT')}
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
                      {profile.fullName || '----'})
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
                      (Hiện tại: {formatVnDate(profile.dateOfBirth)})
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
                      {profile.gender === 'FEMALE'
                        ? 'Nữ'
                        : profile.gender === 'OTHER'
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
                      (Hiện tại: {profile.identityCardNumber || '----'})
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
                      {formatVnDate(profile.identityCardIssuedDate)})
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
                      {profile.identityCardIssuedPlace || '----'})
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
                      (Hiện tại: {profile.taxCode || '----'})
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
                      {profile.socialInsuranceNumber || '----'})
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
            onUploadFile={(file) => uploadHrmAttachment(employeeId, file)}
          />
        )}

        {/* QUY TRÌNH DUYỆT (Mục 3 Khối 4 trong PLAN) */}
      </div>

      {inline && errorBanner}

      <div
        className={
          inline
            ? 'mt-3 pt-3 border-t border-slate-200 flex items-center justify-end gap-2'
            : 'p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2'
        }
      >
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8"
          onClick={onCancel}
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
    </>
  );
}
