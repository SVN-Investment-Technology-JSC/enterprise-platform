'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HrmAttendance } from '@enterprise-platform/contracts-hrm';
import { Table } from 'antd';
import {
  Clock,
  CheckCircle2,
  LogIn,
  LogOut,
  Laptop,
  FileEdit,
  History,
  AlertCircle,
  Plus,
  Trash2,
  Send,
  Loader2,
  Info,
  LayoutGrid,
} from 'lucide-react';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  MonthlyAttendanceMatrixTable,
  type MatrixLeaveRequest,
} from '../ui/monthly-attendance-matrix-table';

type TimeContext = {
  employeeId: string;
  workDate: string;
  timezone: string;
  requireGps: boolean;
  shift: {
    window: {
      start: string;
      end: string;
      graceLateMinutes: number;
      graceEarlyMinutes: number;
    };
  } | null;
};
export default function AttendancePage() {
  const [rows, setRows] = useState<HrmAttendance[]>([]);
  const [context, setContext] = useState<TimeContext | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<MatrixLeaveRequest[]>([]);
  const [viewMode, setViewMode] = useState<'MATRIX' | 'TABLE'>('MATRIX');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'correction' | 'device' | null>(null);
  const [date, setDate] = useState('');
  const [sessions, setSessions] = useState([{ start: '', end: '' }]);
  const [profile, setProfile] = useState<{
    employeeCode?: string;
    fullName?: string;
    department?: string;
    position?: string;
  } | null>(null);
  const eventKey = useRef<string | null>(null);

  // Bộ chọn Tháng/Năm chung cho cả 2 chế độ xem (mặc định tháng hiện tại)
  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  // Danh sách tùy chọn tháng (6 tháng trước + các tháng tương lai gần)
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
            y === currentY && m === now.getMonth() + 1 ? 'Kỳ hiện tại' : undefined,
        });
      }
    }
    return opts;
  }, [now]);

  const selectedMonthString = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  const handleMonthChange = (val?: string) => {
    if (!val) return;
    const [yStr, mStr] = val.split('-');
    setSelectedYear(parseInt(yStr, 10));
    setSelectedMonth(parseInt(mStr, 10));
  };

  // Bộ lọc phụ cho chế độ xem bảng nhật ký chi tiết
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

  // Lọc dữ liệu hàng cho bảng nhật ký (luôn áp dụng selectedMonthString)
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const workDateStr = String(r.workDate).slice(0, 10);
      // Đồng bộ filter theo tháng/năm đã chọn
      if (!workDateStr.startsWith(selectedMonthString)) {
        return false;
      }
      if (filterStatus !== 'ALL' && r.status !== filterStatus) {
        return false;
      }
      if (filterDateFrom && workDateStr < filterDateFrom) {
        return false;
      }
      if (filterDateTo && workDateStr > filterDateTo) {
        return false;
      }
      return true;
    });
  }, [rows, selectedMonthString, filterStatus, filterDateFrom, filterDateTo]);

  // Danh sách trạng thái điểm danh
  const statusFilterOptions: SearchableSelectOption[] = [
    { value: 'ALL', label: 'Tất cả trạng thái' },
    { value: 'VALID', label: 'Hợp lệ (VALID)' },
    { value: 'NORMAL', label: 'Bình thường (NORMAL)' },
    { value: 'LATE', label: 'Đi trễ (LATE)' },
    { value: 'EARLY_LEAVE', label: 'Về sớm (EARLY_LEAVE)' },
    { value: 'ABNORMAL', label: 'Bất thường (ABNORMAL)' },
    { value: 'ADJUSTED', label: 'Đã giải trình (ADJUSTED)' },
    { value: 'ABSENT', label: 'Vắng mặt (ABSENT)' },
    { value: 'LEAVE', label: 'Nghỉ phép (LEAVE)' },
    { value: 'HOLIDAY', label: 'Nghỉ lễ (HOLIDAY)' },
  ];
  const load = useCallback(async () => {
    const [attendance, current, leavesRes, profileRes] = await Promise.all([
      hrmFetch<{ data: HrmAttendance[] }>('/my-attendance'),
      hrmFetch<{ data: TimeContext }>('/my-attendance-context'),
      hrmFetch<{ data: MatrixLeaveRequest[] }>('/leave-requests').catch(() => ({ data: [] })),
      hrmFetch<{ data: { employeeCode?: string; fullName?: string; department?: string; position?: string } }>('/my-profile').catch(() => null),
    ]);
    setRows(attendance.data);
    setContext(current.data);
    setLeaveRequests(leavesRes?.data || []);
    if (profileRes?.data) {
      setProfile(profileRes.data);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  const current = rows.find((row) => row.workDate === context?.workDate);
  const open = current?.calculationSnapshot?.openSession === true;
  const format = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleString('vi-VN', {
          timeZone: context?.timezone || 'Asia/Ho_Chi_Minh',
        })
      : '—';
  async function punch(kind: 'check-in' | 'check-out') {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let position: Record<string, number> = {};
      if (context?.requireGps) {
        if (!navigator.geolocation)
          throw new Error('Trình duyệt không hỗ trợ định vị');
        const gps = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () =>
              reject(
                new Error(
                  'Không lấy được GPS. Hãy cấp quyền vị trí và thử lại.',
                ),
              ),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
        );
        position = {
          latitude: gps.coords.latitude,
          longitude: gps.coords.longitude,
          accuracy: gps.coords.accuracy,
        };
      }
      eventKey.current ||= crypto.randomUUID();
      await hrmFetch(`/attendance/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          ...position,
          externalEventId: eventKey.current,
        }),
      });
      eventKey.current = null;
      await load();
      setMessage(
        kind === 'check-in' ? 'Đã ghi nhận lượt vào.' : 'Đã ghi nhận lượt ra.',
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Không ghi nhận được chấm công',
      );
    } finally {
      setBusy(false);
    }
  }
  const attendanceStatusBadge: Record<string, string> = {
    NORMAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ABNORMAL: 'bg-red-50 text-red-700 border-red-200',
    ADJUSTED: 'bg-purple-50 text-purple-700 border-purple-200',
    LEAVE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    HOLIDAY: 'bg-amber-50 text-amber-700 border-amber-200',
    OFF: 'bg-slate-100 text-slate-600 border-slate-200',
    ABSENT: 'bg-rose-50 text-rose-700 border-rose-200',
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Chấm công Cá nhân & Lịch sử Điểm danh
            </h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
              {context?.workDate ? `Ngày công: ${context.workDate}` : 'Tự phục vụ'}
            </Badge>
          </div>
          <p className="text-xs text-slate-500 max-w-[85ch]">
            Theo dõi từng lượt vào/ra, đối chiếu thời lượng công thực tế so với ca làm việc và gửi giải trình khi có bất thường.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs font-semibold text-green-800 shadow-xs flex items-center gap-2"
        >
          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
          <span>{message}</span>
        </div>
      )}

      {/* 2. Punch Action Hero Cards: TÁCH RỜI 2 THẺ VÀO VÀ RA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* THẺ 1: GHI NHẬN VÀO CA */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                <LogIn className="size-6" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                  Lượt vào ca
                </span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Ghi nhận Vào (Check-in)
                </h2>
              </div>
            </div>
            {current?.checkInAt ? (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold">
                Đã vào: {format(current.checkInAt).slice(-8)}
              </Badge>
            ) : (
              <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs font-medium">
                Chưa vào
              </Badge>
            )}
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-600">
              <span>Bắt đầu ca chuẩn:</span>
              <strong className="text-slate-900 font-mono">
                {context?.shift ? format(context.shift.window.start) : 'Chưa phân ca'}
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Cho phép trễ tối đa:</span>
              <span className="font-semibold text-amber-600">
                {context?.shift?.window.graceLateMinutes || 0} phút
              </span>
            </div>
            {current?.lateMinutes ? (
              <div className="flex items-center justify-between text-rose-600 font-semibold pt-1 border-t border-slate-200/50">
                <span>Ghi nhận đi trễ:</span>
                <span>{current.lateMinutes} phút</span>
              </div>
            ) : null}
          </div>

          <div className="pt-2">
            <Button
              permission="hrm.self.attendance"
              disabled={busy || !context?.shift || open}
              onClick={() => void punch('check-in')}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:cursor-not-allowed"
            >
              <LogIn className="size-4" />
              <span>Ghi nhận lượt Vào</span>
            </Button>
          </div>
        </div>

        {/* THẺ 2: GHI NHẬN RA CA */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                <LogOut className="size-6" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  Lượt ra ca
                </span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  Ghi nhận Ra (Check-out)
                </h2>
              </div>
            </div>
            {current?.checkOutAt ? (
              <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
                Đã ra: {format(current.checkOutAt).slice(-8)}
              </Badge>
            ) : (
              <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs font-medium">
                {open ? 'Đang trong ca' : 'Chưa quẹt ra'}
              </Badge>
            )}
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-600">
              <span>Kết thúc ca chuẩn:</span>
              <strong className="text-slate-900 font-mono">
                {context?.shift ? format(context.shift.window.end) : 'Chưa phân ca'}
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Tổng phút công hôm nay:</span>
              <strong className="font-mono text-emerald-700">
                {current?.workedMinutes || 0} phút
              </strong>
            </div>
            {current?.earlyMinutes ? (
              <div className="flex items-center justify-between text-amber-600 font-semibold pt-1 border-t border-slate-200/50">
                <span>Ghi nhận về sớm:</span>
                <span>{current.earlyMinutes} phút</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              permission="hrm.self.attendance"
              disabled={busy || !context?.shift || !open}
              onClick={() => void punch('check-out')}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:cursor-not-allowed"
            >
              <LogOut className="size-4" />
              <span>Ghi nhận lượt Ra</span>
            </Button>
            <Button
              permission="hrm.self.request"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDate(context?.workDate || '');
                setSessions([{ start: '', end: '' }]);
                setDialog('correction');
              }}
              className="flex items-center gap-1.5 text-xs h-9.5 border-slate-200 hover:bg-slate-50"
              title="Gửi giải trình công nếu quên quẹt thẻ hoặc máy quét lỗi"
            >
              <FileEdit className="size-3.5 text-slate-600" />
              <span>Giải trình</span>
            </Button>
            <Button
              permission="hrm.self.attendance"
              variant="outline"
              disabled={busy}
              onClick={() => setDialog('device')}
              className="flex items-center gap-1.5 text-xs h-9.5 border-slate-200 hover:bg-slate-50"
              title="Đăng ký trình duyệt cá nhân này với phòng nhân sự"
            >
              <Laptop className="size-3.5 text-slate-600" />
              <span className="hidden sm:inline">Trình duyệt</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 3. Lịch sử chấm công: Thẻ hợp nhất (Unified Card) cho cả Ma trận tháng và Nhật ký quẹt thẻ */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        {/* ========================================================= */}
        {/* SHARED HEADER: Tiêu đề, Chuyển chế độ xem & Bộ chọn tháng   */}
        {/* ========================================================= */}
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                {viewMode === 'MATRIX' ? (
                  <>
                    <LayoutGrid className="size-4 text-blue-600" />
                    <span>Bảng chấm công ma trận cá nhân theo tháng</span>
                  </>
                ) : (
                  <>
                    <History className="size-4 text-blue-600" />
                    <span>Lịch sử quẹt thẻ chi tiết</span>
                  </>
                )}
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              {viewMode === 'MATRIX'
                ? 'Dữ liệu công ghi nhận theo từng ngày trong tháng. Nhấp vào ô bất kỳ để xem chi tiết giờ vào/ra.'
                : `Danh sách các lượt quẹt thẻ chi tiết trong tháng ${String(selectedMonth).padStart(2, '0')}/${selectedYear}.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Bộ nút chuyển chế độ xem đưa lên Header */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('MATRIX')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  viewMode === 'MATRIX'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="size-3.5" />
                <span>Bảng công ma trận</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  viewMode === 'TABLE'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <History className="size-3.5" />
                <span>Nhật ký quẹt thẻ</span>
              </button>
            </div>

            {/* Filter Tháng/Năm dùng chung cho cả 2 chế độ xem */}
            <div className="w-[185px]">
              <SearchableSelect
                placeholder="Chọn kỳ tháng..."
                options={monthOptions}
                value={selectedMonthString}
                onChange={handleMonthChange}
                className="h-8.5"
              />
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* BODY: Ma trận tháng HOẶC Nhật ký quẹt thẻ                */}
        {/* ========================================================= */}
        {viewMode === 'MATRIX' ? (
          <MonthlyAttendanceMatrixTable
            title="Bảng chấm công ma trận cá nhân theo tháng"
            employees={[
              {
                employeeId: context?.employeeId || 'my-account',
                employeeCode: profile?.employeeCode || 'ME',
                fullName: profile?.fullName || 'Lịch sử chấm công của tôi',
                department: profile?.department || 'Ban Điều hành',
                position: profile?.position || 'Quản trị viên',
              },
            ]}
            attendances={rows.map((r) => ({
              id: r.id,
              employeeId: context?.employeeId || r.employeeId,
              workDate: r.workDate,
              checkInAt: r.checkInAt,
              checkOutAt: r.checkOutAt,
              status: r.status,
              workedMinutes: r.workedMinutes,
              note: r.note,
            }))}
            leaveRequests={leaveRequests}
            isSingleEmployeeMode={true}
            year={selectedYear}
            month={selectedMonth}
            onYearMonthChange={(y, m) => {
              setSelectedYear(y);
              setSelectedMonth(m);
            }}
            embedded={true}
            hideHeader={true}
            hideFooter={true}
            onExplainRequest={(_, targetDate) => {
              setDate(targetDate);
              setSessions([{ start: '', end: '' }]);
              setDialog('correction');
            }}
          />
        ) : (
          <div className="flex flex-col">
            {/* Toolbar Bộ lọc phụ riêng của Nhật ký: Trạng thái & Khoảng ngày */}
            <div className="p-3.5 border-b border-slate-200 bg-slate-50/70">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                {/* Lọc theo trạng thái */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Trạng thái điểm danh
                  </label>
                  <SearchableSelect
                    options={statusFilterOptions}
                    value={filterStatus}
                    onChange={(val) => setFilterStatus(val || 'ALL')}
                    placeholder="Lọc trạng thái..."
                    className="h-8"
                  />
                </div>

                {/* Lọc từ ngày */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Từ ngày
                  </label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="h-8 text-xs font-mono bg-white"
                  />
                </div>

                {/* Lọc đến ngày + Nút xóa nhanh */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-600">
                      Đến ngày
                    </label>
                    {(filterStatus !== 'ALL' || filterDateFrom || filterDateTo) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterStatus('ALL');
                          setFilterDateFrom('');
                          setFilterDateTo('');
                        }}
                        className="text-[10px] text-blue-600 hover:underline font-medium cursor-pointer"
                      >
                        Xóa bộ lọc
                      </button>
                    )}
                  </div>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="h-8 text-xs font-mono bg-white"
                  />
                </div>
              </div>
            </div>

            <Table<HrmAttendance>
              rowKey="id"
              dataSource={filteredRows}
              size="small"
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                showTotal: (t, range) =>
                  `Hiển thị ${range[0]}–${range[1]} / ${t} ngày công`,
              }}
              scroll={{ x: 1000 }}
              columns={[
                {
                  title: 'Ngày công',
                  dataIndex: 'workDate',
                  render: (v) => <strong className="font-mono text-slate-900">{v}</strong>,
                },
                {
                  title: 'Vào đầu',
                  render: (_, r) => (
                    <span className="text-xs text-slate-700">{format(r.checkInAt)}</span>
                  ),
                },
                {
                  title: 'Ra cuối',
                  render: (_, r) => (
                    <span className="text-xs text-slate-700">{format(r.checkOutAt)}</span>
                  ),
                },
                {
                  title: 'Phút công',
                  dataIndex: 'workedMinutes',
                  render: (v) => (
                    <span className="font-mono font-semibold text-emerald-700">{v || 0}</span>
                  ),
                },
                {
                  title: 'Phút ca',
                  dataIndex: 'scheduledMinutes',
                  render: (v) => <span className="font-mono text-slate-600">{v || 0}</span>,
                },
                {
                  title: 'Trễ / Sớm',
                  render: (_, r) => (
                    <span className="font-mono text-xs text-slate-600">
                      {r.lateMinutes || 0} / {r.earlyMinutes || 0}
                    </span>
                  ),
                },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (s) => (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        attendanceStatusBadge[s] ||
                        'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {s === 'ADJUSTED' ? 'CC (Đã duyệt)' : s}
                    </span>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (r) => (
                  <div className="space-y-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-700">
                    <p>
                      <strong>Bất thường:</strong>{' '}
                      {(
                        r.calculationSnapshot?.anomalies as string[] | undefined
                      )?.join(', ') || 'Không phát hiện bất thường'}
                    </p>
                    {(
                      r.calculationSnapshot?.sessions as
                        | { start: string; end: string }[]
                        | undefined
                    )?.map((s, i) => (
                      <p key={`${s.start}-${i}`}>
                        <strong>Lượt {i + 1}:</strong> {format(s.start)} → {format(s.end)}
                      </p>
                    ))}
                  </div>
                ),
              }}
            />
          </div>
        )}

        {/* ========================================================= */}
        {/* SHARED FOOTER: Chú thích ký hiệu & Thông tin tổng hợp      */}
        {/* ========================================================= */}
        <div className="border-t border-slate-200 bg-slate-50/70 p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200">
            <span className="font-semibold text-slate-800 mr-1">Ký hiệu chấm công:</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold">CC</span>
            <span className="text-slate-500 mr-1">Có chấm công</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-mono font-bold">Trễ</span>
            <span className="text-slate-500 mr-1">Đi trễ</span>
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-mono font-bold">BT</span>
            <span className="text-slate-500 mr-1">Bất thường / Thiếu quẹt</span>
            <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-mono font-bold">P</span>
            <span className="text-slate-500 mr-1">Nghỉ phép</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono font-bold">KL</span>
            <span className="text-slate-500 mr-1">Không lương</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-slate-200 font-mono font-bold">—</span>
            <span className="text-slate-500">Chưa có dữ liệu</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
            <span>
              Kỳ công: <strong className="text-slate-800 font-mono">Tháng {String(selectedMonth).padStart(2, '0')}/{selectedYear}</strong>
            </span>
            <span>•</span>
            <span>
              {viewMode === 'MATRIX' ? (
                <>Nhân sự: <strong className="text-slate-800">{profile?.fullName || 'Tôi'}</strong></>
              ) : (
                <>Lượt hiển thị: <strong className="text-slate-800 font-mono">{filteredRows.length}</strong> ngày công</>
              )}
            </span>
          </div>
        </div>
      </div>
      {/* 4. DIALOG ĐĂNG KÝ THIẾT BỊ / TRÌNH DUYỆT CHẤM CÔNG */}
      <Dialog
        open={dialog === 'device'}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-[500px] p-0 flex flex-col overflow-hidden bg-white shadow-2xl rounded-xl">
          <DialogHeader className="p-5 border-b border-slate-200 bg-slate-50/80 flex flex-row items-start gap-3">
            <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100">
              <Laptop className="size-5" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-base font-bold text-slate-900">
                Đăng ký trình duyệt chấm công
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 leading-relaxed">
                Đăng ký định danh của trình duyệt này với phòng Nhân sự để kích hoạt quyền chấm công theo chính sách an toàn.
              </DialogDescription>
            </div>
          </DialogHeader>

          <form
            className="flex flex-col"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await hrmFetch('/time-settings/devices/register', {
                  method: 'POST',
                  body: JSON.stringify({ name: form.get('name') }),
                });
                setMessage('Đã gửi yêu cầu đăng ký trình duyệt; chờ quản lý phê duyệt.');
                setDialog(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Không gửi được yêu cầu');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="p-6 space-y-4 text-xs">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50/70 border border-blue-100 text-blue-800 text-[11px] leading-relaxed">
                <Info className="size-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  Theo quy định an toàn bảo mật, mỗi nhân viên chỉ được sử dụng một trình duyệt đã duyệt để check-in/out. Quản lý sẽ kích hoạt thiết bị sau khi nhận yêu cầu.
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 block text-xs">
                  Tên thiết bị / trình duyệt <span className="text-rose-500">*</span>
                </label>
                <Input
                  name="name"
                  required
                  maxLength={180}
                  placeholder="VD: Laptop Lenovo ThinkPad — Chrome (Cá nhân)"
                  className="text-xs h-9"
                  autoFocus
                />
                <span className="text-[11px] text-slate-400 block">
                  Đặt tên gợi nhớ để người quản lý dễ dàng nhận diện và phê duyệt nhanh chóng.
                </span>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(null)}
                className="text-xs h-8"
              >
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                <span>{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. DIALOG GIẢI TRÌNH CÔNG & BỔ SUNG GIỜ LÀM */}
      <Dialog
        open={dialog === 'correction'}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] p-0 flex flex-col overflow-hidden bg-white shadow-2xl rounded-xl">
          <DialogHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80 flex flex-row items-start gap-3">
            <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 border border-blue-100">
              <FileEdit className="size-5" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-base font-bold text-slate-900">
                Gửi giải trình công & Bổ sung giờ làm
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 leading-relaxed">
                Khai báo giờ vào/ra thực tế khi có sự cố quên chấm công, thiết bị quét lỗi hoặc cần điều chỉnh thời lượng ca làm việc.
              </DialogDescription>
            </div>
          </DialogHeader>

          <form
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await hrmFetch('/attendance-corrections', {
                  method: 'POST',
                  body: JSON.stringify({
                    employeeId: context?.employeeId,
                    requestDate: date,
                    reason: form.get('reason'),
                    sessions: sessions.map((s) => ({
                      start: new Date(s.start).toISOString(),
                      end: new Date(s.end).toISOString(),
                    })),
                  }),
                });
                setMessage('Đã gửi giải trình công; chờ quản lý phê duyệt.');
                setDialog(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Không gửi được yêu cầu');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 block text-xs">
                    Ngày công cần giải trình <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-500 block text-xs">
                    Múi giờ hệ thống
                  </label>
                  <div className="h-9 px-3 flex items-center text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-700">
                    {context?.timezone || 'Asia/Ho_Chi_Minh'} (GMT+7)
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <span className="font-semibold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5">
                    <Clock className="size-3.5 text-blue-600" />
                    Các lượt vào / ra thực tế ({sessions.length})
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={sessions.length >= 12}
                    onClick={() => setSessions([...sessions, { start: '', end: '' }])}
                    className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 font-medium"
                  >
                    <Plus className="size-3 mr-1" />
                    Thêm lượt
                  </Button>
                </div>

                <p className="text-[11px] text-slate-400">
                  Khai báo đầy đủ các mốc giờ làm việc thực tế trong ngày theo giờ địa phương của thiết bị.
                </p>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {sessions.map((s, i) => (
                    <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-700">Lượt vào/ra {i + 1}</span>
                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setSessions(sessions.filter((_, j) => j !== i))}
                            className="text-rose-500 hover:text-rose-700 text-xs flex items-center gap-1 hover:underline cursor-pointer"
                          >
                            <Trash2 className="size-3" />
                            Xóa
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <span className="text-[11px] text-slate-500 block mb-1">Giờ vào thực tế *</span>
                          <Input
                            type="datetime-local"
                            required
                            value={s.start}
                            className="text-xs h-8 bg-white font-mono"
                            onChange={(e) =>
                              setSessions(sessions.map((v, j) => (j === i ? { ...v, start: e.target.value } : v)))
                            }
                          />
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-500 block mb-1">Giờ ra thực tế *</span>
                          <Input
                            type="datetime-local"
                            required
                            value={s.end}
                            className="text-xs h-8 bg-white font-mono"
                            onChange={(e) =>
                              setSessions(sessions.map((v, j) => (j === i ? { ...v, end: e.target.value } : v)))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 block text-xs">
                  Lý do giải trình <span className="text-rose-500">*</span>
                </label>
                <textarea
                  name="reason"
                  required
                  maxLength={2000}
                  rows={3}
                  placeholder="Ghi rõ lý do (VD: Quên quẹt thẻ khi đến, máy quét lỗi nhận diện, phải ra ngoài gặp đối tác đột xuất...)"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-2xs placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 resize-none min-h-[72px]"
                />
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(null)}
                className="text-xs h-8"
              >
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                <span>{busy ? 'Đang gửi…' : 'Gửi giải trình'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
