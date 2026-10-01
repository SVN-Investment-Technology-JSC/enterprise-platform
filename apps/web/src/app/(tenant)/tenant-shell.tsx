'use client';

import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { NotificationProvider } from '@enterprise-platform/shared-ui';
import {
  GitBranch,
  LayoutDashboard,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { TopNavHeaderActions } from '@/components/top-nav-header-actions';
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
  displayName,
  role,
}: {
  children: ReactNode;
  canManage: boolean;
  permissions: readonly string[];
  principal?: AuthenticatedPrincipal;
  displayName?: string;
  role?: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(false);

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

  return (
    <NotificationProvider>
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

            <TopNavHeaderActions
              displayName={displayName ?? principal?.displayName}
              role={role ?? (principal?.roles?.[0] || 'Tenant Admin')}
            />
          </header>
          {children}
        </div>
      </div>
    </NotificationProvider>
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

