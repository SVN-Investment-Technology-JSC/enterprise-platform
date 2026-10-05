'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HrmDashboardOverview } from '@enterprise-platform/contracts-hrm';
import {
  UserCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  FileText,
  FileCheck2,
  ChevronRight,
  Inbox,
  FileSpreadsheet,
  Banknote,
  LogIn,
  LogOut,
  Sliders,
  ShieldCheck,
  Workflow,
  Sparkles,
  ArrowRight,
  Loader2,
  RefreshCw,
  Coins,
} from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

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

export default function HrmDashboardPage() {
  const { can } = useHrmPermissions();
  const showOverview = can('hrm.dashboard.read');
  const [data, setData] = useState<HrmDashboardOverview | null>(null);
  const [error, setError] = useState('');
  const [, setLoading] = useState(true);

  // User Quick Punch State
  const [punchContext, setPunchContext] = useState<TimeContext | null>(null);
  const [punchBusy, setPunchBusy] = useState(false);
  const [punchMessage, setPunchMessage] = useState('');
  const [punchError, setPunchError] = useState('');
  const [lastPunchTime, setLastPunchTime] = useState<string | null>(null);
  const eventKey = useRef<string | null>(null);

  // Period / Payroll Summary Status
  const [periodSummary, setPeriodSummary] = useState<{
    openTimesheets: number;
    lockedTimesheets: number;
    openPayrolls: number;
  }>({ openTimesheets: 0, lockedTimesheets: 0, openPayrolls: 0 });

  // 1. Tải dữ liệu Dashboard Overview
  const loadOverview = useCallback(async () => {
    if (!showOverview) return;
    try {
      const res = await hrmFetch<{ data: HrmDashboardOverview }>('/dashboard/overview');
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi tải tổng quan');
    } finally {
      setLoading(false);
    }
  }, [showOverview]);

  // 2. Tải ngữ cảnh Chấm công User
  const loadPunchContext = useCallback(async () => {
    try {
      const res = await hrmFetch<{ data: TimeContext }>('/attendance/context');
      setPunchContext(res.data);
    } catch {
      // Bỏ qua nếu tài khoản chưa liên kết hồ sơ nhân viên
    }
  }, []);

  // 3. Tải kỳ công / kỳ lương
  const loadPeriodsStats = useCallback(async () => {
    try {
      const [tsRes, prRes] = await Promise.all([
        hrmFetch<{ data: { status: string }[] }>('/timesheet-periods'),
        hrmFetch<{ data: { status: string }[] }>('/payroll-periods'),
      ]);
      setPeriodSummary({
        openTimesheets: tsRes.data.filter((p) => p.status === 'OPEN').length,
        lockedTimesheets: tsRes.data.filter((p) => p.status === 'LOCKED').length,
        openPayrolls: prRes.data.filter((p) => p.status === 'OPEN').length,
      });
    } catch {
      // Dự phòng nếu không có quyền
    }
  }, []);

  useEffect(() => {
    if (showOverview) {
      void loadOverview();
      void loadPeriodsStats();
    } else {
      setLoading(false);
    }
    void loadPunchContext();
  }, [showOverview, loadOverview, loadPeriodsStats, loadPunchContext]);

  // Xử lý Chấm công Nhanh (User Punch In / Punch Out)
  async function handlePunch(kind: 'check-in' | 'check-out') {
    if (punchBusy) return;
    setPunchBusy(true);
    setPunchError('');
    setPunchMessage('');
    try {
      let position: Record<string, number> = {};
      if (punchContext?.requireGps) {
        if (!navigator.geolocation) {
          throw new Error('Trình duyệt không hỗ trợ định vị GPS.');
        }
        const gps = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () => reject(new Error('Không lấy được GPS. Hãy cấp quyền vị trí.')),
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
      const nowStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      setLastPunchTime(nowStr);
      setPunchMessage(
        kind === 'check-in'
          ? `Ghi nhận VÀO thành công lúc ${nowStr}`
          : `Ghi nhận RA thành công lúc ${nowStr}`,
      );
      // Tải lại tổng quan
      void loadOverview();
    } catch (e) {
      setPunchError(e instanceof Error ? e.message : 'Không thực hiện được chấm công');
    } finally {
      setPunchBusy(false);
    }
  }

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-10">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Bàn làm việc HRM (Interactive Dashboard)
            </h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
              Thời gian thực
            </Badge>
          </div>
          <p className="text-xs text-slate-500 max-w-[85ch]">
            Không gian làm việc hợp nhất phân tầng theo 3 vùng chức năng: Tự phục vụ cá nhân (User), Điều hành & Phê duyệt (HR) và Quản trị hệ thống (Admin).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadOverview();
              void loadPeriodsStats();
              void loadPunchContext();
            }}
            className="text-xs text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className="size-3.5 mr-1.5" />
            Làm mới
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs">
          {error}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VÙNG 1: USER - TỰ PHỤC VỤ & CHẤM CÔNG NHANH                                */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <Clock className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                VÙNG 1: KHÔNG GIAN CÁ NHÂN (USER SELF-SERVICE)
              </h2>
              <p className="text-[11px] text-slate-500">
                Thao tác chấm công một chạm và tra cứu thông tin cá nhân
              </p>
            </div>
          </div>
          <Link
            href="/attendance"
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
          >
            <span>Bảng chấm công cá nhân</span>
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-12">
          {/* Card tương tác chính: Trạm Chấm Công Nhanh */}
          <div className="md:col-span-6 lg:col-span-5 rounded-xl border border-emerald-200/80 bg-linear-to-br from-emerald-50/60 via-white to-white p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-emerald-600" />
                  Trạm Chấm Công Nhanh Hôm Nay
                </span>
                <Badge className="bg-emerald-100/80 text-emerald-800 border-emerald-300 font-mono text-[11px]">
                  {punchContext?.workDate || new Date().toISOString().slice(0, 10)}
                </Badge>
              </div>

              <div className="bg-white/90 rounded-lg border border-emerald-100 p-3 mb-4">
                <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                  <span>Ca phân bổ:</span>
                  <span className="font-semibold text-slate-900">
                    {punchContext?.shift?.window
                      ? `${punchContext.shift.window.start} → ${punchContext.shift.window.end}`
                      : 'Ca hành chính chuẩn'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Phương thức:</span>
                  <span className="text-[11px] font-mono text-slate-700">
                    {punchContext?.requireGps ? 'Yêu cầu định vị GPS' : 'Mạng nội bộ / Web'}
                  </span>
                </div>
              </div>

              {punchMessage && (
                <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>{punchMessage}</span>
                </div>
              )}

              {punchError && (
                <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="size-4 text-red-600 shrink-0" />
                  <span>{punchError}</span>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => handlePunch('check-in')}
                  disabled={punchBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-10 shadow-xs flex items-center justify-center gap-1.5"
                >
                  {punchBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LogIn className="size-4" />
                  )}
                  <span>VÀO CA (Check-in)</span>
                </Button>
                <Button
                  onClick={() => handlePunch('check-out')}
                  disabled={punchBusy}
                  variant="outline"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold text-xs h-10 shadow-xs flex items-center justify-center gap-1.5"
                >
                  {punchBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  <span>RA CA (Check-out)</span>
                </Button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
                <span>Trạng thái: Trực tiếp từ trình duyệt</span>
                {lastPunchTime && <span>Lần gần nhất: {lastPunchTime}</span>}
              </div>
            </div>
          </div>

          {/* Các Thẻ Tự phục vụ Cá nhân (User Quick Access Cards) */}
          <div className="md:col-span-6 lg:col-span-7 grid gap-3 sm:grid-cols-3">
            <Link
              href="/requests"
              className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-amber-400 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="size-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <FileText className="size-4.5" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-amber-600 transition-colors">
                  Đơn từ của tôi
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                  Tạo đơn xin nghỉ phép, tăng ca (OT), công tác hoặc giải trình công.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-amber-600">
                <span>Nộp đơn mới</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            <Link
              href="/payslips"
              className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-blue-400 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="size-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <Banknote className="size-4.5" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                  Phiếu lương cá nhân
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                  Tra cứu chi tiết thu nhập thực lĩnh, các mức đóng bảo hiểm và thuế TNCN.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-blue-600">
                <span>Xem phiếu lương</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>

            <Link
              href="/profile"
              className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-purple-400 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="size-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <UserCheck className="size-4.5" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-purple-600 transition-colors">
                  Hồ sơ nhân sự
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                  Xem thông tin chức danh, hợp đồng lao động và tài khoản nhận lương.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-purple-600">
                <span>Xem chi tiết</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* VÙNG 2: HR - DUYỆT ĐƠN & ĐIỀU HÀNH CHUYÊN SÂU                            */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <Inbox className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                VÙNG 2: ĐIỀU HÀNH NHÂN SỰ & PHÊ DUYỆT (HR OPERATIONS)
              </h2>
              <p className="text-[11px] text-slate-500">
                Xử lý đơn từ luân chuyển và điều phối quy trình vận hành chấm công, tiền lương
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/modules/procedure-engine/instances"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg"
            >
              <Workflow className="size-3.5" />
              <span>Theo dõi trên Procedure Engine (PE)</span>
            </Link>
          </div>
        </div>

        {/* 1. Thẻ Tương tác Duyệt Đơn Từ (Action Cards linking to approvals) */}
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Đơn xin nghỉ phép */}
          <div className="rounded-xl border border-amber-200 bg-white p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <FileText className="size-4 text-amber-600" />
                  Đơn xin nghỉ phép
                </span>
                <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs">
                  {data?.pendingApprovals.leaveRequests ?? 0} chờ duyệt
                </Badge>
              </div>
              <p className="text-2xl font-extrabold text-amber-700 font-mono mt-1">
                {data?.pendingApprovals.leaveRequests ?? 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Bao gồm nghỉ phép năm, nghỉ ốm, việc riêng và chế độ thai sản.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <Link
                href="/approvals?type=leave"
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold py-2 px-3 transition-colors shadow-xs"
              >
                <span>Mở duyệt đơn phép</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>

          {/* Đăng ký Tăng ca OT */}
          <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <Clock className="size-4 text-blue-600" />
                  Đăng ký Tăng ca (OT)
                </span>
                <Badge className="bg-blue-100 text-blue-800 border-blue-300 font-bold text-xs">
                  {data?.pendingApprovals.otRequests ?? 0} chờ duyệt
                </Badge>
              </div>
              <p className="text-2xl font-extrabold text-blue-700 font-mono mt-1">
                {data?.pendingApprovals.otRequests ?? 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Kế hoạch làm thêm giờ ngày thường, ngày nghỉ và ngày lễ.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <Link
                href="/approvals?type=ot"
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-3 transition-colors shadow-xs"
              >
                <span>Mở duyệt đơn tăng ca</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>

          {/* Giải trình Quẹt thẻ / Bất thường */}
          <div className="rounded-xl border border-purple-200 bg-white p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <FileCheck2 className="size-4 text-purple-600" />
                  Giải trình chấm công
                </span>
                <Badge className="bg-purple-100 text-purple-800 border-purple-300 font-bold text-xs">
                  {data?.pendingApprovals.corrections ?? 0} chờ duyệt
                </Badge>
              </div>
              <p className="text-2xl font-extrabold text-purple-700 font-mono mt-1">
                {data?.pendingApprovals.corrections ?? 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Giải trình quên quẹt thẻ, công tác đột xuất hoặc bổ sung giờ làm.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <Link
                href="/approvals?type=correction"
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-2 px-3 transition-colors shadow-xs"
              >
                <span>Mở duyệt giải trình</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* 2. Thẻ Tương tác Chu trình Kỳ công & Bảng lương */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Thẻ Quản lý Bảng công */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet className="size-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Bảng công & Khóa kỳ tổng hợp
                </h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Đang có <strong className="text-blue-600 font-mono">{periodSummary.openTimesheets}</strong> kỳ công đang mở và{' '}
                <strong className="text-emerald-600 font-mono">{periodSummary.lockedTimesheets}</strong> kỳ đã khóa sẵn sàng tính lương.
              </p>
              <Link
                href="/timesheets"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors border border-blue-200"
              >
                <span>Xem ma trận bảng công & Khóa kỳ</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="size-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
              <FileSpreadsheet className="size-6" />
            </div>
          </div>

          {/* Thẻ Tính toán Lương & Chi trả */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Banknote className="size-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Tiền lương & Chốt lương
                </h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Đang có <strong className="text-amber-600 font-mono">{periodSummary.openPayrolls}</strong> kỳ lương đang mở. Tự động tính tỷ lệ theo nhiều bậc lương và chuyển đổi chính sách.
              </p>
              <Link
                href="/payroll"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors border border-emerald-200"
              >
                <span>Mở trung tâm tính lương & Phát hành</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="size-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
              <Banknote className="size-6" />
            </div>
          </div>
        </div>

        {/* 3. Tình trạng Chấm công Hôm nay của Toàn công ty */}
        {data && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Clock className="size-4 text-slate-600" />
                Điểm danh & Tình hình Chấm công Doanh nghiệp Hôm nay
              </span>
              <Link href="/attendance" className="text-xs font-medium text-blue-600 hover:underline">
                Xem chi tiết quẹt thẻ →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[11px] text-slate-500 block">Đã có mặt (Check-in)</span>
                <span className="text-xl font-bold font-mono text-emerald-600 mt-1 block">
                  {data.todayAttendance.checkedInCount}
                </span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[11px] text-slate-500 block">Đi trễ hôm nay</span>
                <span className="text-xl font-bold font-mono text-amber-600 mt-1 block">
                  {data.todayAttendance.lateCount}
                </span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[11px] text-slate-500 block">Thiếu lượt / Quên quẹt</span>
                <span className="text-xl font-bold font-mono text-rose-600 mt-1 block">
                  {data.todayAttendance.missingPunchCount}
                </span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[11px] text-slate-500 block">Đang nghỉ phép</span>
                <span className="text-xl font-bold font-mono text-indigo-600 mt-1 block">
                  {data.todayAttendance.onLeaveCount}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* VÙNG 3: ADMIN - CẤU HÌNH, QUẢN TRỊ CHÍNH SÁCH & HỆ THỐNG                   */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <Sliders className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                VÙNG 3: QUẢN TRỊ HỆ THỐNG & THIẾT LẬP CHÍNH SÁCH (ADMIN / CONFIG)
              </h2>
              <p className="text-[11px] text-slate-500">
                Cấu hình tham số lõi cho phép, thời gian, công thức lương và kiểm soát phân quyền
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Cấu hình Lương */}
          <Link
            href="/payroll/settings"
            className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 group-hover:scale-105 transition-transform">
                  <Coins className="size-4.5" />
                </div>
                <Badge className="bg-slate-100 text-slate-700 text-[10px]">Chính sách</Badge>
              </div>
              <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                Cấu hình Công thức Lương
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                Thiết lập hệ số OT, tỷ lệ trích BHXH, BHYT, mức giảm trừ gia cảnh và biến số lương.
              </p>
            </div>
            <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-indigo-600">
              <span>Điều chỉnh chính sách</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* Cấu hình Quỹ phép */}
          <Link
            href="/leave-settings"
            className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 group-hover:scale-105 transition-transform">
                  <Calendar className="size-4.5" />
                </div>
                <Badge className="bg-slate-100 text-slate-700 text-[10px]">Chính sách</Badge>
              </div>
              <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                Cấu hình Quỹ phép & Nghỉ lễ
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                Quy định số ngày phép năm theo thâm niên, chuyển phép sang năm sau và lịch nghỉ lễ.
              </p>
            </div>
            <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-indigo-600">
              <span>Mở quản trị quỹ phép</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* Cấu hình Máy chấm công & GPS */}
          <Link
            href="/policies"
            className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 group-hover:scale-105 transition-transform">
                  <Clock className="size-4.5" />
                </div>
                <Badge className="bg-slate-100 text-slate-700 text-[10px]">Thiết bị & Giờ</Badge>
              </div>
              <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                Công, Thiết bị & Tọa độ GPS
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                Liên kết máy chấm công vân tay/khuôn mặt, IP công ty và bán kính GPS cho phép quẹt thẻ.
              </p>
            </div>
            <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-indigo-600">
              <span>Cấu hình thiết bị</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* Phân quyền & Vận hành */}
          <Link
            href="/permissions"
            className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 group-hover:scale-105 transition-transform">
                  <ShieldCheck className="size-4.5" />
                </div>
                <Badge className="bg-slate-100 text-slate-700 text-[10px]">Bảo mật</Badge>
              </div>
              <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                Danh mục Phân quyền HRM
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                Kiểm soát quyền truy cập chi tiết từ tự phục vụ, quản lý ca đến chốt lương và kiểm toán.
              </p>
            </div>
            <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-indigo-600">
              <span>Xem phân quyền</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
