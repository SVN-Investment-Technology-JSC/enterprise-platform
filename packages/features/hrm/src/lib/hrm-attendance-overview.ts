interface ObservedAttendance {
  id: string;
  status: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number;
}
interface ObservedLeave {
  status: string;
  isPaid?: boolean;
  duration?: number;
  leaveTypeCode?: string;
}

/**
 * An attendance overview describes observations with standardized symbols:
 * 1: Đi làm đủ ngày (hợp lệ)
 * 0.5: Đi làm nửa ngày / thứ 7
 * 1p: Nghỉ phép năm (hưởng lương)
 * 0.5p: Nghỉ nửa ngày phép
 * KL: Nghỉ không lương
 * 1S: Đã điều chỉnh / có giải trình công được chấp thuận
 * 0: Vắng mặt / Chưa quẹt thẻ
 * —: Ngày chưa tới hoặc chưa có dữ liệu
 */
export function attendanceOverviewCell(
  att: ObservedAttendance | undefined,
  leave: ObservedLeave | undefined,
  isWeekend = false,
  isSaturday = false,
  isFuture = false,
  isToday = false,
) {
  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        })
      : '—';

  const base = {
    inTime: time(att?.checkInAt),
    outTime: time(att?.checkOutAt),
    workHours: Math.max(0, Number(att?.workedMinutes ?? 0)) / 60,
    recordedDay: att?.checkInAt ? 1 : 0,
    attId: att?.id || null,
    isLeave: false,
    leaveStatus: null as string | null,
    isAdjusted: false,
  };

  // 1. Ưu tiên kiểm tra đơn nghỉ phép (Leave)
  if (leave?.status === 'APPROVED') {
    const isUnpaid =
      leave.isPaid === false ||
      (leave.leaveTypeCode &&
        ['UNPAID', 'KL', 'KP', 'RO'].includes(leave.leaveTypeCode.toUpperCase()));

    if (isUnpaid) {
      return {
        ...base,
        isLeave: true,
        leaveStatus: 'APPROVED',
        symbol: (leave.duration ?? 1) <= 0.5 ? '0.5KL' : 'KL',
        badgeText: 'Nghỉ không lương (KL)',
        colorClass: 'text-slate-600 bg-slate-100 font-bold',
      };
    }

    if ((leave.duration ?? 1) <= 0.5) {
      return {
        ...base,
        isLeave: true,
        leaveStatus: 'APPROVED',
        symbol: '0.5p',
        badgeText: 'Nghỉ phép nửa ngày (0.5p)',
        colorClass: 'text-amber-700 bg-amber-50 font-bold',
      };
    }

    return {
      ...base,
      isLeave: true,
      leaveStatus: 'APPROVED',
      symbol: '1p',
      badgeText: 'Nghỉ phép hưởng lương (1p)',
      colorClass: 'text-purple-700 bg-purple-50 font-bold',
    };
  }

  if (leave?.status === 'PENDING') {
    return {
      ...base,
      isLeave: true,
      leaveStatus: 'PENDING',
      symbol: 'Chờ',
      badgeText: 'Đơn nghỉ đang chờ duyệt',
      colorClass: 'text-amber-700 bg-amber-50 font-medium',
    };
  }

  // 2. Ngày nghỉ cuối tuần (Chủ nhật / Thứ 7 không ca)
  if (isWeekend) {
    if (att?.checkInAt) {
      return {
        ...base,
        symbol: '1+',
        badgeText: 'Làm việc ngày nghỉ (OT)',
        colorClass: 'text-rose-700 bg-rose-50 font-bold',
      };
    }
    return {
      ...base,
      symbol: 'OFF',
      badgeText: 'Nghỉ tuần',
      colorClass: 'text-slate-400 bg-slate-100/70 font-semibold',
    };
  }

  // 3. Có bản ghi chấm công thực tế
  if (att?.checkInAt) {
    const isAdjusted =
      att.status === 'ADJUSTED' ||
      att.status === 'CORRECTED';
    if (isAdjusted) {
      return {
        ...base,
        isAdjusted: true,
        symbol: '1S',
        badgeText: 'Công đã được duyệt giải trình bổ sung',
        colorClass: 'text-indigo-700 bg-indigo-50 font-bold',
      };
    }

    const abnormal = ['ABNORMAL', 'MISSING_OUT', 'MISSING_IN'].includes(
      att.status,
    );
    const late = att.status === 'LATE';

    if (isSaturday) {
      return {
        ...base,
        symbol: '0.5',
        badgeText: 'Làm thứ 7 (nửa ngày)',
        colorClass: 'text-blue-700 bg-blue-50/70 font-bold',
      };
    }

    // Nếu là ngày hôm nay và đã quẹt vào nhưng chưa quẹt ra (đang trong ca làm việc, chưa tính công ngày đó)
    if (isToday && !att.checkOutAt) {
      return {
        ...base,
        symbol: '0',
        badgeText: 'Đang trong ca (Chưa quẹt ra - Chưa tính công)',
        colorClass: 'text-slate-500 bg-slate-100 font-semibold',
      };
    }

    if (abnormal) {
      return {
        ...base,
        symbol: '0.5',
        badgeText: 'Bất thường / thiếu quẹt thẻ',
        colorClass: 'text-red-700 bg-red-50 font-bold',
      };
    }

    return {
      ...base,
      symbol: late ? '1' : '1',
      badgeText: late ? 'Đủ công (Đi trễ)' : 'Đủ công tiêu chuẩn',
      colorClass: late
        ? 'text-amber-700 bg-amber-50 font-bold'
        : 'text-emerald-700 bg-emerald-50/70 font-bold',
    };
  }

  // 4. Chưa có lượt quẹt thẻ
  if (isFuture) {
    return {
      ...base,
      symbol: '—',
      badgeText: 'Chưa tới ngày',
      colorClass: 'text-slate-300 font-light',
    };
  }

  return {
    ...base,
    symbol: '0',
    badgeText: 'Vắng mặt / Không quẹt thẻ',
    colorClass: 'text-rose-600 bg-rose-50/50 font-semibold',
  };
}

