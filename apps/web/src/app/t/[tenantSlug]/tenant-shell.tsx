'use client';

import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  Activity,
  Bell,
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  Menu,
  PackageCheck,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  segment?: string;
};

const navigation: NavigationItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, segment: '' },
  { label: 'Ứng dụng', icon: PackageCheck, segment: '/applications' },
  { label: 'Sơ đồ tổ chức', icon: GitBranch, segment: '/organization' },
  { label: 'Người dùng', icon: Users, segment: '/users' },
  { label: 'Báo cáo', icon: Activity },
  { label: 'Cài đặt', icon: Settings },
];

export function TenantShell({
  children,
  tenantSlug,
}: {
  children: ReactNode;
  tenantSlug: string;
}) {
  const pathname = usePathname();
  const tenantRoot = `/t/${tenantSlug}`;
  const isPublicPage =
    pathname === `${tenantRoot}/login` ||
    pathname === `${tenantRoot}/reset-password`;

  if (isPublicPage) return children;

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2d]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/10 bg-[#091426] px-2 py-4 text-slate-200 lg:flex">
        <Brand />
        <TenantNavigation pathname={pathname} tenantRoot={tenantRoot} />
        <div className="mt-auto px-2">
          <SessionLogoutButton
            loginPath={`${tenantRoot}/login`}
            portal="tenant"
            tone="dark"
          />
        </div>
      </aside>

      <div className="min-h-screen lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8">
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
            <SheetContent
              className="w-72 border-slate-800 bg-[#091426] text-white"
              side="left"
            >
              <SheetHeader>
                <SheetTitle className="text-white">
                  Enterprise Portal
                </SheetTitle>
                <SheetDescription className="text-slate-400">
                  Tenant Admin
                </SheetDescription>
              </SheetHeader>
              <TenantNavigation pathname={pathname} tenantRoot={tenantRoot} />
            </SheetContent>
          </Sheet>

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
            <Button className="hidden sm:inline-flex" variant="outline">
              Support
            </Button>
            <Button className="hidden bg-[#091426] hover:bg-[#1e293b] sm:inline-flex">
              Upgrade
            </Button>
            <Avatar>
              <AvatarFallback className="bg-slate-200 text-xs font-medium text-slate-700">
                TT
              </AvatarFallback>
            </Avatar>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-7 flex items-center gap-2 px-2">
      <div className="grid size-8 place-items-center rounded-md bg-white font-bold text-[#091426]">
        A
      </div>
      <div>
        <p className="text-sm font-semibold text-white">Enterprise Portal</p>
        <p className="text-xs text-sky-300">Tenant Admin</p>
      </div>
    </div>
  );
}

function TenantNavigation({
  pathname,
  tenantRoot,
}: {
  pathname: string;
  tenantRoot: string;
}) {
  return (
    <nav className="space-y-1" aria-label="Điều hướng tenant">
      {navigation.map(({ label, icon: Icon, segment }) => {
        const href = segment === undefined ? '#' : `${tenantRoot}${segment}`;
        const active =
          segment === ''
            ? pathname === tenantRoot
            : segment !== undefined && pathname.startsWith(href);
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md border-r-4 border-transparent px-3 py-2 text-sm transition-colors',
              active
                ? 'border-slate-300 bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            )}
            href={href}
            key={label}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
