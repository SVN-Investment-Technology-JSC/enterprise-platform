'use client';

import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  isLauncherOnlyModule,
  ModuleShell,
  type ModuleNavItem,
  type ModuleSidebarSection,
} from '@enterprise-platform/feature-module-shell';
import { authFetch } from '@enterprise-platform/shared-ui';
import {
  GitBranch,
  LayoutDashboard,
  PackageCheck,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { moduleAbbr, moduleTint } from './module-tint';
import { TenantQuickSearch, type QuickSearchEntry } from './tenant-quick-search';

type TenantView =
  | 'dashboard'
  | 'applications'
  | 'organization'
  | 'users'
  | 'authorization'
  | 'account';

interface TenantPage {
  readonly id: TenantView;
  readonly label: string;
  readonly href: string;
  readonly group: string;
  readonly icon: LucideIcon;
}

const PAGES: readonly TenantPage[] = [
  { id: 'dashboard', label: 'Bảng điều khiển', href: '/dashboard', group: 'Tổng quan & Ứng dụng', icon: LayoutDashboard },
  { id: 'applications', label: 'Ứng dụng phân hệ', href: '/applications', group: 'Tổng quan & Ứng dụng', icon: PackageCheck },
  { id: 'organization', label: 'Sơ đồ tổ chức', href: '/organization', group: 'Tổ chức & Bộ máy', icon: GitBranch },
  { id: 'users', label: 'Tài khoản người dùng', href: '/users', group: 'Quản trị danh tính & Truy cập', icon: Users },
  { id: 'authorization', label: 'Vai trò & phân quyền', href: '/authorization', group: 'Quản trị danh tính & Truy cập', icon: ShieldCheck },
  { id: 'account', label: 'Tài khoản của tôi', href: '/account', group: 'Cá nhân', icon: UserRound },
];

/** Phần của danh mục phân hệ mà thanh bên cần (cùng dạng `TenantModuleCatalogItem`). */
interface CatalogModule {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly launchUrl: string;
  readonly icon: string | null;
  readonly entitlementStatus: string;
}

const COLLAPSED_KEY = 'ep_sidebar_collapsed';

export function TenantShell({
  children,
  canManage,
  permissions,
  principal,
  displayName,
}: {
  children: ReactNode;
  canManage: boolean;
  permissions: readonly string[];
  principal?: AuthenticatedPrincipal;
  displayName?: string;
  role?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [modules, setModules] = useState<readonly CatalogModule[]>([]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === 'true');
    } catch {
      // Trình duyệt chặn localStorage thì giữ thanh bên mở.
    }
  }, []);

  useEffect(() => {
    let active = true;
    authFetch('/api/platform/v1/modules/catalog', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { modules: CatalogModule[] };
        if (active) {
          // Trợ lý mở bằng nút cạnh chuông Thông báo, không nằm trong danh sách ứng dụng.
          setModules(
            payload.modules.filter(
              (item) => item.entitlementStatus === 'active' && !isLauncherOnlyModule(item.key),
            ),
          );
        }
      })
      .catch(() => {
        // Không tải được danh mục thì mục "Ứng dụng đang dùng" trống; trang
        // Ứng dụng phân hệ vẫn mở được từ thanh bên.
      });
    return () => {
      active = false;
    };
  }, []);

  const pages = useMemo(
    () =>
      PAGES.filter((page) => {
        if (page.id === 'authorization') return canManage;
        if (page.id === 'users') return canManage || permissions.includes('core.users.read');
        if (page.id === 'organization') {
          return canManage || permissions.includes('core.organization.read');
        }
        return true;
      }),
    [canManage, permissions],
  );

  const view: TenantView =
    PAGES.find((page) => page.id !== 'dashboard' && pathname.startsWith(page.href))?.id ??
    'dashboard';

  const nav: ModuleNavItem<TenantView>[] = pages.map((page) => {
    const Icon = page.icon;
    return {
      id: page.id,
      label: page.label,
      group: page.group,
      icon: <Icon size={16} aria-hidden />,
    };
  });

  const openModule = (module: CatalogModule) => window.location.assign(module.launchUrl);

  const appsSection: ModuleSidebarSection = {
    id: 'modules',
    title: 'Ứng dụng đang dùng',
    count: modules.length,
    items: modules.map((module) => ({
      id: module.key,
      label: module.name,
      title: module.description || module.name,
      leading: <ModuleBadge module={module} />,
      onSelect: () => openModule(module),
    })),
    emptyText: 'Chưa có ứng dụng nào đang bật.',
  };

  const searchEntries: QuickSearchEntry[] = [
    ...pages.map((page) => ({
      id: `page:${page.id}`,
      group: 'Trang',
      label: page.label,
      hint: page.group,
      onSelect: () => router.push(page.href as never),
    })),
    ...modules.map((module) => ({
      id: `module:${module.key}`,
      group: 'Ứng dụng',
      label: module.name,
      hint: module.description || undefined,
      onSelect: () => openModule(module),
    })),
  ];

  return (
    <ModuleShell<TenantView>
      appearance="light"
      moduleKey="tenant-portal"
      title="Tenant Portal"
      homeHref="/dashboard"
      nav={nav}
      view={view}
      onViewChange={(next) => {
        const page = PAGES.find((item) => item.id === next);
        if (page) router.push(page.href as never);
      }}
      actor={displayName ?? principal?.displayName}
      tenantSlug={principal?.kind === 'tenant-user' ? principal.tenantSlug : undefined}
      collapsible
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        setCollapsed(next);
        try {
          localStorage.setItem(COLLAPSED_KEY, String(next));
        } catch {
          // Không lưu được thì lần sau mở lại theo mặc định.
        }
      }}
      onQuickSearch={() => setSearchOpen(true)}
      sidebarSections={[appsSection]}
    >
      {children}
      <TenantQuickSearch
        open={searchOpen}
        entries={searchEntries}
        onClose={() => setSearchOpen(false)}
      />
    </ModuleShell>
  );
}

function ModuleBadge({ module }: { module: CatalogModule }) {
  return (
    <span
      aria-hidden
      className={`grid h-6 min-w-[34px] place-items-center rounded-md px-1 text-[12px] font-extrabold ${moduleTint(module.key)}`}
    >
      {moduleAbbr(module)}
    </span>
  );
}
