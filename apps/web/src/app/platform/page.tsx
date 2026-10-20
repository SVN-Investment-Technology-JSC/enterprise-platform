import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { formatDate } from '@enterprise-platform/shared-ui';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Briefcase,
  Building2,
  ChevronRight,
  Cpu,
  Database,
  GitFork,
  LayoutGrid,
  Layers,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cn } from '@/lib/utils';

function getModuleIcon(key: string): LucideIcon {
  const normalized = key.toLowerCase();
  if (normalized.includes('hrm') || normalized.includes('nhân sự')) return Briefcase;
  if (normalized.includes('inventory') || normalized.includes('kho')) return Boxes;
  if (normalized.includes('maintenance') || normalized.includes('bảo trì')) return Wrench;
  if (normalized.includes('procedure') || normalized.includes('quy trình')) return GitFork;
  if (normalized.includes('workspace') || normalized.includes('không gian')) return LayoutGrid;
  return Layers;
}

export default async function PlatformPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, tenantsResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${api}/api/platform/v1/tenants`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  if (!meResponse.ok || !tenantsResponse.ok) redirect('/login/admin');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin') redirect('/dashboard');
  const { tenants } = (await tenantsResponse.json()) as {
    tenants: TenantSummary[];
  };

  const activeTenants = tenants.filter((tenant) => tenant.status === 'active');
  const disabledTenants = tenants.filter(
    (tenant) => tenant.status === 'disabled',
  );
  const databaseConfigured = tenants.filter((tenant) => Boolean(tenant.database)).length;

  const moduleSummary = tenants.reduce((summary, tenant) => {
    for (const module of tenant.modules) {
      if (module.status !== 'active') continue;
      const current = summary.get(module.key) ?? {
        name: module.name,
        key: module.key,
        count: 0,
      };
      current.count += 1;
      summary.set(module.key, current);
    }
    return summary;
  }, new Map<string, { name: string; key: string; count: number }>());

  const moduleUsage = Array.from(moduleSummary.values())
    .sort((left, right) => right.count - left.count);

  const recentTenants = [...tenants]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, 4);

  const activeRate = tenants.length > 0 ? Math.round((activeTenants.length / tenants.length) * 100) : 100;
  const missingDatabase = tenants.length - databaseConfigured;

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* 1. Header: Gọn gàng trên 1 dòng, thông tin xúc tích */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Tổng quan nền tảng
          </h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Vận hành tối ưu
          </span>
          <span className="hidden text-sm text-slate-400 md:inline">|</span>
          <p className="hidden text-sm text-slate-500 md:inline">
            Giám sát vận hành các tổ chức doanh nghiệp, cơ sở dữ liệu và phân hệ.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/platform/brand-studio"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
          >
            <Sparkles className="size-3.5 text-indigo-600" />
            Brand Studio
          </Link>
          <Link
            href="/platform/tenants"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#091426] px-3 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#12233f]"
          >
            <Plus className="size-3.5" />
            Quản lý Tenant
          </Link>
        </div>
      </div>

      {/* 2. Dải KPI liền mạch (Metrics Bar): Chiều cao vừa vặn, số to nét */}
      <section
        aria-label="Chỉ số chính"
        className="rounded-lg bg-white px-5 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-slate-200/80"
      >
        <div className="grid grid-cols-2 gap-4 divide-y divide-slate-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {/* Metric 1 */}
          <div className="pt-2 first:pt-0 sm:pt-0 sm:px-4 sm:first:pl-0">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-400">
                Tổng tổ chức
              </span>
              <div className="flex size-7 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <Building2 className="size-3.5" />
              </div>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {tenants.length}
              </span>
              <span className="text-xs sm:text-sm font-semibold text-emerald-600">
                {activeTenants.length} hoạt động
              </span>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="pt-2 sm:pt-0 sm:px-4">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-400">
                Tỷ lệ hoạt động
              </span>
              <div className="flex size-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                <Activity className="size-3.5" />
              </div>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {activeRate}%
              </span>
              {disabledTenants.length > 0 ? (
                <span className="text-xs sm:text-sm font-semibold text-amber-600">
                  {disabledTenants.length} tạm khóa
                </span>
              ) : (
                <span className="text-xs sm:text-sm font-medium text-slate-400">
                  Ổn định
                </span>
              )}
            </div>
          </div>

          {/* Metric 3 */}
          <div className="pt-2 sm:pt-0 sm:px-4">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-400">
                Cơ sở dữ liệu
              </span>
              <div className="flex size-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                <Database className="size-3.5" />
              </div>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {databaseConfigured}
              </span>
              <span className="text-xs sm:text-sm text-slate-500">
                / {tenants.length} tenant
              </span>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="pt-2 sm:pt-0 sm:px-4 sm:last:pr-0">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-400">
                Phân hệ vận hành
              </span>
              <div className="flex size-7 items-center justify-center rounded-md bg-purple-50 text-purple-600">
                <Boxes className="size-3.5" />
              </div>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {moduleSummary.size}
              </span>
              <span className="text-xs sm:text-sm font-medium text-slate-400">
                phân hệ cốt lõi
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Vùng nội dung 3 Cột: Vừa in trong 1 khung màn hình, không cần scroll */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Cột 1 (4 Cols): Tỷ lệ sử dụng phân hệ */}
        <div className="flex flex-col justify-between rounded-lg bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-slate-200/80 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  Tỷ lệ sử dụng phân hệ
                </h2>
                <p className="text-xs text-slate-500">
                  Phân bổ module trên các tổ chức.
                </p>
              </div>
              <Link
                href="/platform/plans"
                className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Gói <ChevronRight className="size-3" />
              </Link>
            </div>

            <div className="mt-3 space-y-2.5">
              {moduleUsage.length > 0 ? (
                moduleUsage.slice(0, 5).map((module) => {
                  const pct = activeTenants.length > 0 ? Math.round((module.count / activeTenants.length) * 100) : 0;
                  const Icon = getModuleIcon(module.name);

                  return (
                    <div
                      key={module.key}
                      className="group flex flex-col justify-between rounded-md border border-slate-100 bg-slate-50/50 p-2.5 transition-colors hover:border-slate-200 hover:bg-white"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded bg-white text-slate-700 shadow-xs ring-1 ring-slate-200/60">
                            <Icon className="size-3 text-slate-700" />
                          </div>
                          <span className="text-xs sm:text-sm font-semibold text-slate-800">
                            {module.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">
                            {module.count} tổ chức
                          </span>
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/10">
                            {pct}%
                          </span>
                        </div>
                      </div>

                      <div className="mt-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                          <div
                            className="h-full rounded-full bg-indigo-600 transition-all duration-300 group-hover:bg-indigo-500"
                            style={{ width: `${Math.max(5, pct)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  Chưa có phân hệ kích hoạt.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cột 2 (4 Cols): Tổ chức mới tham gia */}
        <div className="flex flex-col justify-between rounded-lg bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-slate-200/80 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  Tổ chức mới tham gia
                </h2>
                <p className="text-xs text-slate-500">
                  Các tenant khởi tạo gần đây nhất.
                </p>
              </div>
              <Link
                href="/platform/tenants"
                className="flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-indigo-600"
              >
                Tất cả <ChevronRight className="size-3" />
              </Link>
            </div>

            <div className="mt-2 divide-y divide-slate-100">
              {recentTenants.length > 0 ? (
                recentTenants.map((tenant) => {
                  const initials = tenant.name
                    ? tenant.name
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                    : 'TN';

                  const isActive = tenant.status === 'active';

                  return (
                    <div
                      key={tenant.id}
                      className="flex items-center justify-between py-2.5 px-1.5 transition-colors hover:bg-slate-50/70 rounded-md"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-700">
                          {initials}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs sm:text-sm font-semibold text-slate-900">
                              {tenant.name}
                            </span>
                            <span className="font-mono text-xs text-slate-400">
                              @{tenant.slug}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{formatDate(tenant.createdAt)}</span>
                            {tenant.database ? (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium">
                                  <Database className="size-3" /> DB đã gán
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                            isActive
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700',
                          )}
                        >
                          {isActive ? 'Hoạt động' : 'Tạm khóa'}
                        </span>
                        <Link
                          href={`/platform/tenants`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Xem chi tiết"
                        >
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  Chưa có tổ chức nào.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cột 3 (4 Cols): Hạ tầng hệ thống & Brand Studio Hub */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          {/* Hạ tầng hệ thống */}
          <div className="rounded-lg bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-slate-200/80">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Cpu className="size-4 text-indigo-600" />
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Hạ tầng & Kết nối
              </h2>
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-md bg-slate-50/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900">Cơ sở dữ liệu</p>
                    <p className="text-[11px] text-slate-400">PostgreSQL Multi-schema</p>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Sẵn sàng</span>
              </div>

              <div className="flex items-center justify-between rounded-md bg-slate-50/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900">Cổng Gateway</p>
                    <p className="text-[11px] text-slate-400">Nginx Reverse Proxy</p>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Hoạt động</span>
              </div>

              <div className="flex items-center justify-between rounded-md bg-slate-50/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-900">Hàng đợi Outbox</p>
                    <p className="text-[11px] text-slate-400">Background Worker</p>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Khớp lịch</span>
              </div>
            </div>

            {/* Quản trị & cảnh báo ngắn gọn */}
            <div className="mt-2.5 pt-2 border-t border-slate-100">
              {disabledTenants.length > 0 || missingDatabase > 0 ? (
                <div className="rounded-md bg-amber-50/70 p-2 text-xs text-amber-800">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                    <AlertTriangle className="size-3.5 text-amber-600" />
                    Lưu ý: Có {disabledTenants.length} tenant tạm khóa, {missingDatabase} chưa gán DB.
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-700">
                  <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
                  <span>Toàn bộ tenant và database vận hành an toàn.</span>
                </div>
              )}
            </div>
          </div>

          {/* SVNDTS Brand Studio Hub */}
          <div className="rounded-lg bg-slate-900 p-4 text-white shadow-sm ring-1 ring-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Sparkles className="size-3.5 text-amber-400" />
                <span>Brand Studio</span>
              </div>
              <span className="text-[11px] text-slate-400">Độc quyền SVNDTS</span>
            </div>
            <p className="mt-1 text-xs text-slate-300 leading-snug">
              Bộ công cụ vector structured SVG kiến tạo icon chuẩn nhận diện cho toàn nền tảng.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Link
                href="/platform/brand-studio"
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow transition-colors hover:bg-slate-100"
              >
                Mở Studio
                <ArrowUpRight className="size-3" />
              </Link>
              <Link
                href="/platform/data-import"
                className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                Nhập dữ liệu
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
