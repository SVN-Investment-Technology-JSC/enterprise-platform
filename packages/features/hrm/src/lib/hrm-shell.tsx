'use client';

import {
  Briefcase,
  Calendar,
  ClipboardList,
  Clock,
  Coins,
  FileSpreadsheet,
  FileText,
  Home,
  LogOut,
  Sliders,
  TrendingUp,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { revokeSession } from '@enterprise-platform/shared-ui';
import { cn } from './utils';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  isInteractive: boolean;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function HrmShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [tenantSlug, setTenantSlug] = useState('savina');
  const [loggingOut, setLoggingOut] = useState(false);

  const [currentUser, setCurrentUser] = useState({
    fullName: 'Quản trị SAVINA',
    roleLabel: 'Quản trị viên • SAVINA',
    initials: 'AD',
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
    if (pathname.includes('/profile')) {
      return {
        title: 'Hồ sơ của tôi (Self-Service)',
        subtitle: 'Không gian tự phục vụ tra cứu thông tin nhân sự, hợp đồng công tác và tài khoản chi trả lương.',
      };
    }
    if (pathname.includes('/attendance')) {
      return {
        title: 'Chấm công cá nhân (My Attendance)',
        subtitle: 'Ghi nhận giờ làm việc, kiểm tra tính hợp lệ dữ liệu quẹt thẻ và rà soát lịch sử công cá nhân.',
      };
    }
    if (pathname.includes('/requests')) {
      return {
        title: 'Đơn từ & Yêu cầu (My Requests)',
        subtitle: 'Trung tâm khởi tạo và giám sát tiến độ toàn bộ các giao dịch phát sinh cần phê duyệt của nhân viên.',
      };
    }
    if (pathname.includes('/employees')) {
      return {
        title: 'Nhân sự & Chức danh',
        subtitle: 'Quản lý hồ sơ nhân sự mở rộng, cấu trúc vị trí chức danh và ngạch bậc lương toàn công ty.',
      };
    }
    if (pathname.includes('/shifts')) {
      return {
        title: 'Quản lý Ca & Chấm công (Shifts & Roster)',
        subtitle: 'Thiết lập định nghĩa ca làm việc, lập lịch phân ca và quản lý dữ liệu chấm công tổng thể.',
      };
    }
    if (pathname.includes('/approvals')) {
      return {
        title: 'Xử lý Đơn từ (Approvals & Inboxes)',
        subtitle: 'Tiếp nhận, kiểm tra tính hợp lệ chính sách và phê duyệt các yêu cầu phát sinh từ nhân viên.',
      };
    }
    return {
      title: 'Bàn làm việc (Dashboard)',
      subtitle: 'Trung tâm điều hành và giám sát toàn diện hoạt động nhân sự, quân số và vận hành doanh nghiệp.',
    };
  }, [pathname]);

  useEffect(() => {
    let active = true;
    async function loadCurrentUser() {
      try {
        const sessionRes = await fetch('/api/auth/v1/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!sessionRes.ok) return;

        const session = await sessionRes.json();
        const currentSlug = session?.tenantSlug || 'savina';
        if (active) {
          setTenantSlug(currentSlug);
        }

        const res = await fetch('/api/hrm/v1/my-profile', {
          credentials: 'include',
        });
        if (res.ok && active) {
          const payload = await res.json();
          const p = payload.data;
          if (p?.fullName) {
            const parts = p.fullName.trim().split(/\s+/);
            const initials = parts.slice(-2).map((x: string) => x[0]).join('').toUpperCase() || 'AD';
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

  const sections: NavSection[] = [
    {
      title: 'TỔNG QUAN',
      items: [
        {
          id: 'dashboard',
          label: 'Bàn làm việc (Dashboard)',
          icon: Home,
          href: '/',
          isInteractive: true,
        },
      ],
    },
    {
      title: 'CÁ NHÂN',
      items: [
        {
          id: 'profile',
          label: 'Hồ sơ của tôi',
          icon: UserCircle,
          href: '/profile',
          isInteractive: true,
        },
        {
          id: 'attendance',
          label: 'Chấm công',
          icon: Clock,
          href: '/attendance',
          isInteractive: true,
        },
        {
          id: 'requests',
          label: 'Đơn từ & Yêu cầu',
          icon: FileText,
          href: '/requests',
          isInteractive: true,
        },
        {
          id: 'payslips',
          label: 'Phiếu lương',
          icon: Coins,
          isInteractive: false,
        },
      ],
    },
    {
      title: 'VẬN HÀNH',
      items: [
        {
          id: 'employees',
          label: 'Nhân sự & Chức danh',
          icon: Users,
          href: '/employees',
          isInteractive: true,
        },
        {
          id: 'shift_management',
          label: 'Quản lý Ca & Chấm công',
          icon: Calendar,
          href: '/shifts',
          isInteractive: true,
        },
        {
          id: 'request_processing',
          label: 'Xử lý Đơn từ',
          icon: ClipboardList,
          href: '/approvals',
          isInteractive: true,
        },
        {
          id: 'timesheets',
          label: 'Bảng công tổng hợp',
          icon: FileSpreadsheet,
          isInteractive: false,
        },
        {
          id: 'payroll_payout',
          label: 'Tiền lương & Chi trả',
          icon: TrendingUp,
          isInteractive: false,
        },
      ],
    },
    {
      title: 'QUẢN TRỊ & HỆ THỐNG',
      items: [
        {
          id: 'policies',
          label: 'Chính sách nhân sự',
          icon: Briefcase,
          isInteractive: false,
        },
        {
          id: 'devices_integration',
          label: 'Thiết bị & Tích hợp',
          icon: Sliders,
          isInteractive: false,
        },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#f8f9ff] text-[#0f172a] antialiased font-sans">
      {/* Fixed Left Sidebar (256px / 16rem) - Dark Navy #091426 chuẩn Enterprise */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/10 bg-[#091426] text-slate-200 select-none shadow-lg">
        {/* Brand Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <img
            src="/brand-logo.jpg"
            alt="SVN DTS Logo"
            width={36}
            height={36}
            style={{ width: '36px', height: '36px', maxWidth: '36px', maxHeight: '36px' }}
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
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {sections.map((sec) => (
            <div key={sec.title} className="space-y-1">
              <div className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400/80">
                {sec.title}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const Icon = item.icon;
                  const currentSubPath = pathname.replace(/^\/modules\/hrm/, '') || '/';
                  const isActive =
                    item.isInteractive && item.href
                      ? item.href === '/'
                        ? currentSubPath === '/' || currentSubPath === ''
                        : currentSubPath === item.href || currentSubPath.startsWith(item.href + '/')
                      : false;

                  if (item.isInteractive && item.href) {
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
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
                              isActive ? 'text-white' : 'text-slate-400 group-hover:text-white',
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
      <div className="flex-1 flex flex-col pl-64 min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-6 lg:px-8 backdrop-blur-sm shadow-xs">
          <div className="flex flex-col gap-0.5 py-2">
            <nav className="flex items-center gap-1.5 text-xs text-slate-500 font-medium" aria-label="Breadcrumb">
              <span>SVN DTS</span>
              <span className="text-slate-300">/</span>
              <span>Quản trị Nhân sự</span>
              {currentMeta.title && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="font-semibold text-slate-900">{currentMeta.title}</span>
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
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2.5 pl-2">
              <div className="size-9 rounded-full bg-[#091426] text-white text-xs font-bold grid place-items-center shadow-xs border border-slate-200 shrink-0">
                {currentUser.initials}
              </div>
              <div className="flex flex-col text-left hidden sm:flex">
                <span className="text-xs font-bold text-slate-900 leading-tight">
                  {currentUser.fullName}
                </span>
                <span className="text-[11px] text-slate-500 leading-tight">
                  {currentUser.roleLabel}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
