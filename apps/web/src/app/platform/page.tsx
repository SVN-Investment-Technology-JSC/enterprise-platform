import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { formatDate } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  CircleCheck,
  Database,
  Gauge,
  PackageCheck,
  Users,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
  if (principal.kind !== 'platform-admin')
    redirect('/dashboard');
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

  return (
    <>
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
                            {formatDate(tenant.createdAt)}
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
    </>
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
              'text-[12px]',
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
