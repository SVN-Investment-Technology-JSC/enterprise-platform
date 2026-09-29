'use client';
import { attendanceOverviewCell } from '../hrm-attendance-overview';

import {
  Calendar,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Search,
} from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { Button } from './button';
import { toast } from './toast';

export interface MatrixEmployee {
  employeeId: string;
  employeeCode: string;
  fullName?: string | null;
  department?: string | null;
  position?: string | null;
}

export interface MatrixAttendanceRecord {
  id: string;
  employeeId: string;
  workDate: string; // YYYY-MM-DD
  checkInAt?: string | null;
  checkOutAt?: string | null;
  status: string;
  workedMinutes?: number;
  note?: string | null;
}

export interface MatrixLeaveRequest {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  duration: number;
  status: string;
  leaveTypeCode?: string;
  leaveTypeName?: string;
  isPaid?: boolean;
}
const noLeaves: MatrixLeaveRequest[] = [];

export interface MonthlyAttendanceMatrixTableProps {
  title?: string;
  employees: MatrixEmployee[];
  attendances: MatrixAttendanceRecord[];
  leaveRequests?: MatrixLeaveRequest[];
  isLoading?: boolean;
  isSingleEmployeeMode?: boolean;
  defaultYear?: number;
  defaultMonth?: number; // 1-12
  onYearMonthChange?: (year: number, month: number) => void;
  onExplainRequest?: (attendanceId: string | null, date: string) => void;
}

