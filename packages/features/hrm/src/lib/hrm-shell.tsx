'use client';
import { ChevronDown, Home, LogOut } from 'lucide-react';
import {
  getActiveHrmNavId,
  hrmNavigationSections,
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
function HrmShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const permissions = useHrmPermissions();
  const currentPath = normalizeHrmPath(pathname);
  const pagePermissions = hrmPagePermissions[currentPath];
  const [tenantSlug, setTenantSlug] = useState('savina');
  const [loggingOut, setLoggingOut] = useState(false);

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

  const currentMeta = useMemo(() => {
    const titles: Record<string, string> = {
      '/dependents': 'Đăng ký người phụ thuộc',
      '/policies': 'Cấu hình công và thiết bị',
      '/timesheets': 'Bảng công tổng hợp',
      '/payroll': 'Tiền lương và chi trả',
      '/payroll/settings': 'Cấu hình lương',
      '/payroll/advances': 'Ứng và thu hồi lương',
      '/leave-settings': 'Quỹ phép',
      '/operations': 'Vận hành và tích hợp',
      '/calendar': 'Lịch làm việc và thông báo',
      '/permissions': 'Danh mục quyền HRM',
    };
    const title = titles[currentPath];
    if (title)
      return {
        title,
        subtitle: 'Quản lý theo quyền và cấu hình của doanh nghiệp.',
      };
    if (pathname.includes('/profile')) {
      return {
        title: 'Hồ sơ của tôi (Self-Service)',
        subtitle:
          'Không gian tự phục vụ tra cứu thông tin nhân sự, hợp đồng công tác và tài khoản chi trả lương.',
      };
    }
    if (pathname.includes('/attendance')) {
      return {
        title: 'Chấm công cá nhân (My Attendance)',
        subtitle:
          'Ghi nhận giờ làm việc, kiểm tra tính hợp lệ dữ liệu quẹt thẻ và rà soát lịch sử công cá nhân.',
      };
    }
    if (pathname.includes('/requests')) {
      return {
        title: 'Đơn từ & Yêu cầu (My Requests)',
        subtitle:
          'Trung tâm khởi tạo và giám sát tiến độ toàn bộ các giao dịch phát sinh cần phê duyệt của nhân viên.',
      };
    }
    if (pathname.includes('/employees')) {
      return {
        title: 'Nhân sự & Chức danh',
        subtitle:
          'Quản lý hồ sơ nhân sự mở rộng, cấu trúc vị trí chức danh và ngạch bậc lương toàn công ty.',
      };
    }
    if (pathname.includes('/shifts')) {
      return {
        title: 'Quản lý Ca & Chấm công (Shifts & Roster)',
        subtitle:
          'Thiết lập định nghĩa ca làm việc, lập lịch phân ca và quản lý dữ liệu chấm công tổng thể.',
      };
    }
    if (pathname.includes('/approvals')) {
      return {
        title: 'Xử lý Đơn từ (Approvals & Inboxes)',
        subtitle:
          'Tiếp nhận, kiểm tra tính hợp lệ chính sách và phê duyệt các yêu cầu phát sinh từ nhân viên.',
      };
    }
    return {
      title: 'Bàn làm việc (Dashboard)',
      subtitle:
        'Trung tâm điều hành và giám sát toàn diện hoạt động nhân sự, quân số và vận hành doanh nghiệp.',
    };
  }, [currentPath, pathname]);

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

  const sections = hrmNavigationSections;
  const activeNavId = getActiveHrmNavId(pathname);

  const visibleSections = sections
    .map((sec) => ({
      ...sec,
      items: sec.items
        .map((item) => {
          if (item.children?.length) {
            const children = item.children.filter(
              (child) =>
                !child.href ||
                !hrmPagePermissions[child.href] ||
                permissions.any(hrmPagePermissions[child.href]),
            );
            return children.length ? { ...item, children } : null;
          }
          return !item.href ||
            !hrmPagePermissions[item.href] ||
            permissions.any(hrmPagePermissions[item.href])
            ? item
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    }))
    .filter((sec) => sec.items.length);

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f8f9ff] text-[#0f172a] antialiased font-sans">
      {/* Fixed Left Sidebar (256px / 16rem) - Dark Navy #091426 chuẩn Enterprise */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/10 bg-[#091426] text-slate-200 select-none shadow-lg">
        {/* Brand Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <img
            src="/brand-logo.jpg"
            alt="SVN DTS Logo"
            width={36}
            height={36}
            style={{
              width: '36px',
              height: '36px',
              maxWidth: '36px',
              maxHeight: '36px',
            }}
            className="size-9 rounded-lg object-contain bg-white p-0.5 shadow border border-white/20 shrink-0"
            onError={(e) => {
              // Graceful fallback if image doesn't exist
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="flex flex-col min-w-0 flex-1">
            <h2 className="text-xs font-bold text-white tracking-wider uppercase truncate leading-tight">
              Quản trị Nhân sự
            </h2>
            <span className="text-[11px] font-medium text-slate-400 truncate">
              {tenantSlug.toUpperCase()} · Phân hệ HRM
            </span>
          </div>
        </div>

        {/* Sidebar Nav Items with hover-reveal scrollbar */}
        <nav
          aria-label="Điều hướng HRM"
          className="flex-1 overflow-y-auto px-3 py-3 space-y-4"
        >
          {visibleSections.map((sec) => (
            <div key={sec.title} className="space-y-1">
              <div className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400/80">
                {sec.title}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNavId === item.id;

                  if (item.children?.length) {
                    const groupActive = item.children.some(
                      (child) => child.id === activeNavId,
                    );
                    return (
                      <details
                        key={item.id}
                        className="group/nav"
                        open={groupActive || undefined}
                      >
                        <summary
                          className={cn(
                            'flex list-none items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer [&::-webkit-details-marker]:hidden',
                            groupActive
                              ? 'bg-white/10 text-white'
                              : 'text-slate-300/90 hover:bg-white/10 hover:text-white',
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon
                              className={cn(
                                'size-4 shrink-0 transition-colors',
                                groupActive ? 'text-white' : 'text-slate-400',
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </div>
                          <ChevronDown className="size-3.5 shrink-0 text-slate-500 transition-transform group-open/nav:rotate-180" />
                        </summary>
                        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                          {item.children.map((child) => {
                            const ChildIcon = child.icon;
                            const childActive = activeNavId === child.id;
                            return child.href ? (
                              <Link
                                key={child.id}
                                href={child.href}
                                aria-current={childActive ? 'page' : undefined}
                                className={cn(
                                  'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all',
                                  childActive
                                    ? 'bg-white/15 text-white font-semibold'
                                    : 'text-slate-400 hover:bg-white/10 hover:text-white',
                                )}
                              >
                                <ChildIcon className="size-3.5 shrink-0" />
                                <span className="truncate">{child.label}</span>
                              </Link>
                            ) : null;
                          })}
                        </div>
                      </details>
                    );
                  }

                  if (item.isInteractive && item.href) {
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group',
                          isActive
                            ? 'bg-white/15 text-white font-semibold shadow-xs border-l-4 border-white'
                            : 'text-slate-300/80 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon
                            className={cn(
                              'size-4 shrink-0 transition-colors',
                              isActive
                                ? 'text-white'
                                : 'text-slate-400 group-hover:text-white',
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  }

                  // Non-interactive items: strictly disabled without onclick
                  return (
                    <div
                      key={item.id}
                      aria-disabled="true"
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-500/60 cursor-not-allowed select-none transition-colors"
                      title="Chức năng đang cấu hình phân quyền theo giai đoạn"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="size-4 shrink-0 text-slate-600" />
                        <span className="truncate">{item.label}</span>
                      </div>
                      <span className="text-[10px] text-slate-600 font-mono">
                        Sắp có
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer / RailFoot with Home and Logout button */}
        <div className="p-3 border-t border-white/10 bg-[#070f1e]/80 flex items-center gap-2">
          <a
            href="/applications"
            className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-colors truncate"
            title="Quay lại Trang chủ Phân hệ"
          >
            <Home className="size-3.5 shrink-0 opacity-80" />
            <span className="truncate">Trang chủ</span>
          </a>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="size-8 inline-flex items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 hover:text-white hover:bg-red-500/25 hover:border-red-500/50 transition-colors cursor-pointer shrink-0"
            title={loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
            aria-label="Đăng xuất"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col pl-64 min-w-0 min-h-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-6 lg:px-8 backdrop-blur-sm shadow-xs">
          <div className="flex flex-col gap-0.5 py-2">
            <nav
              className="flex items-center gap-1.5 text-xs text-slate-500 font-medium"
              aria-label="Breadcrumb"
            >
              <span>SVN DTS</span>
              <span className="text-slate-300">/</span>
              <span>Quản trị Nhân sự</span>
              {currentMeta.title && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="font-semibold text-slate-900">
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

          {/* Right Profile Controls */}
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
