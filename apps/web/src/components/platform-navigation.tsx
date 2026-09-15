'use client';

import {
  BarChart3,
  ChevronDown,
  FileUp,
  LayoutDashboard,
  ReceiptText,
  ServerCog,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type PlatformNavigationKey = 'dashboard' | 'tenants' | 'data-import';

const settingsMenuStateKey = 'platform-navigation-settings-open';

const primaryNavigation = [
  {
    key: 'dashboard',
    label: 'Bảng điều khiển',
    icon: LayoutDashboard,
    href: '/platform',
  },
  {
    key: 'tenants',
    label: 'Khách hàng',
    icon: Users,
    href: '/platform/tenants',
  },
  { key: 'services', label: 'Dịch vụ', icon: ServerCog, href: '#' },
  { key: 'billing', label: 'Hóa đơn', icon: ReceiptText, href: '#' },
  { key: 'reports', label: 'Báo cáo', icon: BarChart3, href: '#' },
] as const;

export function PlatformNavigation({
  active,
  mobile = false,
}: {
  active: PlatformNavigationKey;
  mobile?: boolean;
}) {
  const settingsActive = active === 'data-import';
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  useEffect(() => {
    const savedState = window.sessionStorage.getItem(settingsMenuStateKey);

    if (savedState !== null) {
      setSettingsOpen(savedState === 'true');
    }
  }, []);

  return (
    <nav
      aria-label="Điều hướng platform"
      className={cn('space-y-1', mobile && 'px-4')}
    >
      {primaryNavigation.map(({ key, label, icon: Icon, href }) => {
        const itemActive = active === key;
        return (
          <Link
            aria-current={itemActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              itemActive
                ? 'border-r-4 border-slate-300 bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            )}
            href={href}
            key={key}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}

      <details
        className="group/settings pt-1"
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setSettingsOpen(open);
          window.sessionStorage.setItem(settingsMenuStateKey, String(open));
        }}
        open={settingsOpen}
      >
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors [&::-webkit-details-marker]:hidden',
            settingsActive
              ? 'bg-slate-800/70 text-white'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white',
          )}
        >
          <Settings className="size-4" />
          <span>Cài đặt</span>
          <ChevronDown className="ml-auto size-4 transition-transform group-open/settings:rotate-180" />
        </summary>
        <div className="ml-5 mt-1 border-l border-slate-700 pl-2">
          <Link
            aria-current={settingsActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
              settingsActive
                ? 'border-r-4 border-slate-300 bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white',
            )}
            href="/platform/data-import"
          >
            <FileUp className="size-3.5" />
            Nhập dữ liệu
          </Link>
        </div>
      </details>
    </nav>
  );
}
