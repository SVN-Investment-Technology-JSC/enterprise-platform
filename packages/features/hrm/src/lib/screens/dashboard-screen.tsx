'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { HrmDashboardOverview } from '@enterprise-platform/contracts-hrm';
import {
  Users,
  UserCheck,
  UserPlus,
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
  CalendarRange,
  LayoutDashboard,
  Activity,
} from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';

export default function HrmDashboardPage() {
  const { can } = useHrmPermissions();
  const showOverview = can('hrm.dashboard.read');
  const [data, setData] = useState<HrmDashboardOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!showOverview) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    hrmFetch<{ data: HrmDashboardOverview }>('/dashboard/overview')
      .then((r) => {
        if (active) {
          setData(r.data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [showOverview]);

  if (!showOverview) {
    return (
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <LayoutDashboard className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Không gian Nhân viên (Self-Service)
              </h1>
              <p className="text-xs text-slate-500">
                Truy cập nhanh các chức năng tự phục vụ thông tin nhân sự và chấm công.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              href: '/profile',
              title: 'Hồ sơ của tôi',
              desc: 'Tra cứu thông tin nhân sự, hợp đồng và tài khoản ngân hàng',
              icon: Users,
              color: 'text-blue-600 bg-blue-50 border-blue-100',
            },
            {
              href: '/attendance',
              title: 'Chấm công cá nhân',
              desc: 'Ghi nhận giờ vào/ra và theo dõi lịch sử chấm công',
              icon: Clock,
              color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
            },
            {
              href: '/requests',
              title: 'Đơn từ của tôi',
              desc: 'Tạo đơn xin nghỉ phép, tăng ca, công tác hoặc giải trình',
              icon: FileText,
              color: 'text-amber-600 bg-amber-50 border-amber-100',
            },
            {
              href: '/calendar',
              title: 'Lịch làm việc',
              desc: 'Xem lịch làm việc phân ca, ngày nghỉ lễ và thông báo cá nhân',
              icon: Calendar,
              color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className={`inline-flex p-2.5 rounded-lg border ${item.color} mb-3`}>
                    <Icon className="size-5" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-blue-600">
                  <span>Mở chức năng</span>
                  <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Tổng quan Nhân sự & Điều hành
            </h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold">
              Thời gian thực
            </Badge>
          </div>
          <p className="text-xs text-slate-500 max-w-[85ch]">
            Số liệu tổng hợp từ hồ sơ nhân viên, trạng thái chấm công hôm nay và luồng đơn từ phê duyệt của doanh nghiệp.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/employees"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white! text-xs font-semibold shadow-xs"
          >
            <Users className="size-4" />
            <span>Quản lý Nhân sự</span>
          </Link>
          <Link
            href="/approvals"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-colors"
          >
            <Inbox className="size-4" />
            <span>Xử lý Đơn từ</span>
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center p-12 text-slate-500 text-sm">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mr-2" />
          Đang tổng hợp dữ liệu nhân sự…
        </div>
      )}

      {data && (
        <>
          {/* 2. Group 1: Scale & Workforce */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="size-4 text-blue-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Quy mô & Lực lượng Lao động
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Tổng nhân viên đang làm</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900 font-mono">
                    {data.totalEmployees}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Tất cả hợp đồng đang hiệu lực</p>
                </div>
                <div className="size-11 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center">
                  <Users className="size-6" />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Hợp đồng chính thức</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-600 font-mono">
                    {data.officialEmployees}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {data.totalEmployees > 0
                      ? `${Math.round((data.officialEmployees / data.totalEmployees) * 100)}% tổng quân số`
                      : '0%'}
                  </p>
                </div>
                <div className="size-11 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
                  <UserCheck className="size-6" />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">Nhân sự thử việc</p>
                  <p className="mt-2 text-2xl font-bold text-amber-600 font-mono">
                    {data.probationEmployees}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Đang trong thời gian đánh giá</p>
                </div>
                <div className="size-11 rounded-lg bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center">
                  <UserPlus className="size-6" />
                </div>
              </div>
            </div>
          </div>

          {/* 3. Group 2: Today Attendance */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="size-4 text-emerald-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Tình hình Chấm công Hôm nay
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500 font-medium">Đã chấm vào</span>
                  <span className="p-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <CheckCircle2 className="size-3.5" />
                  </span>
                </div>
                <div className="text-2xl font-bold text-emerald-600 font-mono">
                  {data.todayAttendance.checkedInCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Có quẹt thẻ ghi nhận giờ vào</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500 font-medium">Đi trễ hôm nay</span>
                  <span className="p-1 rounded-md bg-amber-50 text-amber-600 border border-amber-100">
                    <Clock className="size-3.5" />
                  </span>
                </div>
                <div className="text-2xl font-bold text-amber-600 font-mono">
                  {data.todayAttendance.lateCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Sau giờ giới hạn trễ của ca</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500 font-medium">Bất thường / Thiếu lượt</span>
                  <span className="p-1 rounded-md bg-red-50 text-red-600 border border-red-100">
                    <AlertTriangle className="size-3.5" />
                  </span>
                </div>
                <div className="text-2xl font-bold text-red-600 font-mono">
                  {data.todayAttendance.missingPunchCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Quên chấm vào hoặc ra</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500 font-medium">Đang nghỉ phép</span>
                  <span className="p-1 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <Calendar className="size-3.5" />
                  </span>
                </div>
                <div className="text-2xl font-bold text-indigo-600 font-mono">
                  {data.todayAttendance.onLeaveCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Đã được duyệt đơn nghỉ</div>
              </div>
            </div>
          </div>

          {/* 4. Group 3: Pending Approvals */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Inbox className="size-4 text-amber-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Đơn từ & Yêu cầu Chờ Xử lý
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Link
                href="/approvals"
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-amber-500 hover:shadow-md transition-all flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">Đơn phép chờ duyệt</p>
                  <p className="mt-2 text-2xl font-bold text-amber-600 font-mono">
                    {data.pendingApprovals.leaveRequests}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Nghỉ phép năm, ốm, việc riêng</p>
                </div>
                <div className="size-11 rounded-lg bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <FileText className="size-6" />
                </div>
              </Link>

              <Link
                href="/approvals"
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">Tăng ca (OT) chờ duyệt</p>
                  <p className="mt-2 text-2xl font-bold text-blue-600 font-mono">
                    {data.pendingApprovals.otRequests}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Kế hoạch làm thêm giờ</p>
                </div>
                <div className="size-11 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Clock className="size-6" />
                </div>
              </Link>

              <Link
                href="/approvals"
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-purple-500 hover:shadow-md transition-all flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">Giải trình công chờ duyệt</p>
                  <p className="mt-2 text-2xl font-bold text-purple-600 font-mono">
                    {data.pendingApprovals.corrections}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">Giải trình quên quẹt thẻ / sai lệch</p>
                </div>
                <div className="size-11 rounded-lg bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <FileCheck2 className="size-6" />
                </div>
              </Link>
            </div>
          </div>
        </>
      )}

      {/* 5. Group 4: Quick Navigation to Major Workspaces */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="size-4 text-slate-600" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Phân khu Chức năng Nghiệp vụ
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              href: '/employees',
              title: 'Hồ sơ Nhân viên',
              description: 'Quản lý thông tin định danh, chức danh, ngạch bậc và hợp đồng',
              icon: Users,
              accent: 'border-blue-200 hover:border-blue-500',
            },
            {
              href: '/shifts',
              title: 'Quản lý Ca & Phân ca',
              description: 'Thiết lập định nghĩa ca làm việc và bảng phân ca làm việc tuần/tháng',
              icon: CalendarRange,
              accent: 'border-slate-200 hover:border-blue-500',
            },
            {
              href: '/attendance',
              title: 'Chấm công & Điểm danh',
              description: 'Ghi nhận giờ làm việc, định vị GPS và rà soát các lượt vào ra',
              icon: Clock,
              accent: 'border-slate-200 hover:border-blue-500',
            },
            {
              href: '/approvals',
              title: 'Xử lý Đơn từ & Phê duyệt',
              description: 'Tiếp nhận, kiểm tra tính hợp lệ chính sách và phê duyệt đơn từ nhân viên',
              icon: Inbox,
              accent: 'border-slate-200 hover:border-blue-500',
            },
            {
              href: '/timesheets',
              title: 'Bảng công Tổng hợp',
              description: 'Tổng hợp ngày công, tính toán giờ làm thêm, đi trễ và khóa kỳ công',
              icon: FileSpreadsheet,
              accent: 'border-slate-200 hover:border-blue-500',
            },
            {
              href: '/payroll',
              title: 'Tiền lương & Chi trả',
              description: 'Tính toán lương theo công thức, đối soát thu nhập và phát hành phiếu lương',
              icon: Banknote,
              accent: 'border-slate-200 hover:border-blue-500',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group rounded-xl border ${item.accent} bg-white p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-100 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-100 transition-colors">
                      <Icon className="size-5" />
                    </div>
                    <ChevronRight className="size-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
