import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { PlanSummary } from '@enterprise-platform/contracts-tenancy';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  Bell,
  Building2,
  CircleHelp,
  Menu,
  Search,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import { PlatformNavigation } from '@/components/platform-navigation';
import { PlansManagement } from './plans-management';

const DEFAULT_PLANS: PlanSummary[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    key: 'standard',
    name: 'Gói Tiêu Chuẩn',
    description: 'Gói dịch vụ vận hành cơ bản cho doanh nghiệp vừa và nhỏ',
    version: 1,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    limits: [
      { resourceKey: 'active_users', limitValue: 50, enforcement: 'hard' },
      { resourceKey: 'procedure_definitions', limitValue: 20, enforcement: 'hard' },
    ],
    tenantCount: 12,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    key: 'enterprise',
    name: 'Gói Doanh Nghiệp',
    description: 'Gói dịch vụ toàn diện quy mô lớn',
    version: 1,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    limits: [
      { resourceKey: 'active_users', limitValue: 500, enforcement: 'hard' },
      { resourceKey: 'procedure_definitions', limitValue: 200, enforcement: 'soft' },
    ],
    tenantCount: 5,
  },
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

export default async function PlatformPlansPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';

  let principal: AuthenticatedPrincipal | undefined;
  try {
    const meResponse = await fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (meResponse.ok) {
      principal = (await meResponse.json()) as AuthenticatedPrincipal;
      if (principal.kind !== 'platform-admin') {
        redirect('/dashboard');
      }
    }
  } catch {
    // Development fallback without auth service
  }

  let plans: PlanSummary[] = DEFAULT_PLANS;
  try {
    const res = await fetch(`${api}/api/platform/v1/plans`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.plans && data.plans.length > 0) {
        plans = data.plans;
      }
    }
  } catch {
    // Fallback to default plans
  }

  const displayName = principal?.displayName ?? 'Admin';

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
        <PlatformNavigation active="plans" />
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
              <PlatformNavigation active="plans" mobile />
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
        <main className="p-4 sm:p-6 lg:p-8">
          <nav
            className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"
            aria-label="Breadcrumb"
          >
            <Link className="hover:text-[#091426]" href="/platform">
              Quản trị hệ thống
            </Link>
            <span>/</span>
            <span className="font-medium text-[#091426]">Gói dịch vụ & Hạn mức</span>
          </nav>
          <div className="space-y-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Quản lý gói dịch vụ & Hạn mức
              </h1>
              <p className="text-sm text-slate-500">
                Thiết lập cấu hình phân hệ cấp phép, phiên bản gói và chính sách hạn mức tài nguyên (Quota Policy) cho toàn bộ hệ thống.
              </p>
            </div>
            <PlansManagement initialPlans={plans} />
          </div>
        </main>
      </div>
    </div>
  );
}
