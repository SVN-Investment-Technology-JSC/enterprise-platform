import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantStatus, TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { formatDate } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  Database,
  FileUp,
  Layers,
  Lock,
  Palette,
  ShieldCheck,
  Sparkles,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STATUS_META: Record<TenantStatus, { label: string; dot: string; badge: string }> = {
  active: { label: 'Hoạt động', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
  disabled: { label: 'Tạm khóa', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700' },
  deleting: { label: 'Đang xoá', dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600' },
  deletion_failed: { label: 'Xoá lỗi', dot: 'bg-red-500', badge: 'bg-red-50 text-red-700' },
};

const STATUS_ORDER: readonly TenantStatus[] = ['active', 'disabled', 'deleting', 'deletion_failed'];

const MONTH_COUNT = 6;

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return letters || 'TN';
}

function SectionTitle({
  title,
  hint,
  href,
  hrefLabel,
}: {
  title: string;
  hint?: string;
  href?: '/platform/plans' | '/platform/tenants' | '/platform/data-import';
  hrefLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[var(--ep-link,#1d4ed8)] hover:underline"
        >
          {hrefLabel ?? 'Xem tất cả'} <ChevronRight className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  note,
  noteTone = 'muted',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note: string;
  noteTone?: 'muted' | 'good' | 'warn';
}) {
  return (
    <div className="py-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold tracking-tight text-slate-900">{value}</span>
        {unit ? <span className="text-sm font-medium text-slate-500">{unit}</span> : null}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xs font-medium',
          noteTone === 'good' && 'text-emerald-600',
          noteTone === 'warn' && 'text-amber-600',
          noteTone === 'muted' && 'text-slate-500',
        )}
      >
        {note}
      </p>
    </div>
  );
}

function Attention({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: 'warn' | 'danger';
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-xs text-slate-700">
      <Icon
        className={cn('mt-0.5 size-3.5 shrink-0', tone === 'danger' ? 'text-red-600' : 'text-amber-600')}
      />
      <span>{children}</span>
    </li>
  );
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

  const total = tenants.length;
  const statusCount = STATUS_ORDER.map((status) => ({
    status,
    count: tenants.filter((tenant) => tenant.status === status).length,
  }));
  const countOf = (status: TenantStatus) => statusCount.find((item) => item.status === status)?.count ?? 0;
  const activeCount = countOf('active');
  const disabledCount = countOf('disabled');
  const deletingCount = countOf('deleting');
  const failedCount = countOf('deletion_failed');
  const activeRate = total > 0 ? Math.round((activeCount / total) * 100) : 100;

  const withDatabase = tenants.filter((tenant) => Boolean(tenant.database));
  const missingDatabase = total - withDatabase.length;
  const sslCount = withDatabase.filter((tenant) => tenant.database?.ssl).length;
  const databaseStatus = new Map<string, number>();
  const databaseHosts = new Map<string, number>();
  for (const tenant of withDatabase) {
    const db = tenant.database;
    if (!db) continue;
    databaseStatus.set(db.status, (databaseStatus.get(db.status) ?? 0) + 1);
    databaseHosts.set(db.host, (databaseHosts.get(db.host) ?? 0) + 1);
  }
  const databaseIssues = withDatabase.filter((tenant) => tenant.database?.status !== 'active').length;

  const moduleSummary = new Map<string, { key: string; name: string; count: number; versions: Set<string> }>();
  let activations = 0;
  let withoutModule = 0;
  for (const tenant of tenants) {
    const activeModules = tenant.modules.filter((module) => module.status === 'active');
    if (activeModules.length === 0) withoutModule += 1;
    for (const module of activeModules) {
      activations += 1;
      const current = moduleSummary.get(module.key) ?? {
        key: module.key,
        name: module.name,
        count: 0,
        versions: new Set<string>(),
      };
      current.count += 1;
      current.versions.add(module.version);
      moduleSummary.set(module.key, current);
    }
  }
  const moduleUsage = Array.from(moduleSummary.values()).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'vi'),
  );
  const averageModules = total > 0 ? (activations / total).toFixed(1).replace(/\.0$/, '') : '0';

  const sortedTenants = [...tenants].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const listedTenants = sortedTenants.slice(0, 8);
  const withoutAdmin = tenants.filter((tenant) => !tenant.admin).length;

  const now = new Date();
  const months = Array.from({ length: MONTH_COUNT }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (MONTH_COUNT - 1 - index), 1);
    return { year: date.getFullYear(), month: date.getMonth(), label: `T${date.getMonth() + 1}`, count: 0 };
  });
  for (const tenant of tenants) {
    const created = new Date(tenant.createdAt);
    const slot = months.find(
      (item) => item.year === created.getFullYear() && item.month === created.getMonth(),
    );
    if (slot) slot.count += 1;
  }
  const monthMax = Math.max(1, ...months.map((item) => item.count));
  const newThisMonth = months[months.length - 1]?.count ?? 0;

  const issues: { key: string; tone: 'warn' | 'danger'; text: string }[] = [];
  if (failedCount > 0) issues.push({ key: 'failed', tone: 'danger', text: `${failedCount} tổ chức xoá lỗi, cần xử lý thủ công.` });
  if (databaseIssues > 0) issues.push({ key: 'db-status', tone: 'danger', text: `${databaseIssues} cơ sở dữ liệu chưa ở trạng thái hoạt động.` });
  if (disabledCount > 0) issues.push({ key: 'disabled', tone: 'warn', text: `${disabledCount} tổ chức đang tạm khóa.` });
  if (deletingCount > 0) issues.push({ key: 'deleting', tone: 'warn', text: `${deletingCount} tổ chức đang trong tiến trình xoá.` });
  if (missingDatabase > 0) issues.push({ key: 'no-db', tone: 'warn', text: `${missingDatabase} tổ chức chưa gán cơ sở dữ liệu.` });
  if (withoutAdmin > 0) issues.push({ key: 'no-admin', tone: 'warn', text: `${withoutAdmin} tổ chức chưa có quản trị viên.` });
  if (withoutModule > 0) issues.push({ key: 'no-module', tone: 'warn', text: `${withoutModule} tổ chức chưa kích hoạt phân hệ nào.` });
  const hasDanger = issues.some((issue) => issue.tone === 'danger');

  return (
    <div className="flex flex-col gap-6 pb-4">
      {/* Tiêu đề trang */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tổng quan nền tảng</h1>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                issues.length === 0 ? 'bg-emerald-50 text-emerald-700' : hasDanger ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  issues.length === 0 ? 'bg-emerald-500' : hasDanger ? 'bg-red-500' : 'bg-amber-500',
                )}
              />
              {issues.length === 0 ? 'Vận hành ổn định' : `${issues.length} mục cần chú ý`}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Giám sát tổ chức, cơ sở dữ liệu và phân hệ trên toàn nền tảng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/platform/brand-studio"
            className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-100"
          >
            <Sparkles className="size-3.5 text-indigo-600" />
            Thư viện icon
          </Link>
          <Link
            href="/platform/tenants"
            className="inline-flex items-center gap-1.5 rounded bg-[#091426] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#12233f]"
          >
            <Plus className="size-3.5" />
            Quản lý tổ chức
          </Link>
        </div>
      </div>

      {/* Chỉ số chính: không khung, ngăn cách bằng đường kẻ */}
      <section
        aria-label="Chỉ số chính"
        className="grid grid-cols-2 gap-x-6 gap-y-4 divide-slate-200 border-y border-slate-200 py-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-0 lg:divide-x"
      >
        <Kpi label="Tổ chức" value={total} note={`${newThisMonth} tạo trong tháng`} />
        <Kpi
          label="Tỷ lệ hoạt động"
          value={activeRate}
          unit="%"
          note={`${activeCount}/${total} hoạt động`}
          noteTone={activeRate === 100 ? 'good' : 'warn'}
        />
        <Kpi
          label="Cơ sở dữ liệu"
          value={withDatabase.length}
          unit={`/ ${total}`}
          note={missingDatabase > 0 ? `${missingDatabase} chưa gán` : 'Đã gán đủ'}
          noteTone={missingDatabase > 0 ? 'warn' : 'good'}
        />
        <Kpi
          label="Phân hệ"
          value={moduleUsage.length}
          unit="loại"
          note={`${activations} lượt kích hoạt`}
        />
        <Kpi label="Phân hệ / tổ chức" value={averageModules} note="Trung bình đang bật" />
        <Kpi
          label="Kết nối bảo mật"
          value={sslCount}
          unit={`/ ${withDatabase.length}`}
          note="Cơ sở dữ liệu dùng SSL"
          noteTone={sslCount === withDatabase.length ? 'good' : 'warn'}
        />
      </section>

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-12">
        {/* Cột trái: danh sách tổ chức + xu hướng + phân hệ */}
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-8">
          <section>
            <SectionTitle
              title="Tổ chức gần đây"
              hint={`${listedTenants.length} trong ${total} tổ chức, sắp theo ngày tạo mới nhất.`}
              href="/platform/tenants"
            />
            <div className="mt-3 overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Tổ chức</th>
                    <th className="px-3 py-2.5">Quản trị viên</th>
                    <th className="px-3 py-2.5">Phân hệ</th>
                    <th className="px-3 py-2.5">Cơ sở dữ liệu</th>
                    <th className="px-3 py-2.5">Trạng thái</th>
                    <th className="px-4 py-2.5 text-right">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listedTenants.length > 0 ? (
                    listedTenants.map((tenant) => {
                      const meta = STATUS_META[tenant.status] ?? STATUS_META.disabled;
                      const activeModules = tenant.modules.filter((module) => module.status === 'active');
                      return (
                        <tr key={tenant.id} className="transition-colors hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/platform/tenants/${tenant.id}`}
                              className="flex items-center gap-2.5"
                            >
                              <span className="flex size-8 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-700">
                                {initialsOf(tenant.name)}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-slate-900">{tenant.name}</span>
                                <span className="block truncate font-mono text-xs text-slate-500">@{tenant.slug}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            {tenant.admin ? (
                              <>
                                <span className="block truncate text-slate-800">{tenant.admin.displayName}</span>
                                <span className="block truncate text-xs text-slate-500">{tenant.admin.email}</span>
                              </>
                            ) : (
                              <span className="text-xs text-amber-600">Chưa có</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-semibold text-slate-800">{activeModules.length}</span>
                            <span className="text-xs text-slate-500"> / {tenant.modules.length}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            {tenant.database ? (
                              <>
                                <span className="flex items-center gap-1 font-mono text-xs text-slate-800">
                                  <Database className="size-3 text-slate-400" />
                                  {tenant.database.databaseName}
                                  {tenant.database.ssl ? <Lock className="size-3 text-emerald-600" /> : null}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-slate-500">
                                  {tenant.database.host}:{tenant.database.port}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-amber-600">Chưa gán</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                                meta.badge,
                              )}
                            >
                              <span className={cn('size-1.5 rounded-full', meta.dot)} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-slate-600">
                            {formatDate(tenant.createdAt)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                        Chưa có tổ chức nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {total > listedTenants.length ? (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                  Còn {total - listedTenants.length} tổ chức khác.{' '}
                  <Link href="/platform/tenants" className="font-semibold text-[var(--ep-link,#1d4ed8)] hover:underline">
                    Xem toàn bộ
                  </Link>
                </div>
              ) : null}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <section>
              <SectionTitle
                title="Phân hệ đang sử dụng"
                hint="Số tổ chức bật từng phân hệ."
                href="/platform/plans"
                hrefLabel="Gói dịch vụ"
              />
              <ul className="mt-3 space-y-3">
                {moduleUsage.length > 0 ? (
                  moduleUsage.map((module) => {
                    const pct = total > 0 ? Math.round((module.count / total) * 100) : 0;
                    return (
                      <li key={module.key}>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="truncate font-semibold text-slate-800">{module.name}</span>
                          <span className="shrink-0 text-slate-500">
                            {module.count} tổ chức
                            <span className="ml-1.5 font-bold text-slate-900">{pct}%</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-indigo-600"
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          />
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          {module.key} · v{Array.from(module.versions).sort().join(', v')}
                        </p>
                      </li>
                    );
                  })
                ) : (
                  <li className="py-4 text-xs text-slate-500">Chưa có phân hệ nào được kích hoạt.</li>
                )}
              </ul>
            </section>

            <section>
              <SectionTitle
                title="Tổ chức mới theo tháng"
                hint={`${MONTH_COUNT} tháng gần nhất.`}
              />
              <div className="mt-3 flex h-36 items-end gap-3 border-b border-slate-200 px-1">
                {months.map((item) => (
                  <div key={`${item.year}-${item.month}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-xs font-semibold text-slate-700">{item.count}</span>
                    <div
                      className={cn('w-full rounded-t-sm', item.count > 0 ? 'bg-indigo-600' : 'bg-slate-200')}
                      style={{ height: `${item.count > 0 ? Math.max((item.count / monthMax) * 80, 8) : 3}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 px-1 pt-1.5">
                {months.map((item) => (
                  <span key={`${item.year}-${item.month}-label`} className="flex-1 text-center text-[11px] text-slate-500">
                    {item.label}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Cột phải: không khung, các mục ngăn cách bằng đường kẻ */}
        <aside className="flex min-w-0 flex-col divide-y divide-slate-200 lg:col-span-4 [&>section]:py-5 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
          <section>
            <SectionTitle title="Cần chú ý" />
            {issues.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {issues.map((issue) => (
                  <Attention key={issue.key} icon={AlertTriangle} tone={issue.tone}>
                    {issue.text}
                  </Attention>
                ))}
              </ul>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                <ShieldCheck className="size-3.5 shrink-0" />
                Tất cả tổ chức và cơ sở dữ liệu đang vận hành bình thường.
              </p>
            )}
          </section>

          <section>
            <SectionTitle title="Phân bố trạng thái" hint={`${total} tổ chức`} />
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-200">
              {statusCount
                .filter((item) => item.count > 0)
                .map((item) => (
                  <div
                    key={item.status}
                    className={STATUS_META[item.status].dot}
                    style={{ width: `${(item.count / total) * 100}%` }}
                    title={`${STATUS_META[item.status].label}: ${item.count}`}
                  />
                ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {statusCount.map((item) => (
                <li key={item.status} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-slate-700">
                    <span className={cn('size-2 rounded-full', STATUS_META[item.status].dot)} />
                    {STATUS_META[item.status].label}
                  </span>
                  <span className="font-semibold text-slate-900">{item.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle title="Hạ tầng cơ sở dữ liệu" hint="PostgreSQL, mỗi tổ chức một database." />
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-600">Máy chủ</dt>
                <dd className="font-semibold text-slate-900">{databaseHosts.size}</dd>
              </div>
              {Array.from(databaseStatus.entries()).map(([status, count]) => (
                <div key={status} className="flex justify-between">
                  <dt className="text-slate-600">
                    Trạng thái <span className="font-mono">{status}</span>
                  </dt>
                  <dd className="font-semibold text-slate-900">{count}</dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="text-slate-600">Dùng SSL</dt>
                <dd className="font-semibold text-slate-900">
                  {sslCount}/{withDatabase.length}
                </dd>
              </div>
            </dl>
            {databaseHosts.size > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {Array.from(databaseHosts.entries()).map(([host, count]) => (
                  <li key={host} className="flex items-center justify-between font-mono text-[11px] text-slate-600">
                    <span className="truncate">{host}</span>
                    <span className="ml-2 shrink-0 font-semibold text-slate-900">{count} DB</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section>
            <SectionTitle title="Lối tắt" />
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {(
                [
                  { href: '/platform/tenants', label: 'Quản lý tổ chức', icon: ArrowUpRight },
                  { href: '/platform/plans', label: 'Gói dịch vụ và hạn mức', icon: Layers },
                  { href: '/platform/data-import', label: 'Nhập dữ liệu', icon: FileUp },
                  { href: '/platform/brand-studio', label: 'Thư viện icon', icon: Sparkles },
                  { href: '/platform/brand-studio/standards', label: 'Bảng màu & quy chuẩn', icon: Palette },
                ] as const
              ).map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex items-center justify-between py-2 font-medium text-slate-700 transition-colors hover:text-[var(--ep-link,#1d4ed8)]"
                  >
                    <span className="flex items-center gap-2">
                      <link.icon className="size-3.5 text-slate-400" />
                      {link.label}
                    </span>
                    <ChevronRight className="size-3.5 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
