import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  ArrowRight,
  Building2,
  ChevronRight,
  CreditCard,
  FileText,
  FolderKanban,
  PackageCheck,
  Settings,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface ModuleInfo {
  key: string;
  name: string;
  description: string;
  launchUrl: string;
  icon?: string;
  version: string;
  status: string;
}
const moduleIcons = {
  crm: Users,
  hrm: UserCog,
  dms: FolderKanban,
  accounting: Building2,
  workflow: Workflow,
} as const;
const quickActions = [
  { icon: UserPlus, label: 'Thêm người dùng' },
  { icon: UserCog, label: 'Quản lý vai trò' },
  { icon: Settings, label: 'Cài đặt công ty' },
];

export default async function TenantPortalPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, modulesResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${api}/api/platform/v1/modules`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);
  if (!meResponse.ok || !modulesResponse.ok) redirect(`/t/${tenantSlug}/login`);
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (principal.tenantSlug !== tenantSlug)
    redirect(`/t/${principal.tenantSlug}`);
  const modules = (await modulesResponse.json()) as ModuleInfo[];
  const displayName = principal.displayName || 'Tenant Admin';

  return (
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7">
        <Badge
          className="mb-3 rounded-md border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100"
          variant="outline"
        >
          {tenantSlug}
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Xin chào, {displayName}
        </h1>
      </div>
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Tổng quan tenant"
      >
        <MetricCard icon={Users} label="Người dùng hoạt động" value="128" />
        <MetricCard
          icon={PackageCheck}
          label="Module đã bật"
          value={String(modules.length)}
        />
        <MetricCard
          icon={Building2}
          label="Gói hiện tại"
          value="Enterprise"
          compact
        />
        <MetricCard
          icon={CreditCard}
          label="Đăng ký"
          value={
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              <span className="mr-1.5 size-1.5 rounded-full bg-emerald-700" />
              Đang hoạt động
            </Badge>
          }
          compact
        />
      </section>
      <div className="mt-8 grid gap-8 xl:grid-cols-3">
        <section
          className="xl:col-span-2"
          aria-labelledby="applications-heading"
        >
          <div className="mb-4 flex items-center justify-between border-b pb-3">
            <h2 id="applications-heading" className="text-xl font-semibold">
              Ứng dụng của tôi
            </h2>
            <Button
              nativeButton={false}
              render={<Link href={`/t/${tenantSlug}/applications`} />}
              size="sm"
              variant="ghost"
            >
              Xem tất cả <ArrowRight />
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map((module) => {
              const Icon =
                moduleIcons[module.key as keyof typeof moduleIcons] ?? FileText;
              const href =
                module.key === 'crm'
                  ? `/t/${tenantSlug}/crm`
                  : module.launchUrl;
              return (
                <Card
                  className="min-h-40 border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  key={module.key}
                >
                  <CardHeader className="pb-0">
                    <div className="flex items-center gap-2">
                      <div className="grid size-8 place-items-center rounded-md bg-slate-100 text-[#091426]">
                        <Icon className="size-4" />
                      </div>
                      <CardTitle>{module.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-4">
                    <p className="text-sm leading-5 text-muted-foreground">
                      {module.description}{' '}
                      <span className="text-xs">· v{module.version}</span>
                    </p>
                    <Link
                      className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-[#091426] hover:underline"
                      href={href}
                    >
                      Mở <ArrowRight className="size-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
            {modules.length === 0 ? (
              <Card className="sm:col-span-2">
                <CardContent className="py-10 text-center text-muted-foreground">
                  Tenant chưa có module đang hoạt động.
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
        <aside className="space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Thao tác nhanh (Admin)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickActions.map(({ icon: Icon, label }) => (
                <button
                  className="flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm transition hover:bg-slate-50"
                  key={label}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="size-4 text-slate-500" />
                    {label}
                  </span>
                  <ChevronRight className="size-4 text-slate-400" />
                </button>
              ))}
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Hoạt động gần đây</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ActivityItem
                icon={UserPlus}
                title="Đã mời người dùng mới"
                time="2 giờ trước"
              />
              <Separator />
              <ActivityItem
                icon={ShieldCheck}
                title="Thay đổi vai trò"
                time="Hôm qua, 14:30"
              />
              <Separator />
              <ActivityItem
                icon={Settings}
                title="Cập nhật cài đặt công ty"
                time="2 ngày trước"
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  compact = false,
}: {
  icon: typeof Users;
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Card className="gap-0 border-slate-200 bg-white py-5 shadow-sm">
      <CardContent>
        <div className="mb-3 flex items-start justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
          <span>{label}</span>
          <Icon className="size-4 text-[#091426]" />
        </div>
        <div
          className={cn(
            'font-bold text-slate-900',
            compact ? 'pt-1 text-xl' : 'text-3xl',
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
function ActivityItem({
  icon: Icon,
  title,
  time,
}: {
  icon: typeof UserPlus;
  title: string;
  time: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-500" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
