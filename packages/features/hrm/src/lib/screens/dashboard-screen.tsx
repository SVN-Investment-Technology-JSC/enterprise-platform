'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { HrmDashboardOverview } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';

export default function HrmDashboardPage() {
  const { can } = useHrmPermissions();
  const showOverview = can('hrm.dashboard.read');
  const [data, setData] = useState<HrmDashboardOverview | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!showOverview) return;
    let active = true;
    hrmFetch<{ data: HrmDashboardOverview }>('/dashboard/overview')
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [showOverview]);
  if (!showOverview)
    return (
      <main className="space-y-3">
        <h1 className="text-lg font-semibold">Không gian nhân viên</h1>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['/profile', 'Hồ sơ của tôi'],
            ['/attendance', 'Công cá nhân'],
            ['/requests', 'Đơn của tôi'],
            ['/calendar', 'Lịch làm việc'],
          ].map(([href, label]) => (
            <Link
              className="rounded border bg-white p-4 hover:border-blue-500"
              key={href}
              href={href}
            >
              {label}
            </Link>
          ))}
        </div>
      </main>
    );
  const cards = data
    ? [
        ['Nhân viên đang làm', data.totalEmployees],
        ['Chính thức', data.officialEmployees],
        ['Thử việc', data.probationEmployees],
        ['Đã chấm vào hôm nay', data.todayAttendance.checkedInCount],
        ['Đi trễ hôm nay', data.todayAttendance.lateCount],
        ['Công bất thường hôm nay', data.todayAttendance.missingPunchCount],
        ['Đang nghỉ phép', data.todayAttendance.onLeaveCount],
        ['Đơn phép chờ duyệt', data.pendingApprovals.leaveRequests],
        ['OT chờ duyệt', data.pendingApprovals.otRequests],
        ['Giải trình chờ duyệt', data.pendingApprovals.corrections],
      ]
    : [];
  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Tổng quan nhân sự</h1>
        <p className="text-sm text-slate-500">
          Số liệu từ hồ sơ nhân viên và dữ liệu công, phép của doanh nghiệp.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải số liệu…</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-white p-5">
            <p className="text-sm text-slate-500">{label}</p>
            <strong className="mt-3 block text-3xl">{value}</strong>
          </article>
        ))}
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          [
            '/employees',
            'Hồ sơ nhân viên',
            'Quản lý hồ sơ và tài khoản liên kết',
          ],
          ['/shifts', 'Ca làm việc', 'Khai báo và phân ca theo hiệu lực'],
          ['/attendance', 'Chấm công', 'Ghi nhận nhiều lượt vào/ra'],
          ['/approvals', 'Phê duyệt', 'Đối chiếu và xử lý đơn từ'],
          ['/timesheets', 'Bảng công', 'Tổng hợp và khóa kỳ công'],
          ['/payroll', 'Tiền lương', 'Tính theo công thức và phát hành phiếu'],
        ].map(([href, title, description]) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border bg-white p-5 hover:border-blue-500"
          >
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-500">{description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
