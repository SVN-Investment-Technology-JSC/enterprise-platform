import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Database,
  Gauge,
  LayoutDashboard,
  Menu,
  PackageCheck,
  ReceiptText,
  Search,
  ServerCog,
  Settings,
  Users,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const navigation = [
  {
    label: 'Bảng điều khiển',
    icon: LayoutDashboard,
    href: '/platform',
    active: true,
  },
  { label: 'Khách hàng', icon: Users, href: '/platform/tenants' },
  { label: 'Dịch vụ', icon: ServerCog, href: '#' },
  { label: 'Hóa đơn', icon: ReceiptText, href: '#' },
  { label: 'Báo cáo', icon: BarChart3, href: '#' },
  { label: 'Cài đặt', icon: Settings, href: '#' },
];
const vietnameseDate = new Intl.DateTimeFormat('vi-VN');

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
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
  if (!meResponse.ok || !tenantsResponse.ok) redirect('/platform/login');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin')
    redirect(`/t/${principal.tenantSlug}`);
  const { tenants } = (await tenantsResponse.json()) as {
    tenants: TenantSummary[];
  };

  const activeTenants = tenants.filter((tenant) => tenant.status === 'active');
  const disabledTenants = tenants.filter(
    (tenant) => tenant.status === 'disabled',
  );
  const databaseConfigured = tenants.filter((tenant) => tenant.database).length;
  const moduleSummary = tenants.reduce((summary, tenant) => {
    for (const module of tenant.modules) {
      if (module.status !== 'active') continue;
      const current = summary.get(module.key) ?? {
        name: module.name,
        count: 0,
      };
      current.count += 1;
      summary.set(module.key, current);
    }
    return summary;
  }, new Map<string, { name: string; count: number }>());
  const moduleUsage = Array.from(moduleSummary.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
  const recentTenants = [...tenants]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, 3);
  const displayName = principal.displayName || 'Admin User';

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-[#091426] px-2 py-4 text-slate-200 lg:flex">
        <div className="mb-7 flex items-center gap-2 px-2">
          <div className="grid size-8 place-items-center rounded-md bg-white text-[#091426]">
            <Building2 className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">SaaS Platform</p>
            <p className="text-xs text-slate-400">Quản trị hệ thống</p>
          </div>
        </div>
        <PlatformNavigation />
        <div className="mt-auto border-t border-slate-800 px-2 pt-4">
          <SessionLogoutButton portal="platform" tone="dark" />
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-white/90 px-4 backdrop-blur lg:px-8">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  className="lg:hidden"
                  size="icon"
                  variant="ghost"
                  aria-label="Mở điều hướng"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-[#091426] text-white">
              <SheetHeader>
                <SheetTitle className="text-white">SaaS Platform</SheetTitle>
                <SheetDescription className="text-slate-400">
                  Quản trị hệ thống
                </SheetDescription>
              </SheetHeader>
              <PlatformNavigation mobile />
            </SheetContent>
          </Sheet>
          <div className="relative hidden w-full max-w-md sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 bg-slate-50 pl-9"
              placeholder="Tìm kiếm..."
              aria-label="Tìm kiếm"
            />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="icon" variant="ghost" aria-label="Thông báo" />
                }
              >
                <Bell />
              </TooltipTrigger>
              <TooltipContent>Thông báo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="icon" variant="ghost" aria-label="Trợ giúp" />
                }
              >
                <CircleHelp />
              </TooltipTrigger>
              <TooltipContent>Trợ giúp</TooltipContent>
            </Tooltip>
            <Avatar>
              <AvatarFallback className="bg-slate-200 font-medium text-slate-700">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          <div className="mb-7">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Tổng quan nền tảng
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Theo dõi tenant, subscription, module và hạ tầng hệ thống.
            </p>
          </div>
          <section
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
            aria-label="Chỉ số nền tảng"
          >
            <MetricCard
              icon={Building2}
              label="Tổng số tenant"
              value={tenants.length}
            />
            <MetricCard
              icon={Users}
              label="Tenant đang hoạt động"
              value={activeTenants.length}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Tenant bị tạm khóa"
              value={disabledTenants.length}
              warning={disabledTenants.length > 0}
            />
            <MetricCard
              icon={Database}
              label="Database đã cấu hình"
              value={databaseConfigured}
            />
            <MetricCard
              icon={PackageCheck}
              label="Module đang hoạt động"
              value={moduleSummary.size}
            />
            <MetricCard
              icon={Gauge}
              label="Trạng thái hệ thống"
              value={
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                  <span className="mr-1.5 size-1.5 rounded-full bg-emerald-700" />
                  Ổn định
                </Badge>
              }
              compact
            />
          </section>
          <section className="mt-8 grid gap-4 lg:grid-cols-2">
            <TrendCard
              title="Tenant mới (6 tháng)"
              values={[35, 46, 41, 58, 52, Math.max(tenants.length, 24)]}
            />
            <TrendCard
              title="Doanh thu theo tháng"
              values={[32, 38, 55, 49, 64, 72]}
              currency
            />
          </section>
          <section className="mt-8 grid gap-8 xl:grid-cols-3">
            <Card className="xl:col-span-2 border-slate-200 shadow-sm">
              <CardHeader className="border-b">
                <CardTitle>Module được sử dụng nhiều nhất</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Module</th>
                        <th className="px-4 py-3 text-right font-medium">
                          Active tenants
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Tỷ lệ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {moduleUsage.map((module) => (
                        <tr
                          className="border-b last:border-b-0"
                          key={module.name}
                        >
                          <td className="px-4 py-3 font-medium">
                            {module.name}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {module.count}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {activeTenants.length
                              ? Math.round(
                                (module.count / activeTenants.length) * 100,
                              )
                              : 0}
                            %
                          </td>
                        </tr>
                      ))}
                      {moduleUsage.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-8 text-center text-muted-foreground"
                            colSpan={3}
                          >
                            Chưa có module được kích hoạt.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <AlertsCard
              disabledTenants={disabledTenants}
              databaseConfigured={databaseConfigured}
              tenantCount={tenants.length}
            />
          </section>
          <section className="mt-8">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="flex-row items-center justify-between border-b">
                <CardTitle>Hoạt động gần đây</CardTitle>
                <Link
                  className="text-sm font-semibold text-[#091426] hover:underline"
                  href="/platform/tenants"
                >
                  Quản lý tenant <ChevronRight className="inline size-4" />
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Thời gian</th>
                        <th className="px-4 py-3 font-medium">Hành động</th>
                        <th className="px-4 py-3 font-medium">Tenant</th>
                        <th className="px-4 py-3 font-medium">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTenants.map((tenant) => (
                        <tr
                          className="border-b last:border-b-0"
                          key={tenant.id}
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {vietnameseDate.format(new Date(tenant.createdAt))}
                          </td>
                          <td className="px-4 py-3">Tenant được tạo</td>
                          <td className="px-4 py-3 font-medium">
                            {tenant.name}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                              Thành công
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {recentTenants.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-8 text-center text-muted-foreground"
                            colSpan={4}
                          >
                            Chưa có hoạt động để hiển thị.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}

function PlatformNavigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={cn('space-y-1', mobile && 'px-4')}
      aria-label="Điều hướng platform"
    >
      {navigation.map(({ label, icon: Icon, href, active }) => (
        <Link
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            active
              ? 'border-r-4 border-slate-300 bg-slate-800 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white',
          )}
          href={href}
          key={label}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
function MetricCard({
  icon: Icon,
  label,
  value,
  warning = false,
  compact = false,
}: {
  icon: typeof Building2;
  label: string;
  value: React.ReactNode;
  warning?: boolean;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        'gap-0 border-slate-200 bg-white py-5 shadow-sm',
        warning && 'border-l-4 border-l-amber-500',
      )}
    >
      <CardContent>
        <div className="mb-3 flex items-start justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
          <span>{label}</span>
          <Icon
            className={cn(
              'size-4',
              warning ? 'text-amber-500' : 'text-[#091426]',
            )}
          />
        </div>
        <div
          className={cn(
            'font-bold text-slate-900',
            compact ? 'pt-1 text-xl' : 'text-3xl',
            warning && 'text-amber-600',
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
function TrendCard({
  title,
  values,
  currency = false,
}: {
  title: string;
  values: number[];
  currency?: boolean;
}) {
  const max = Math.max(...values);
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="flex h-48 items-end justify-between gap-3 pt-4"
          aria-label={title}
        >
          {values.map((value, index) => (
            <div
              className="flex h-full flex-1 flex-col justify-end gap-2"
              key={`${title}-${index}`}
            >
              <div
                className="min-h-2 rounded-t bg-[#1e293b]"
                style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
              />
              <span className="text-center text-xs text-muted-foreground">
                T{index + 1}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {currency
            ? 'Chỉ số minh họa doanh thu theo tháng.'
            : 'Dữ liệu tenant theo các kỳ gần đây.'}
        </p>
      </CardContent>
    </Card>
  );
}
function AlertsCard({
  disabledTenants,
  databaseConfigured,
  tenantCount,
}: {
  disabledTenants: TenantSummary[];
  databaseConfigured: number;
  tenantCount: number;
}) {
  const missingDatabase = tenantCount - databaseConfigured;
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b">
        <CardTitle>Cảnh báo hệ thống</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {disabledTenants.slice(0, 1).map((tenant) => (
          <AlertItem
            key={tenant.id}
            icon={AlertTriangle}
            title="Tenant đang tạm khóa"
            detail={`Tenant: ${tenant.name}`}
            tone="warning"
          />
        ))}
        {missingDatabase > 0 ? (
          <AlertItem
            icon={Database}
            title="Tenant chưa cấu hình database"
            detail={`${missingDatabase} tenant cần được kiểm tra cấu hình.`}
            tone="danger"
          />
        ) : null}
        {!disabledTenants.length && !missingDatabase ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <CircleCheck className="mt-0.5 size-4 text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-emerald-900">
                Không có cảnh báo quan trọng
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Các tenant và database hiện đã sẵn sàng.
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
function AlertItem({
  icon: Icon,
  title,
  detail,
  tone,
}: {
  icon: typeof AlertTriangle;
  title: string;
  detail: string;
  tone: 'warning' | 'danger';
}) {
  const isDanger = tone === 'danger';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3',
        isDanger ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4',
          isDanger ? 'text-red-600' : 'text-amber-600',
        )}
      />
      <div>
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'text-sm font-medium',
              isDanger ? 'text-red-900' : 'text-amber-900',
            )}
          >
            {title}
          </p>
          <Badge
            className={cn(
              'text-[10px]',
              isDanger
                ? 'bg-red-600 text-white hover:bg-red-600'
                : 'bg-amber-500 text-white hover:bg-amber-500',
            )}
          >
            {isDanger ? 'HIGH' : 'MEDIUM'}
          </Badge>
        </div>
        <p
          className={cn(
            'mt-1 text-xs',
            isDanger ? 'text-red-700' : 'text-amber-700',
          )}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}
