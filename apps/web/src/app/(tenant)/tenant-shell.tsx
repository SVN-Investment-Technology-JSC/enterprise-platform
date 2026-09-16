'use client';

import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import {
  GitBranch,
  LayoutDashboard,
  Menu,
  PackageCheck,
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
];

export function TenantShell({
  children,
  canManage,
}: {
  children: ReactNode;
  canManage: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2d]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/10 bg-[#091426] px-2 py-4 text-slate-200 lg:flex">
        <Brand />
        <TenantNavigation canManage={canManage} pathname={pathname} />
        <div className="mt-auto px-2">
          <SessionLogoutButton
            loginPath="/"
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
              <TenantNavigation canManage={canManage} pathname={pathname} />
            </SheetContent>
          </Sheet>

          <div className="ml-auto flex items-center gap-2">
            <Avatar>
              <AvatarFallback className="bg-slate-200 text-xs font-medium text-slate-700">
                EP
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
  canManage,
  pathname,
}: {
  canManage: boolean;
  pathname: string;
}) {
  return (
    <nav className="space-y-1" aria-label="Điều hướng tenant">
      {navigation.filter((item) => item.segment !== '/users' || canManage).map(({ label, icon: Icon, segment }) => {
        const href = segment === undefined ? '#' : segment || '/dashboard';
        const active =
          segment === ''
            ? pathname === '/dashboard'
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
