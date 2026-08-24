import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantEntitlementOverview } from '@enterprise-platform/contracts-tenancy';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  BarChart3,
  Bell,
  Building2,
  CircleHelp,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Search,
  ServerCog,
  Settings,
  Users,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import { TenantEntitlements } from './tenant-entitlements';

const navigation = [
  { label: 'Bảng điều khiển', icon: LayoutDashboard, href: '/platform' },
  { label: 'Khách hàng', icon: Users, href: '/platform/tenants', active: true },
  { label: 'Dịch vụ', icon: ServerCog, href: '#' },
  { label: 'Hóa đơn', icon: ReceiptText, href: '#' },
  { label: 'Báo cáo', icon: BarChart3, href: '#' },
  { label: 'Cài đặt', icon: Settings, href: '#' },
];

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default async function TenantEntitlementsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const meResponse = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!meResponse.ok) redirect('/platform/login');

  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin')
    redirect(`/t/${principal.tenantSlug}`);

  const overviewResponse = await fetch(
    `${api}/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/modules`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (overviewResponse.status === 404) notFound();
  if (!overviewResponse.ok) {
    throw new Error('Không thể tải entitlement của tenant.');
  }
  const overview = (await overviewResponse.json()) as TenantEntitlementOverview;
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
                  aria-label="Mở điều hướng"
                  className="lg:hidden"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent className="w-72 bg-[#091426] text-white" side="left">
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
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Tìm kiếm"
              className="h-9 bg-slate-50 pl-9"
              placeholder="Tìm kiếm..."
            />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button aria-label="Thông báo" size="icon" variant="ghost" />
                }
              >
                <Bell />
              </TooltipTrigger>
              <TooltipContent>Thông báo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button aria-label="Trợ giúp" size="icon" variant="ghost" />
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
          <nav
            aria-label="Breadcrumb"
            className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            <Link className="hover:text-[#091426]" href="/platform">
              Quản trị hệ thống
            </Link>
            <span>/</span>
            <Link className="hover:text-[#091426]" href="/platform/tenants">
              Khách hàng
            </Link>
            <span>/</span>
            <span>{overview.tenant.name}</span>
            <span>/</span>
            <span className="font-medium text-[#091426]">Modules</span>
          </nav>

          <div className="mb-7">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Modules của {overview.tenant.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Quản lý module và entitlement được cấp cho tenant. Provisioning
              chỉ chạy migration thuộc schema của module được chọn.
            </p>
          </div>

          <TenantEntitlements initialOverview={overview} />
        </main>
      </div>
    </div>
  );
}

function PlatformNavigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      aria-label="Điều hướng platform"
      className={cn('space-y-1', mobile && 'px-4')}
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
