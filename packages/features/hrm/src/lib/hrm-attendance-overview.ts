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
}

/** An attendance overview describes observations, never the payable timesheet. */
export function attendanceOverviewCell(
  att: ObservedAttendance | undefined,
  leave: ObservedLeave | undefined,
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
  };
  if (att?.checkInAt) {
    const abnormal = ['ABNORMAL', 'MISSING_OUT', 'MISSING_IN'].includes(
        att.status,
      ),
      late = att.status === 'LATE';
    return {
      ...base,
      symbol: abnormal ? 'BT' : late ? 'Trễ' : 'CC',
      badgeText: `${abnormal ? 'Bất thường' : late ? 'Đi trễ' : 'Có chấm công'}${leave?.status === 'APPROVED' ? ' · Có đơn nghỉ đã duyệt' : ''}`,
      colorClass: abnormal
        ? 'text-red-700 bg-red-50'
        : late
          ? 'text-amber-700 bg-amber-50'
          : 'text-emerald-700 bg-emerald-50',
    };
  }
  if (leave?.status === 'APPROVED')
    return {
      ...base,
      symbol: leave.isPaid === false ? 'KL' : 'P',
      badgeText: 'Đơn nghỉ đã duyệt; số công lấy từ bảng công kỳ',
      colorClass: 'text-purple-700 bg-purple-50',
    };
  if (leave?.status === 'PENDING')
    return {
      ...base,
      symbol: 'Chờ',
      badgeText: 'Đơn nghỉ chờ duyệt',
      colorClass: 'text-amber-700 bg-amber-50',
    };
  return {
    ...base,
    symbol: '—',
    badgeText: 'Chưa có dữ liệu chấm công; chưa kết luận vắng hoặc OFF',
    colorClass: 'text-slate-400',
  };
}
