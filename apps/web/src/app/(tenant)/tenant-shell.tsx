'use client';

import { revokeSession } from '@enterprise-platform/shared-ui';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  Bell,
  Building2,
  ChevronDown,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  User,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  external?: boolean;
};

type NavigationSection = {
  sectionTitle: string;
  items: NavigationItem[];
};

const navigationSections: NavigationSection[] = [
  {
    sectionTitle: 'Tổng quan & Ứng dụng',
    items: [
      { label: 'Bảng điều khiển', icon: LayoutDashboard, segment: '' },
      { label: 'Ứng dụng phân hệ', icon: PackageCheck, segment: '/applications' },
    ],
  },
  {
    sectionTitle: 'Tổ chức & Bộ máy',
    items: [
      { label: 'Sơ đồ tổ chức', icon: GitBranch, segment: '/organization' },
    ],
  },
  {
    sectionTitle: 'Quản trị danh tính & Truy cập',
    items: [
      { label: 'Tài khoản người dùng', icon: Users, segment: '/users' },
      { label: 'Vai trò & phân quyền', icon: ShieldCheck, segment: '/authorization' },
    ],
  },
];

export function TenantShell({
  children,
  canManage,
  permissions,
  principal,
}: {
  children: ReactNode;
  canManage: boolean;
  permissions: readonly string[];
  principal?: AuthenticatedPrincipal;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ep_sidebar_collapsed');
      if (saved !== null) {
        setCollapsed(saved === 'true');
      }
    } catch {
      // ignore local storage errors
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev: boolean) => {
      const next = !prev;
      try {
        localStorage.setItem('ep_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await revokeSession();
      window.location.replace('/');
    } catch {
      window.location.replace('/');
    }
  };

  const userInitials = principal?.displayName
    ? principal.displayName
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'EP';

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0d1c2d]">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/10 bg-[#091426] py-4 text-slate-200 transition-all duration-300 ease-in-out lg:flex',
          collapsed ? 'w-16 px-1.5' : 'w-64 px-2',
        )}
      >
        <Brand collapsed={collapsed} onToggle={toggleCollapsed} />
        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-0.5 custom-scrollbar">
          <TenantNavigation
            canManage={canManage}
            permissions={permissions}
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>
      </aside>

      <div
        className={cn(
          'min-h-screen transition-all duration-300 ease-in-out',
          collapsed ? 'lg:pl-16' : 'lg:pl-64',
        )}
      >
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
              className="w-72 border-slate-800 bg-[#091426] text-white flex flex-col p-4"
              side="left"
            >
              <SheetHeader className="mb-4">
                <div className="flex items-center gap-3 text-left">
                  <img
                    src="/brand-logo.jpg"
                    alt="SVN DTS Logo"
                    width={32}
                    height={32}
                    style={{
                      width: '32px',
                      height: '32px',
                      maxWidth: '32px',
                      maxHeight: '32px',
                    }}
                    className="size-8 rounded-md object-contain bg-white p-0.5 shadow border border-white/20 shrink-0"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div>
                    <SheetTitle className="text-white text-base">
                      Enterprise Portal
                    </SheetTitle>
                    <SheetDescription className="text-sky-300 text-xs">
                      Tenant Admin
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                <TenantNavigation
                  canManage={canManage}
                  permissions={permissions}
                  pathname={pathname}
                  collapsed={false}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Top Header Bar Right: Bell Notification + User Info & Avatar Dropdown */}
          <div className="ml-auto flex items-center gap-3.5">
            {/* Notification Bell */}
            <button
              type="button"
              className="relative inline-flex items-center justify-center size-9 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer shadow-2xs"
              title="Thông báo hệ thống"
              aria-label="Thông báo"
            >
              <Bell className="size-4" />
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>

            {/* Avatar Header Dropdown Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-2.5 pl-2.5 py-1 pr-1.5 border-l border-slate-200 rounded-lg hover:bg-slate-100/70 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Menu tài khoản cá nhân"
                  />
                }
              >
                <Avatar className="size-9 border border-slate-200 shadow-xs">
                  <AvatarFallback className="bg-[#091426] text-xs font-bold text-white">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-bold text-slate-900 leading-tight">
                    {principal?.displayName ?? 'Quản trị viên'}
                  </span>
                  <span className="text-[11px] text-slate-500 leading-tight">
                    {principal?.kind === 'tenant-user'
                      ? `${principal.tenantSlug.toUpperCase()} · Quản trị`
                      : 'Platform Admin'}
                  </span>
                </div>
                <ChevronDown className="size-3.5 text-slate-400 ml-0.5 hidden sm:block" />
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                className="w-64 p-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-900 shadow-xl"
              >
                {/* Header Profile Summary */}
                <div className="px-2.5 py-2 mb-1 rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {principal?.displayName ?? 'Quản trị viên'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {principal?.email ?? 'admin@enterprise.local'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                      {principal?.roles?.[0] ?? 'tenant-admin'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ID: {principal?.kind === 'tenant-user' ? principal.tenantSlug.toUpperCase() : 'SYS'}
                    </span>
                  </div>
                </div>

                <DropdownMenuSeparator className="my-1 border-slate-100" />

                {/* Nhóm Cài đặt Tài khoản User */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Tài khoản cá nhân
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/users"
                        className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      />
                    }
                  >
                    <User className="size-3.5 text-slate-500" />
                    <span>Hồ sơ & Đổi ảnh đại diện</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/reset-password"
                        className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      />
                    }
                  >
                    <KeyRound className="size-3.5 text-slate-500" />
                    <span>Đổi mật khẩu & Bảo mật</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator className="my-1 border-slate-100" />

                {/* Nhóm Hồ sơ Nhân sự & Nghiệp vụ */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Không gian làm việc
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    render={
                      <a
                        href="/t/savina/hrm"
                        className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      />
                    }
                  >
                    <UserCheck className="size-3.5 text-emerald-600" />
                    <span>Hồ sơ nhân sự của tôi (HRM)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/organization"
                        className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      />
                    }
                  >
                    <Building2 className="size-3.5 text-blue-600" />
                    <span>Cơ cấu tổ chức & Phòng ban</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator className="my-1 border-slate-100" />

                {/* Đăng xuất */}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-red-600 rounded-md hover:bg-red-50 focus:bg-red-50 cursor-pointer"
                >
                  <LogOut className="size-3.5 text-red-600" />
                  <span>{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Brand({
  collapsed,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={cn(
        'mb-5 flex items-center justify-between transition-all border-b border-white/10 pb-4',
        collapsed ? 'flex-col gap-3 px-0 items-center' : 'px-2 gap-2',
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src="/brand-logo.jpg"
          alt="SVN DTS Logo"
          width={32}
          height={32}
          style={{
            width: '32px',
            height: '32px',
            maxWidth: '32px',
            maxHeight: '32px',
          }}
          className="size-8 rounded-md object-contain bg-white p-0.5 shadow border border-white/20 shrink-0"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-sm font-semibold text-white truncate">Enterprise Portal</p>
            <p className="text-[11px] font-medium text-sky-400 truncate">Tenant Admin Console</p>
          </div>
        )}
      </div>

      {/* Top Toggle Button next to Logo */}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu nhỏ thanh điều hướng'}
          aria-label={collapsed ? 'Mở rộng điều hướng' : 'Thu nhỏ điều hướng'}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
      )}
    </div>
  );
}

