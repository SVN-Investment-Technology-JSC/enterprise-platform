'use client';

import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  ModuleShell,
  type ModuleNavItem,
} from '@enterprise-platform/feature-module-shell';
import {
  BarChart3,
  FileUp,
  LayoutDashboard,
  Layers,
  Palette,
  ReceiptText,
  ServerCog,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TenantQuickSearch, type QuickSearchEntry } from '../(tenant)/tenant-quick-search';

export type PlatformView =
  | 'dashboard'
  | 'tenants'
  | 'plans'
  | 'brand-studio'
  | 'brand-standards'
  | 'data-import'
  | 'services'
  | 'billing'
  | 'reports';

interface PlatformPage {
  readonly id: PlatformView;
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly icon: LucideIcon;
  readonly disabled?: boolean;
  /** Menu cha thu gọn được chứa mục này trên thanh bên. */
  readonly parent?: string;
}

const PAGES: readonly PlatformPage[] = [
  { id: 'dashboard', label: 'Bảng điều khiển', href: '/platform', group: 'Tổng quan & Quản trị', icon: LayoutDashboard },
  { id: 'tenants', label: 'Khách hàng (Tenants)', href: '/platform/tenants', group: 'Tổng quan & Quản trị', icon: Users },
  { id: 'plans', label: 'Gói dịch vụ & Hạn mức', href: '/platform/plans', group: 'Tổng quan & Quản trị', icon: Layers },
  { id: 'brand-studio', label: 'Thư viện icon', href: '/platform/brand-studio', group: 'Thương hiệu & Thiết kế', parent: 'Thương hiệu & Thiết kế', icon: Sparkles },
  { id: 'brand-standards', label: 'Bảng màu & quy chuẩn', href: '/platform/brand-studio/standards', group: 'Thương hiệu & Thiết kế', parent: 'Thương hiệu & Thiết kế', icon: Palette },
  { id: 'data-import', label: 'Nhập dữ liệu', href: '/platform/data-import', group: 'Dữ liệu & Tích hợp', icon: FileUp },
  { id: 'services', label: 'Dịch vụ hệ thống', href: '#', group: 'Hạ tầng & Hệ thống', icon: ServerCog, disabled: true },
  { id: 'billing', label: 'Hóa đơn & Thanh toán', href: '#', group: 'Hạ tầng & Hệ thống', icon: ReceiptText, disabled: true },
  { id: 'reports', label: 'Báo cáo nền tảng', href: '#', group: 'Hạ tầng & Hệ thống', icon: BarChart3, disabled: true },
];

const COLLAPSED_KEY = 'ep_platform_sidebar_collapsed';

export function PlatformShell({
  children,
  principal,
  displayName,
}: {
  children: ReactNode;
  principal?: AuthenticatedPrincipal;
  displayName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === 'true');
    } catch {
      // Trình duyệt chặn localStorage
    }
  }, []);

  const view: PlatformView = useMemo(() => {
    // Trang trình thiết kế (/platform/brand-studio/editor/...) thuộc về mục Thư viện icon.
    if (pathname.startsWith('/platform/brand-studio/standards')) return 'brand-standards';
    if (pathname.startsWith('/platform/brand-studio')) return 'brand-studio';
    if (pathname.startsWith('/platform/tenants')) return 'tenants';
    if (pathname.startsWith('/platform/data-import')) return 'data-import';
    if (pathname.startsWith('/platform/plans')) return 'plans';
    return 'dashboard';
  }, [pathname]);

  const nav: ModuleNavItem<PlatformView>[] = useMemo(() => {
    return PAGES.map((page) => {
      const Icon = page.icon;
      return {
        id: page.id,
        label: page.label,
        group: page.parent ? undefined : page.group,
        parent: page.parent,
        parentIcon: page.parent ? <Sparkles size={16} aria-hidden /> : undefined,
        icon: <Icon size={16} aria-hidden className={page.disabled ? 'opacity-40 text-slate-400' : undefined} />,
        badge: page.disabled ? 'Sắp ra mắt' : undefined,
      };
    });
  }, []);

  const searchEntries: QuickSearchEntry[] = useMemo(() => {
    return PAGES.filter((p) => !p.disabled && p.href !== '#').map((page) => ({
      id: `page:${page.id}`,
      group: page.group,
      label: page.label,
      hint: page.href,
      onSelect: () => router.push(page.href as never),
    }));
  }, [router]);

  return (
    <ModuleShell<PlatformView>
      actor={displayName ?? principal?.displayName}
      appearance="light"
      collapsed={collapsed}
      collapsible
      hideHomeButton
      hideModuleSwitcher
      homeHref="/platform"
      moduleKey="platform"
      nav={nav}
      onCollapsedChange={(next) => {
        setCollapsed(next);
        try {
          localStorage.setItem(COLLAPSED_KEY, String(next));
        } catch {
          // Bỏ qua nếu lỗi storage
        }
      }}
      onQuickSearch={() => setSearchOpen(true)}
      onViewChange={(next) => {
        const page = PAGES.find((item) => item.id === next);
        if (page?.disabled) {
          return; // Menu bị vô hiệu hóa, không thực hiện chuyển hướng
        }
        if (page && page.href !== '#') {
          router.push(page.href as never);
        }
      }}
      subtitle="Quản trị nền tảng SVNDTS"
      title="Platform Superadmin"
      view={view}
    >
      {children}
      <TenantQuickSearch
        entries={searchEntries}
        onClose={() => setSearchOpen(false)}
        open={searchOpen}
      />
    </ModuleShell>
  );
}
