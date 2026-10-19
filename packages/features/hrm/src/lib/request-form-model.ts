/**
 * Phần thuần (không React) của form tạo đơn: chính sách lý do nghỉ, số ngày nghỉ theo lịch ca, quỹ phép. Dùng chung cho
 * hộp thoại tạo đơn ở trang Đơn từ và form nhúng trong card của khung chat Trợ lý (xem `CreateRequestForm`).
 */

export interface LeaveTypeItem {
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

export interface ShiftItem {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

/** Quỹ phép của một loại nghỉ như form tạo đơn hiển thị (số đã làm tròn, dạng chuỗi; chưa có là '----'). */
export interface LeaveBalanceView {
  remaining: string;
  entitlement: string;
  advanceAllowed?: boolean;
  advanceHeadroom?: string;
  seniorityDays?: string;
}

/** Một dòng của GET /employees/:id/leave-balances. */
export interface LeaveBalanceRow {
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
}

/** Quỹ phép theo loại nghỉ của nhân viên, khoá là mã loại nghỉ. */
export function leaveBalancesOf(rows: readonly LeaveBalanceRow[]): Record<string, LeaveBalanceView> {
  return Object.fromEntries(
    rows.map((b) => [
      b.leaveTypeId,
      {
        // Server tính sẵn phần được dùng (gồm ứng phép theo chính sách).
        remaining: String(Math.round((b.available ?? Number(b.remaining) - Number(b.pending)) * 100) / 100),
        entitlement:
          b.projectedEntitlement != null ? String(b.projectedEntitlement) : String(b.entitlement ?? '----'),
        advanceAllowed: Boolean(b.advanceAllowed),
        advanceHeadroom: String(b.advanceHeadroom ?? 0),
        // Thâm niên cả năm theo chính sách (cột sổ `seniorityDays` chỉ có khi đã cộng).
        seniorityDays: String(Math.max(b.projectedSeniority ?? 0, b.seniorityDays ?? 0)),
      },
    ]),
  );
}