function TenantNavigation({
  canManage,
  permissions,
  pathname,
  collapsed = false,
}: {
  canManage: boolean;
  permissions: readonly string[];
  pathname: string;
  collapsed?: boolean;
}) {
  return (
    <nav className="space-y-5" aria-label="Điều hướng tenant">
      {navigationSections.map((section) => {
        const filteredItems = section.items.filter((item) => {
          if (item.segment === '/authorization') return canManage;
          if (item.segment === '/users')
            return canManage || permissions.includes('core.users.read');
          if (item.segment === '/organization')
            return canManage || permissions.includes('core.organization.read');
          return true;
        });

        if (filteredItems.length === 0) return null;

        return (
          <div key={section.sectionTitle} className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {section.sectionTitle}
              </p>
            ) : (
              <div className="mx-auto my-2 h-px w-8 bg-white/10" />
            )}

            {filteredItems.map(({ label, icon: Icon, segment }) => {
              const href = segment === undefined ? '#' : segment || '/dashboard';
              const active =
                segment === ''
                  ? pathname === '/dashboard'
                  : segment !== undefined && pathname.startsWith(href);
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center rounded-md border-r-4 border-transparent py-2 text-sm transition-colors font-medium',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                    active
                      ? 'border-sky-400 bg-white/10 text-white shadow-xs font-semibold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white',
                  )}
                  href={href}
                  key={label}
                  title={collapsed ? label : undefined}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-sky-300' : 'text-slate-400',
                    )}
                  />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

