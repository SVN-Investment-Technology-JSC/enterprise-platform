'use client';
import {
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  getActiveHrmNavId,
  filterHrmNavigation,
  hrmNavigationSections,
  hrmPageTitle,
  normalizeHrmPath,
} from './hrm-navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NotificationProvider, revokeSession } from '@enterprise-platform/shared-ui';
import { hrmApiUrl, platformAuthApiUrl } from './hrm-api';
import { cn } from './utils';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import {
  HrmPermissionsProvider,
  hrmPagePermissions,
  useHrmPermissions,
} from './hrm-permissions';
import { HrmSidebarNav } from './ui/hrm-sidebar-nav';
import { TopNavHeaderActions } from './ui/top-nav-header-actions';

export function HrmShell({ children }: { children: ReactNode }) {
  return (
    <HrmPermissionsProvider>
      <NotificationProvider>
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
      </NotificationProvider>
    </HrmPermissionsProvider>
  );
}
/** Cấp bấm được trên breadcrumb: màu xanh chủ đạo để nhận ra ngay là link. */
const crumbLinkClass =
  '-mx-0.5 rounded px-1 py-0.5 font-semibold text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-600';

/** Phụ đề ngắn dưới tiêu đề từng trang (tiêu đề lấy từ nhãn menu). */
const HRM_PAGE_SUBTITLES: Record<string, string> = {
  '/': 'Việc cần làm và tình hình của bạn hôm nay.',
  '/approvals': 'Duyệt hoặc từ chối đơn của nhân viên thuộc phạm vi bạn phụ trách.',
  '/my-work': 'Lịch làm việc, chấm công và bảng công của chính bạn.',
  '/requests': 'Tạo, theo dõi và rút đơn của chính bạn.',
  '/profile': 'Hồ sơ, giấy tờ, người thân, lịch sử công tác và phiếu lương của bạn.',
  '/employees': 'Hồ sơ nhân viên, người phụ thuộc, quyết định nhân sự và quỹ phép.',
  '/timekeeping': 'Phân ca, bảng công, dữ liệu chấm công và danh mục ca.',
  '/payroll': 'Kỳ lương, phiếu lương, chi trả, ứng và thu hồi.',
  '/settings': 'Quy định công, lương, phép năm, vận hành và phân quyền.',
};

function HrmShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const permissions = useHrmPermissions();
  const currentPath = normalizeHrmPath(pathname);
  const pagePermissions = hrmPagePermissions[currentPath];
  const [tenantSlug, setTenantSlug] = useState('savina');
  const [loggingOut, setLoggingOut] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('hrm_sidebar_collapsed');
      if (saved !== null) {
        setIsCollapsed(saved === 'true');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('hrm_sidebar_collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const [currentUser, setCurrentUser] = useState({
    fullName: 'Người dùng',
    roleLabel: 'Tài khoản ERP',
    initials: 'HR',
  });

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

  /** Trang cha trên breadcrumb khi đang ở trang con (ví dụ Bảng lương khi ở Lương) - bấm để về trang đó. */
  const parentCrumb = useMemo(() => {
    const cut = currentPath.lastIndexOf('/');
    if (cut <= 0) return undefined;
    const href = currentPath.slice(0, cut);
    const title = hrmPageTitle(href);
    return title ? { href, title } : undefined;
  }, [currentPath]);

  const currentMeta = useMemo(
    () => ({
      title: hrmPageTitle(currentPath) ?? 'Quản trị Nhân sự',
      subtitle: HRM_PAGE_SUBTITLES[currentPath] ?? 'Quản lý theo quyền và cấu hình của doanh nghiệp.',
    }),
    [currentPath],
  );

  useEffect(() => {
    let active = true;
    async function loadCurrentUser() {
      try {
        const sessionRes = await fetch(platformAuthApiUrl('/me'), {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!sessionRes.ok) return;

        const session = await sessionRes.json();
        const currentSlug = session?.tenantSlug || 'savina';
        if (active) {
          setTenantSlug(currentSlug);
          if (session?.displayName) {
            const parts = session.displayName.trim().split(/\s+/);
            const initials =
              parts
                .slice(-2)
                .map((x: string) => x[0])
                .join('')
                .toUpperCase() || 'U';
            setCurrentUser({
              fullName: session.displayName,
              roleLabel: `${session.roles?.[0] || 'Thành viên'} • ${currentSlug.toUpperCase()}`,
              initials,
            });
          }
        }

        const res = await fetch(hrmApiUrl('/my-profile'), {
          credentials: 'include',
        });
        if (res.ok && active) {
          const payload = await res.json();
          const p = payload.data;
          if (p?.fullName) {
            const parts = p.fullName.trim().split(/\s+/);
            const initials =
              parts
                .slice(-2)
                .map((x: string) => x[0])
                .join('')
                .toUpperCase() || 'AD';
            setCurrentUser({
              fullName: p.fullName,
              roleLabel: `${p.employeeCode || 'EMP-ADMIN'} • ${currentSlug.toUpperCase()}`,
              initials,
            });
          }
        }
      } catch {
        /* fallback to default */
      }
    }
    void loadCurrentUser();
    return () => {
      active = false;
    };
  }, []);

  const activeNavId = getActiveHrmNavId(pathname);

  const visibleSections = filterHrmNavigation(
    hrmNavigationSections,
    hrmPagePermissions,
    permissions.any,
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f8f9ff] text-[#0f172a] antialiased font-sans">
      {/* Fixed Left Sidebar - Co giãn: w-64 khi mở, w-[70px] khi thu gọn */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-white/10 bg-[#091426] text-slate-200 select-none shadow-lg transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-[70px]' : 'w-64',
        )}
      >
        {/* Brand Header with Direct Toggle Button (chuẩn Core / Workspace) */}
        <div
          className={cn(
            'flex items-center justify-between p-3.5 border-b border-white/10 transition-all overflow-hidden',
            isCollapsed ? 'flex-col gap-2.5 px-0 py-3 items-center' : 'px-3.5 gap-2',
          )}
        >
          <div className={cn('flex items-center gap-2.5 min-w-0', isCollapsed && 'justify-center')}>
            <img
              src="/brand-logo.jpg"
              alt="SVN DTS Logo"
              width={34}
              height={34}
              style={{
                width: '34px',
                height: '34px',
                maxWidth: '34px',
                maxHeight: '34px',
              }}
              className="size-8.5 rounded-lg object-contain bg-white p-0.5 shadow border border-white/20 shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                <h2 className="text-xs font-bold text-white tracking-wider uppercase truncate leading-tight">
                  Quản trị Nhân sự
                </h2>
                <span className="text-[10.5px] font-medium text-slate-400 truncate">
                  {tenantSlug.toUpperCase()} · HRM
                </span>
              </div>
            )}
          </div>

          {/* Nút thu gọn / mở rộng đặt trực tiếp ngay trong menubar */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="grid size-7.5 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer border border-transparent hover:border-white/10"
            title={isCollapsed ? 'Mở rộng thanh menu (Ctrl+B)' : 'Thu gọn thanh menu (Ctrl+B)'}
            aria-label={isCollapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>

        {/* Sidebar Nav Items */}
        <HrmSidebarNav
          sections={visibleSections}
          activeNavId={activeNavId}
          railCollapsed={isCollapsed}
        />

        {/* Sidebar Footer / RailFoot with Toggle, Home and Logout button */}
        <div className="p-3 border-t border-white/10 bg-[#070f1e]/80 flex flex-col gap-2">
          <div
            className={cn(
              'flex items-center gap-2',
              isCollapsed && 'flex-col gap-2',
            )}
          >
            <a
              href="/applications"
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-colors truncate',
                isCollapsed
                  ? 'size-9 justify-center p-0 mx-auto'
                  : 'flex-1',
              )}
              title="Quay lại Trang chủ Phân hệ"
            >
              <Home className="size-3.5 shrink-0 opacity-80" />
              {!isCollapsed && <span className="truncate">Trang chủ</span>}
            </a>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="size-9 inline-flex items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 hover:text-white hover:bg-red-500/25 hover:border-red-500/50 transition-colors cursor-pointer shrink-0"
              title={loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
              aria-label="Đăng xuất"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 min-h-0 transition-all duration-300 ease-in-out',
          isCollapsed ? 'pl-[70px]' : 'pl-64',
        )}
      >
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-6 lg:px-8 backdrop-blur-sm shadow-xs">
          <div className="flex flex-col gap-0.5 py-2">
            <nav
              className="flex items-center gap-1.5 text-xs text-slate-500 font-medium"
              aria-label="Breadcrumb"
            >
              {/*
                Mỗi cấp trên là lối tắt quay về: "SVN DTS" về trang chủ ứng
                dụng (ngoài basePath nên dùng <a>), "Quản trị Nhân sự" về trang
                đầu HRM, trang cha (ví dụ Tiền lương của Cấu hình lương) về
                đúng trang đó. Cấp cuối là trang đang đứng nên chỉ là chữ.
              */}
              <a href="/applications" className={crumbLinkClass}>
                SVN DTS
              </a>
              <span className="text-slate-300" aria-hidden>/</span>
              {currentPath === '/' ? (
                <span>Quản trị Nhân sự</span>
              ) : (
                <Link href="/" className={crumbLinkClass}>
                  Quản trị Nhân sự
                </Link>
              )}
              {parentCrumb && (
                <>
                  <span className="text-slate-300" aria-hidden>/</span>
                  <Link href={parentCrumb.href} className={crumbLinkClass}>
                    {parentCrumb.title}
                  </Link>
                </>
              )}
              {currentMeta.title && (
                <>
                  <span className="text-slate-300" aria-hidden>/</span>
                  <span aria-current="page" className="font-semibold text-slate-900">
                    {currentMeta.title}
                  </span>
                </>
              )}
            </nav>
            <h1 className="text-lg font-bold text-[#091426] tracking-tight">
              {currentMeta.title}
            </h1>
            <p className="text-xs text-slate-500 max-w-[75ch] leading-relaxed hidden sm:block">
              {currentMeta.subtitle}
            </p>
          </div>

          <TopNavHeaderActions
            displayName={permissions.displayName || currentUser.fullName}
            role={currentUser.roleLabel}
            onLogout={handleLogout}
          />
        </header>

        {/* Content Body */}
        <main className="hrm-workspace min-h-0 flex-1 overflow-y-auto p-4 lg:p-6 scroll-smooth">
          {permissions.loading ? (
            <div className="flex items-center justify-center p-12 text-slate-500 text-sm">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mr-2" />
              Đang tải quyền HRM…
            </div>
          ) : permissions.error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-xs">
              <div className="font-semibold mb-1">Không thể tải thông tin quyền hạn</div>
              <p>{permissions.error}</p>
            </div>
          ) : pagePermissions && !permissions.any(pagePermissions) ? (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-xs max-w-2xl mx-auto mt-6">
              <div className="font-bold text-base mb-2">Chưa được cấp quyền truy cập</div>
              <p className="leading-relaxed">
                Tài khoản của bạn chưa được cấp quyền truy cập chức năng này. Quản trị tenant có
                thể cấp quyền tại màn hình Phân quyền của ERP.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
