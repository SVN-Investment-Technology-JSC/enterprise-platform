'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { ModuleShell, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import {
  filterHrmNavigation,
  getActiveHrmNavId,
  hrmNavigation,
  hrmNavigationSections,
  normalizeHrmPath,
} from './hrm-navigation';
import {
  HrmPermissionsProvider,
  hrmPagePermissions,
  useHrmPermissions,
} from './hrm-permissions';

const COLLAPSED_KEY = 'hrm_sidebar_collapsed';

export function HrmShell({ children }: { children: ReactNode }) {
  return (
    <HrmPermissionsProvider>
      <ConfigProvider
        locale={viVN}
        componentSize="small"
        theme={{
          token: { colorPrimary: '#2563eb', fontSize: 12, borderRadius: 6 },
          components: {
            Table: { cellPaddingBlockSM: 6, cellPaddingInlineSM: 8 },
            Button: { controlHeightSM: 28 },
          },
        }}
      >
        <HrmShellContent>{children}</HrmShellContent>
      </ConfigProvider>
    </HrmPermissionsProvider>
  );
}

/**
 * Khung HRM dùng chung khung sáng của các module khác (Không gian làm việc, Kho, Bảo trì...): thanh bên có khối người dùng,
 * nhóm menu theo quyền, breadcrumb ngay đầu nội dung và không có thanh tiêu đề riêng, để nhường chỗ cho dữ liệu.
 */
function HrmShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const permissions = useHrmPermissions();
  const currentPath = normalizeHrmPath(pathname);
  const pagePermissions = hrmPagePermissions[currentPath];
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved !== null) setCollapsed(saved === 'true');
    } catch {
      /* không có localStorage thì giữ mặc định */
    }
  }, []);

  const changeCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      /* bỏ qua */
    }
  }, []);

  const activeNavId = getActiveHrmNavId(pathname) ?? 'dashboard';

  const nav = useMemo<ModuleNavItem[]>(() => {
    const sections = filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, permissions.any);
    return sections.flatMap((section) =>
      section.items.flatMap((item) => item.children ?? [item]).map((item) => {
        const Icon = item.icon;
        return {
          id: item.id,
          label: item.label,
          group: section.title,
          icon: <Icon className="size-4" aria-hidden />,
        };
      }),
    );
    // permissions.any đổi theo danh sách quyền; không phụ thuộc vào các trường khác của context.
  }, [permissions.any]);

  const onViewChange = useCallback(
    (id: string) => {
      const target = hrmNavigation.find((item) => item.id === id);
      if (target?.href) router.push(target.href);
    },
    [router],
  );

  return (
    <ModuleShell
      appearance="light"
      moduleKey="hrm"
      title="Nhân sự"
      nav={nav}
      view={activeNavId}
      onViewChange={onViewChange}
      homeHref="/applications"
      actor={permissions.displayName || undefined}
      collapsible
      collapsed={collapsed}
      onCollapsedChange={changeCollapsed}
    >
      <div className="hrm-workspace">
        {permissions.loading ? (
          <div role="status" className="flex items-center justify-center p-12 text-sm text-slate-500">
            <span className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Đang tải quyền HRM…
          </div>
        ) : permissions.error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-xs">
            <div className="mb-1 font-semibold">Không thể tải thông tin quyền hạn</div>
            <p>{permissions.error}</p>
          </div>
        ) : pagePermissions && !permissions.any(pagePermissions) ? (
          <div
            role="alert"
            className="mx-auto mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-xs"
          >
            <div className="mb-2 text-base font-bold">Chưa được cấp quyền truy cập</div>
            <p className="leading-relaxed">
              Tài khoản của bạn chưa được cấp quyền truy cập chức năng này. Quản trị tenant có thể cấp quyền tại màn hình
              Phân quyền của ERP.
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </ModuleShell>
  );
}
