/**
 * Ô ma trận dựng từ BẢNG CÔNG (timesheet) thay vì từ lượt quẹt thẻ.
 * Bảng công không có giờ vào/ra nên các ô giờ luôn là "—" (không bịa dữ liệu).
 */
export interface MatrixCell {
  inTime: string;
  outTime: string;
  workHours: number;
  recordedDay: number;
  attId: string | null;
  isLeave: boolean;
  leaveStatus: string | null;
  isAdjusted: boolean;
  symbol: string;
  badgeText: string;
  colorClass: string;
}

export interface TimesheetCellInput {
  id: string;
  status: string;
  workedMinutes?: number;
  workdayUnits?: number;
}

export const TIMESHEET_MATRIX_LEGEND =
  'CC: Đi làm · P: Nghỉ phép · L: Nghỉ lễ · CT: Công tác · BT: Bất thường · V: Vắng · OFF: Ngày nghỉ · —: Chưa có dữ liệu';

const NONE = '—';

export function timesheetMatrixCell(
  record: TimesheetCellInput | undefined,
  isFuture = false,
): MatrixCell {
  const base = {
    inTime: NONE,
    outTime: NONE,
    workHours: Math.max(0, Number(record?.workedMinutes ?? 0)) / 60,
    recordedDay: Math.max(0, Number(record?.workdayUnits ?? 0)),
    attId: record?.id ?? null,
    isLeave: false,
    leaveStatus: null as string | null,
    isAdjusted: false,
  };
  if (!record) {
    return {
      ...base,
      recordedDay: 0,
      symbol: NONE,
      badgeText: isFuture ? 'Chưa tới ngày' : 'Chưa có dữ liệu bảng công',
      colorClass: isFuture ? 'text-slate-300 font-light' : 'text-slate-400',
    };
  }
  switch (record.status) {
    case 'NORMAL':
      return {
        ...base,
        symbol: 'CC',
        badgeText: 'Đi làm',
        colorClass: 'text-emerald-700 bg-emerald-50/70 font-bold',
      };
    case 'ADJUSTED':
      return {
        ...base,
        isAdjusted: true,
        symbol: 'CC',
        badgeText: 'Công đã được điều chỉnh',
        colorClass: 'text-indigo-700 bg-indigo-50 font-bold',
      };
    case 'LEAVE':
      return {
        ...base,
        isLeave: true,
        leaveStatus: 'APPROVED',
        symbol: 'P',
        badgeText: 'Nghỉ phép',
        colorClass: 'text-purple-700 bg-purple-50 font-bold',
      };
    case 'HOLIDAY':
      return {
        ...base,
        symbol: 'L',
        badgeText: 'Nghỉ lễ',
        colorClass: 'text-amber-700 bg-amber-50 font-bold',
      };
    case 'BUSINESS_TRIP':
      return {
        ...base,
        symbol: 'CT',
        badgeText: 'Công tác',
        colorClass: 'text-blue-700 bg-blue-50 font-bold',
      };
    case 'ABNORMAL':
      return {
        ...base,
        symbol: 'BT',
        badgeText: 'Bất thường',
        colorClass: 'text-red-700 bg-red-50 font-bold',
      };
    case 'ABSENT':
      return {
        ...base,
        symbol: 'V',
        badgeText: 'Vắng mặt',
        colorClass: 'text-rose-700 bg-rose-50 font-bold',
      };
    case 'OFF':
      return {
        ...base,
        symbol: 'OFF',
        badgeText: 'Ngày nghỉ',
        colorClass: 'text-slate-500 bg-slate-100 font-semibold',
      };
    default:
      return {
        ...base,
        symbol: NONE,
        badgeText: 'Trạng thái khác',
        colorClass: 'text-slate-400',
      };
  }
}

export interface MatrixExportEmployee {
  employeeCode: string;
  fullName?: string | null;
  department?: string | null;
  position?: string | null;
}

/** Dựng các dòng CSV của ma trận đang hiển thị (đưa qua buildCsv ở hrm-csv). */
export function buildMatrixCsvRows(input: {
  employees: readonly MatrixExportEmployee[];
  days: readonly { dayNumber: string; dayName: string }[];
  cellFor: (employeeIndex: number, dayIndex: number) => MatrixCell;
  totalLabels: readonly [string, string];
}): unknown[][] {
  const header: unknown[] = [
    'STT',
    'Mã NV',
    'Họ và tên',
    'Phòng ban',
    'Vị trí',
    ...input.days.map((d) => `${d.dayNumber} (${d.dayName})`),
    input.totalLabels[0],
    input.totalLabels[1],
  ];
  const body = input.employees.map((emp, ei) => {
    let hours = 0;
    let days = 0;
    const symbols = input.days.map((_, di) => {
      const cell = input.cellFor(ei, di);
      hours += cell.workHours;
      days += cell.recordedDay;
      return cell.symbol === NONE ? '' : cell.symbol;
    });
    return [
      ei + 1,
      emp.employeeCode,
      emp.fullName || emp.employeeCode,
      emp.department ?? '',
      emp.position ?? '',
      ...symbols,
      Math.round(hours * 100) / 100,
      Math.round(days * 100) / 100,
    ];
  });
  return [header, ...body];
}