// Helper: Chuyển đổi timestamp ISO (UTC) hoặc date string sang YYYY-MM-DD theo giờ địa phương Việt Nam
function toLocalDateString(val: string | Date | undefined | null): string {
  if (!val) return '';
  const str = String(val).trim();
  // Nếu đã là định dạng chuẩn YYYY-MM-DD thì giữ nguyên ngày làm việc
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    return str.slice(0, 10);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function MonthlyAttendanceMatrixTable({
  title,
  employees,
  attendances,
  leaveRequests = noLeaves,
  isLoading = false,
  isSingleEmployeeMode = false,
  defaultYear,
  defaultMonth,
  onYearMonthChange,
  onExplainRequest,
}: MonthlyAttendanceMatrixTableProps) {
  // Current active date
  const [now] = useState(() => new Date());
  const [selectedYear, setSelectedYear] = useState<number>(
    defaultYear || now.getFullYear(),
  );
  const [selectedMonth, setSelectedMonth] = useState<number>(
    defaultMonth || now.getMonth() + 1,
  );

  // Sub-tab: Bảng chấm công (ký hiệu công) vs. Chi tiết bảng chấm công (giờ in/out)
  const [matrixViewTab, setMatrixViewTab] = useState<
    'SUMMARY_CODES' | 'DETAILED_HOURS'
  >('SUMMARY_CODES');

  // Search & Department Filter (dành cho chế độ all employees)
  const [searchKeyword, setSearchKeyword] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');

  // Horizontal scroll container ref for wheel scrolling
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Handle horizontal mouse wheel scrolling
  const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  // Month select options (6 tháng gần nhất & 6 tháng tới)
  const monthOptions: SearchableSelectOption[] = useMemo(() => {
    const opts: SearchableSelectOption[] = [];
    const currentY = now.getFullYear();
    for (let y = currentY; y >= currentY - 1; y--) {
      for (let m = 12; m >= 1; m--) {
        const val = `${y}-${String(m).padStart(2, '0')}`;
        opts.push({
          value: val,
          label: `Tháng ${String(m).padStart(2, '0')}/${y}`,
          description:
            y === currentY && m === now.getMonth() + 1
              ? 'Kỳ hiện tại'
              : undefined,
        });
      }
    }
    return opts;
  }, [now]);

  const currentMonthValue = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  const handleMonthChange = (val?: string) => {
    if (!val) return;
    const [yStr, mStr] = val.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    setSelectedYear(y);
    setSelectedMonth(m);
    if (onYearMonthChange) {
      onYearMonthChange(y, m);
    }
  };

  // Generate days array for the selected month
  const daysInMonth = useMemo(() => {
    const daysCount = new Date(selectedYear, selectedMonth, 0).getDate();
    const daysList = [];
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    for (let day = 1; day <= daysCount; day++) {
      const dateObj = new Date(selectedYear, selectedMonth - 1, day);
      const dayOfWeekIndex = dateObj.getDay();
      const dayOfWeekName = dayNames[dayOfWeekIndex];
      const isoDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isWeekend = dayOfWeekIndex === 0; // CN
      const isSaturday = dayOfWeekIndex === 6; // T7

      daysList.push({
        dayNumber: String(day).padStart(2, '0'),
        dayName: dayOfWeekName,
        isoDate,
        isWeekend,
        isSaturday,
      });
    }
    return daysList;
  }, [selectedYear, selectedMonth]);

  // Index attendances by `employeeId_YYYY-MM-DD` (hỗ trợ cả date UTC, local date và wildcard cho chế độ cá nhân)
  const attendanceMap = useMemo(() => {
    const map = new Map<string, MatrixAttendanceRecord>();
    for (const att of attendances) {
      const utcDateStr = String(att.workDate).slice(0, 10);
      const localDateStr = toLocalDateString(att.workDate);

      // Lưu theo employeeId + local date (chuẩn giờ hiển thị)
      map.set(`${att.employeeId}_${localDateStr}`, att);
      // Fallback theo UTC date nếu khác nhau
      if (utcDateStr !== localDateStr) {
        map.set(`${att.employeeId}_${utcDateStr}`, att);
      }

      // Fallback dựa trên checkInAt (giờ quẹt thẻ thực tế của ca làm) nếu có
      if (att.checkInAt) {
        const checkInDate = toLocalDateString(att.checkInAt);
        if (
          checkInDate &&
          checkInDate !== localDateStr &&
          checkInDate !== utcDateStr
        ) {
          map.set(`${att.employeeId}_${checkInDate}`, att);
          if (isSingleEmployeeMode) {
            map.set(`single_${checkInDate}`, att);
          }
        }
      }

      // Nếu ở chế độ cá nhân (isSingleEmployeeMode), lưu thêm theo ngày độc lập để không phụ thuộc lệch ID
      if (isSingleEmployeeMode) {
        map.set(`single_${localDateStr}`, att);
        map.set(`single_${utcDateStr}`, att);
      }
    }
    return map;
  }, [attendances, isSingleEmployeeMode]);

  // Index leave requests by employeeId
  const leaveMap = useMemo(() => {
    const map = new Map<string, MatrixLeaveRequest[]>();
    for (const l of leaveRequests) {
      if (l.status === 'APPROVED' || l.status === 'PENDING') {
        const list = map.get(l.employeeId) || [];
        list.push(l);
        map.set(l.employeeId, list);
        if (isSingleEmployeeMode) {
          const sList = map.get('single') || [];
          sList.push(l);
          map.set('single', sList);
        }
      }
    }
    return map;
  }, [leaveRequests, isSingleEmployeeMode]);

  // Unique departments for filter
  const departmentsList = useMemo(() => {
    const set = new Set<string>();
    for (const emp of employees) {
      if (emp.department) set.add(emp.department);
    }
    return Array.from(set);
  }, [employees]);

  // Filtered employees list
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchSearch =
        !searchKeyword.trim() ||
        (emp.fullName || '')
          .toLowerCase()
          .includes(searchKeyword.toLowerCase()) ||
        (emp.employeeCode || '')
          .toLowerCase()
          .includes(searchKeyword.toLowerCase());
      const matchDept = deptFilter === 'ALL' || emp.department === deptFilter;
      return matchSearch && matchDept;
    });
  }, [employees, searchKeyword, deptFilter]);

  const calculateDayStatus = (empId: string, isoDate: string) => {
    const att =
      attendanceMap.get(empId + '_' + isoDate) ||
      (isSingleEmployeeMode
        ? attendanceMap.get('single_' + isoDate)
        : undefined);
    const leaves =
      leaveMap.get(empId) ||
      (isSingleEmployeeMode ? leaveMap.get('single') : []) ||
      [];
    const matching = leaves.filter(
      (l) =>
        isoDate >= toLocalDateString(l.fromDate) &&
        isoDate <= toLocalDateString(l.toDate),
    );
    const leave = matching.find((l) => l.status === 'APPROVED') || matching[0];
    return attendanceOverviewCell(att, leave);
  };

  const formattedMonthRangeTitle = useMemo(() => {
    if (title) return title;
    const daysCount = new Date(selectedYear, selectedMonth, 0).getDate();
    return `Theo dõi chấm công ${isSingleEmployeeMode ? 'cá nhân' : 'toàn bộ công ty'} từ 01/${String(selectedMonth).padStart(2, '0')}/${selectedYear} đến ${String(daysCount).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`;
  }, [title, selectedYear, selectedMonth, isSingleEmployeeMode]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* ------------------------------------------------------------- */}
      {/* TOP HEADER: TIÊU ĐỀ BẢNG CÔNG, TIẾN TRÌNH & BỘ CHỌN THÁNG      */}
      {/* ------------------------------------------------------------- */}
      <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>{formattedMonthRangeTitle}</span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mt-0.5">
            <span>Dữ liệu chấm công đã ghi nhận.</span>
            <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.2 rounded border border-emerald-200">
              Công hưởng lương được đối soát tại Bảng công tổng hợp
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Select Box Chọn Tháng/Năm xem lại lịch sử */}
          <div className="w-[180px]">
            <SearchableSelect
              placeholder="Chọn kỳ tháng..."
              options={monthOptions}
              value={currentMonthValue}
              onChange={handleMonthChange}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5 border-slate-300 hover:bg-slate-50"
            onClick={() => {
              toast.add({
                title: 'Xuất file Excel',
                description: `Đã xuất bảng chấm công tháng ${selectedMonth}/${selectedYear} định dạng .xlsx`,
                type: 'success',
              });
            }}
          >
            <Download className="size-3.5 text-emerald-700" />
            <span>Export</span>
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUB-TABS: BẢNG CHẤM CÔNG VS. CHI TIẾT BẢNG CHẤM CÔNG            */}
      {/* ------------------------------------------------------------- */}
      <div className="px-4 pt-3 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setMatrixViewTab('SUMMARY_CODES')}
            className={`pb-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
              matrixViewTab === 'SUMMARY_CODES'
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Calendar className="size-3.5" />
            <span>Bảng chấm công</span>
          </button>
          <button
            onClick={() => setMatrixViewTab('DETAILED_HOURS')}
            className={`pb-2.5 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
              matrixViewTab === 'DETAILED_HOURS'
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileSpreadsheet className="size-3.5" />
            <span>Chi tiết bảng chấm công</span>
          </button>
        </div>

        {/* Counter summary */}
        <div className="text-[11px] text-slate-500 pb-2">
          Hiển thị <strong>{filteredEmployees.length}</strong> /{' '}
          <strong>{employees.length}</strong> bản ghi
        </div>
      </div>

      {/* Filter toolbar if in company-wide mode */}
      {!isSingleEmployeeMode && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="size-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm mã hoặc họ tên nhân viên..."
                aria-label="Tìm mã hoặc họ tên nhân viên"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#021E73]"
              />
            </div>
            {departmentsList.length > 0 && (
              <div className="w-[180px]">
                <SearchableSelect
                  placeholder="Lọc phòng ban..."
                  options={[
                    { value: 'ALL', label: 'Tất cả phòng ban' },
                    ...departmentsList.map((d) => ({ value: d, label: d })),
                  ]}
                  value={deptFilter}
                  onChange={(val) => setDeptFilter(val || 'ALL')}
                  clearable
                />
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">
            CC: Có chấm công · BT: Bất thường · P/KL: Nghỉ đã duyệt · Chờ: Đơn
            chờ duyệt · —: Chưa có dữ liệu
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TABLE MATRIX: FROZEN COLUMNS + HORIZONTAL DAYS SCROLL          */}
      {/* ------------------------------------------------------------- */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheelScroll}
        className="overflow-x-auto relative w-full scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        <table className="w-full text-left border-collapse text-xs select-none">
          {/* Table Header */}
          <thead>
            {/* Hàng 1: Tiêu đề cố định & Thứ trong tuần */}
            <tr className="bg-slate-100 text-[11px] font-bold text-slate-600 border-b border-slate-200">
              <th className="sticky left-0 z-30 bg-slate-100 px-3 py-1.5 w-12 border-r border-slate-200 text-center shadow-xs">
                STT
              </th>
              <th className="sticky left-12 z-30 bg-slate-100 px-3 py-1.5 w-24 border-r border-slate-200 text-center shadow-xs">
                Mã NV
              </th>
              <th className="sticky left-36 z-30 bg-slate-100 px-4 py-1.5 w-44 border-r border-slate-200 shadow-xs">
                Họ và tên
              </th>
              <th className="sticky left-80 z-30 bg-slate-100 px-3 py-1.5 w-36 border-r border-slate-200 shadow-xs">
                Phòng ban
              </th>
              <th className="sticky left-[464px] z-30 bg-slate-100 px-3 py-1.5 w-32 border-r border-slate-300 shadow-sm">
                Vị trí
              </th>

              {/* Các cột Thứ */}
              {daysInMonth.map((day) => (
                <th
                  key={`day_header_${day.isoDate}`}
                  className={`text-center px-1.5 py-1 min-w-[42px] border-r border-slate-200 font-semibold ${
                    day.isWeekend
                      ? 'bg-slate-200/90 text-rose-700'
                      : day.isSaturday
                        ? 'bg-blue-50 text-blue-800'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {day.dayName}
                </th>
              ))}

              {/* Cột Tổng hợp */}
              <th className="bg-slate-100 text-center px-2 py-1 min-w-[55px] border-r border-slate-200 font-bold text-[#021E73]">
                Giờ ghi nhận
              </th>
              <th className="bg-slate-100 text-center px-2 py-1 min-w-[55px] font-bold text-emerald-700">
                Ngày có log
              </th>
            </tr>

            {/* Hàng 2: Số ngày trong tháng (01, 02, ..., 30) */}
            <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 border-b border-slate-300 shadow-xs">
              <th
                colSpan={5}
                className="sticky left-0 z-30 bg-slate-50 px-3 py-1 text-slate-400 font-normal border-r border-slate-300"
              >
                Thông tin nhân sự
              </th>

              {daysInMonth.map((day) => (
                <th
                  key={`day_num_${day.isoDate}`}
                  className={`text-center py-1 font-mono border-r border-slate-200 ${
                    day.isWeekend
                      ? 'bg-slate-200/60 text-rose-800 font-bold'
                      : day.isSaturday
                        ? 'bg-blue-50/50 text-blue-900 font-bold'
                        : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  {day.dayNumber}
                </th>
              ))}

              <th className="text-center py-1 font-mono text-[9px] text-slate-500 border-r border-slate-200">
                Giờ
              </th>
              <th className="text-center py-1 font-mono text-[9px] text-slate-500">
                Ngày
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-slate-100 font-medium">
            {isLoading ? (
              <tr>
                <td
                  colSpan={daysInMonth.length + 7}
                  className="py-12 text-center text-slate-400"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="size-5 animate-spin text-[#021E73]" />
                    <span>Đang tổng hợp dữ liệu bảng công ma trận...</span>
                  </div>
                </td>
              </tr>
            ) : filteredEmployees.length === 0 ? (
              <tr>
                <td
                  colSpan={daysInMonth.length + 7}
                  className="py-12 text-center text-slate-400"
                >
                  Không tìm thấy nhân viên nào phù hợp với điều kiện tìm kiếm.
                </td>
              </tr>
            ) : (
              filteredEmployees.map((emp, idx) => {
                let totalRecordedDays = 0,
                  totalRecordedHours = 0;

                return (
                  <tr
                    key={emp.employeeId}
                    className="hover:bg-blue-50/30 transition-colors h-10"
                  >
                    {/* Cột 1: STT (Sticky) */}
                    <td className="sticky left-0 z-20 bg-white group-hover:bg-blue-50 px-2 py-2 text-center text-slate-500 border-r border-slate-200 font-mono text-xs">
                      {idx + 1}
                    </td>

                    {/* Cột 2: Mã NV (Sticky) */}
                    <td className="sticky left-12 z-20 bg-white group-hover:bg-blue-50 px-2.5 py-2 text-center font-mono font-bold text-slate-700 border-r border-slate-200 text-xs">
                      {emp.employeeCode}
                    </td>

                    {/* Cột 3: Họ và tên (Sticky) */}
                    <td className="sticky left-36 z-20 bg-white group-hover:bg-blue-50 px-3.5 py-2 font-bold text-slate-900 border-r border-slate-200 truncate max-w-[176px]">
                      {emp.fullName || emp.employeeCode}
                    </td>

                    {/* Cột 4: Phòng ban (Sticky) */}
                    <td className="sticky left-80 z-20 bg-white group-hover:bg-blue-50 px-3 py-2 text-slate-600 border-r border-slate-200 truncate max-w-[144px] text-xs">
                      {emp.department || '—'}
                    </td>

                    {/* Cột 5: Vị trí (Sticky) */}
                    <td className="sticky left-[464px] z-20 bg-white group-hover:bg-blue-50 px-3 py-2 text-slate-600 border-r border-slate-300 truncate max-w-[128px] text-xs shadow-sm">
                      {emp.position || '—'}
                    </td>

                    {/* Các ô ngày trong tháng */}
                    {daysInMonth.map((day) => {
                      const res = calculateDayStatus(
                        emp.employeeId,
                        day.isoDate,
                      );
                      totalRecordedDays += res.recordedDay;
                      totalRecordedHours += res.workHours;

                      return (
                        <td
                          key={`cell_${emp.employeeId}_${day.isoDate}`}
                          className={`text-center px-1 py-1 border-r border-slate-200 text-xs transition-colors cursor-pointer group/cell relative ${
                            day.isWeekend ? 'bg-slate-100/50' : ''
                          }`}
                          onClick={() => {
                            if (onExplainRequest && res.attId) {
                              onExplainRequest(res.attId, day.isoDate);
                            }
                          }}
                          tabIndex={
                            onExplainRequest && res.attId ? 0 : undefined
                          }
                          onKeyDown={(event) => {
                            if (
                              onExplainRequest &&
                              res.attId &&
                              (event.key === 'Enter' || event.key === ' ')
                            ) {
                              event.preventDefault();
                              onExplainRequest(res.attId, day.isoDate);
                            }
                          }}
                          title={`${day.dayName} ${day.dayNumber}/${selectedMonth}: ${res.badgeText} (${res.inTime} - ${res.outTime})`}
                        >
                          {matrixViewTab === 'SUMMARY_CODES' ? (
                            <div className="flex items-center justify-center">
                              <span
                                className={`inline-flex items-center justify-center size-6 rounded-md text-xs font-mono transition-transform group-hover/cell:scale-110 ${res.colorClass}`}
                              >
                                {res.symbol}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-[9px] font-mono leading-tight py-0.5">
                              <span className="text-emerald-700 font-bold">
                                {res.inTime}
                              </span>
                              <span className="text-slate-500">
                                {res.outTime}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Cột Tổng công chuẩn */}
                    <td className="text-center font-mono font-bold text-slate-700 px-2 py-2 bg-slate-50 border-r border-slate-200">
                      {Math.round(totalRecordedHours * 100) / 100}
                    </td>

                    {/* Cột Tổng công thực tế */}
                    <td className="text-center font-mono font-bold text-emerald-700 px-2 py-2 bg-emerald-50/50">
                      {totalRecordedDays}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* BOTTOM FOOTER: HƯỚNG DẪN CON LĂN & TỔNG QUAN                   */}
      {/* ------------------------------------------------------------- */}
      <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Info className="size-3.5 text-blue-700 shrink-0" />
          <span>
            <strong>Mẹo:</strong> Bạn có thể sử dụng{' '}
            <strong>con lăn chuột</strong> hoặc touchpad để cuộn ngang danh sách
            30/31 ngày. Mỗi nhân sự là 1 hàng duy nhất.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span>
            Tổng số nhân sự hiển thị:{' '}
            <strong>{filteredEmployees.length}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
