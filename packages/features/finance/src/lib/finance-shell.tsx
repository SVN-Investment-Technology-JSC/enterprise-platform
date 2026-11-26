'use client';
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { ModuleShell, forwardEscapeToHost, type ModuleNavItem } from '@enterprise-platform/feature-module-shell';
import { AppIcon, type AppIconProps } from '@enterprise-platform/shared-ui';
import { FinanceCrumbsProvider } from './finance-crumbs';
import {
  financeNavigation,
  getActiveFinanceNavId,
  isFinanceEmbedPath,
  normalizeFinancePath,
  stripFinanceEmbed,
} from './finance-navigation';
import { FinancePermissionsProvider, useFinancePermissions } from './finance-permissions';

const FINANCE_NAV_SLOT: Partial<Record<string, AppIconProps['slot']>> = {
  dashboard: 'nav.dashboard',
  receipts: 'sidebar.finance.receipts',
  payments: 'sidebar.finance.payments',
  transfers: 'sidebar.finance.transfers',
  accounts: 'sidebar.finance.accounts',
  reports: 'nav.reports',
  settings: 'nav.settings',
};

/** Các mục đã nối slot từ trước giữ cỡ 16px; mục mới giữ đúng cỡ 18px của icon cũ. */
const FINANCE_NAV_SLOT_LEGACY_SIZE: ReadonlySet<string> = new Set(['dashboard', 'reports', 'settings']);

const COLLAPSED_KEY = 'finance_sidebar_collapsed';

export function FinanceShell({ children }: { children: ReactNode }) {
  return (
    <FinancePermissionsProvider>
      <ConfigProvider
        locale={viVN}
        componentSize="small"
        theme={{
          token: { colorPrimary: '#d9ab00', colorLink: '#1d4ed8', fontSize: 14, borderRadius: 8 },
          components: { Table: { cellPaddingBlockSM: 8, cellPaddingInlineSM: 10 } },
        }}
      >
        <FinanceShellContent>{children}</FinanceShellContent>
      </ConfigProvider>
    </FinancePermissionsProvider>
  );
}

/** Khung Tài chính dùng khung sáng chung của các module: thanh bên theo quyền, breadcrumb ngay đầu nội dung. */
function FinanceShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const permissions = useFinancePermissions();
  const currentPath = normalizeFinancePath(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [crumbs, setCrumbs] = useState<readonly string[]>([]);

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

  const nav = useMemo<ModuleNavItem[]>(
    () =>
      financeNavigation
        .filter((item) => permissions.canOpenPage(item.href))
        .map((item) => {
          const Icon = item.icon;
          const slot = FINANCE_NAV_SLOT[item.id];
          return {
            id: item.id,
            label: item.label,
            icon: slot ? (
              <AppIcon
                slot={slot}
                fallback={Icon}
                className={`${FINANCE_NAV_SLOT_LEGACY_SIZE.has(item.id) ? 'size-4' : 'size-[18px]'} ${item.tone}`}
              />
            ) : (
              <Icon className={`size-[18px] ${item.tone}`} aria-hidden />
            ),
          };
        }),
    [permissions],
  );

  const onViewChange = useCallback(
    (id: string) => {
      const target = financeNavigation.find((item) => item.id === id);
      if (target) router.push(target.href);
    },
    [router],
  );

  // Trang nhúng kiểm quyền theo trang gốc: `/embed/payments/<id>` cần quyền mở `/payments` như màn hình thường.
  const embedded = isFinanceEmbedPath(pathname);
  const gatedPath = stripFinanceEmbed(currentPath);
  const blocked = !permissions.loading && !permissions.error && !permissions.canOpenPage(gatedPath === '' ? '/' : topSegment(gatedPath));

  // Esc khi tiêu điểm đang trong trang nhúng: chuyển cho popup của bên chủ (nghe ở cấp tài liệu vì tiêu điểm có thể nằm ở thân trang).
  useEffect(() => {
    if (!embedded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => void forwardEscapeToHost(event);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [embedded]);

  const body = permissions.loading ? (
    <div role="status" className="flex items-center justify-center p-12 text-sm text-slate-500">
      <span className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-accent-strong border-t-transparent" />
      Đang tải quyền Tài chính…
    </div>
  ) : permissions.error ? (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-xs">
      <div className="mb-1 font-semibold">Không thể tải thông tin quyền hạn</div>
      <p>{permissions.error}</p>
    </div>
  ) : blocked ? (
    <div role="alert" className="mx-auto mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-xs">
      <div className="mb-2 text-base font-bold">Chưa được cấp quyền truy cập</div>
      <p className="leading-relaxed">
        Tài khoản của bạn chưa được cấp quyền truy cập chức năng này. Quản trị tenant có thể cấp quyền tại màn hình Phân quyền của ERP.
      </p>
    </div>
  ) : (
    children
  );

  // Trang nhúng trong popup của phân hệ khác: chỉ có nội dung, không thanh bên, breadcrumb hay Trợ lý lồng trong popup.
  if (embedded) {
    return (
      <FinanceCrumbsProvider value={setCrumbs}>
        <div className="finance-workspace fixed inset-0 min-h-0 overflow-auto bg-white" onClickCapture={openLinksOutsideFrame}>
          {body}
        </div>
      </FinanceCrumbsProvider>
    );
  }

  return (
    <FinanceCrumbsProvider value={setCrumbs}>
      <ModuleShell
        appearance="light"
        moduleKey="finance"
        title="Tài chính"
        nav={nav}
        view={getActiveFinanceNavId(pathname) ?? 'dashboard'}
        onViewChange={onViewChange}
        homeHref="/applications"
        crumbs={crumbs}
        collapsible
        collapsed={collapsed}
        onCollapsedChange={changeCollapsed}
      >
        <div className="finance-workspace">{body}</div>
      </ModuleShell>
    </FinanceCrumbsProvider>
  );
}

/**
 * Trang nhúng không có thanh bên để quay lại: liên kết sang nơi khác (hồ sơ quy trình, dự án…) mở ở thẻ mới, không tải
 * đè lên khung nhúng của popup.
 */
function openLinksOutsideFrame(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const anchor = (event.target as HTMLElement).closest('a[href]');
  const href = anchor?.getAttribute('href');
  if (!anchor || !href || href.startsWith('#') || anchor.hasAttribute('download')) return;
  event.preventDefault();
  window.open(href, '_blank', 'noopener');
}

/** `/receipts/abc` → `/receipts`: quyền kiểm theo trang gốc. */
function topSegment(path: string): string {
  const first = path.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}
