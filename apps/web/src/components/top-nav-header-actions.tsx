'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LogOut,
  Maximize,
  Minimize,
  Search,
  Settings,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { NotificationBell, revokeSession } from '@enterprise-platform/shared-ui';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface TopNavHeaderActionsProps {
  displayName?: string;
  role?: string;
  avatarText?: string;
  onLogout?: () => void;
  className?: string;
}

export function TopNavHeaderActions({
  displayName,
  role = 'Tenant Admin',
  avatarText,
  onLogout,
  className,
}: TopNavHeaderActionsProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Listen to fullscreenchange
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch((err: unknown) => {
        console.debug('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen?.().catch((err: unknown) => {
        console.debug('Exit fullscreen error:', err);
      });
    }
  };


  const handleLogoutClick = async () => {
    if (onLogout) {
      onLogout();
      return;
    }
    try {
      await revokeSession();
    } finally {
      window.location.replace('/');
    }
  };

  const currentDisplayName = displayName || 'Người dùng';
  const initials =
    avatarText ||
    currentDisplayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();

  return (
    <div className={cn('ml-auto flex items-center gap-1.5 sm:gap-2.5', className)}>
      {/* 1. Search Bar */}
      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm kiếm..."
          className="h-8.5 w-44 lg:w-56 rounded-full border border-slate-200 bg-slate-50/90 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 transition-all hover:bg-slate-100/80 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
        />
      </div>

      {/* 2. Fullscreen Button */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="hidden sm:inline-flex size-8.5 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
        title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
        aria-label="Toàn màn hình"
      >
        {isFullscreen ? (
          <Minimize className="size-4.5" />
        ) : (
          <Maximize className="size-4.5" />
        )}
      </button>


      <NotificationBell />

      {/* 5. User Dropdown */}
      <div className="relative" ref={userMenuRef}>
        <button
          type="button"
          onClick={() => {
            setUserMenuOpen(!userMenuOpen);
          }}
          className={cn(
            'flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-slate-100 focus:outline-none',
            userMenuOpen && 'bg-slate-100',
          )}
          aria-expanded={userMenuOpen}
        >
          <div className="relative">
            <Avatar className="size-8.5 ring-2 ring-slate-200/80">
              <AvatarFallback className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-[11px] font-bold text-white tracking-wider">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </div>

          {/* <div className="hidden sm:flex items-center gap-1 text-left">
            <span className="text-xs font-semibold text-slate-800 max-w-[100px] truncate">
              {displayName}
            </span>
            <ChevronDown className="size-3.5 text-slate-400" />
          </div> */}
        </button>

        {userMenuOpen && (
          <div className="absolute right-0 mt-2 z-50 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
            {/* Header */}
            <div className="border-b border-slate-100 px-3.5 py-2.5">
              <p className="text-[13px] font-medium text-slate-500">
                Xin chào !
              </p>
              <p className="text-[13px] font-bold text-slate-900 truncate">
                {displayName}
              </p>
              {/* <p className="text-[10px] text-slate-500 truncate">{role}</p> */}
            </div>

            {/* Menu Items */}
            <div className="py-1">
              <Link
                href="/account"
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setUserMenuOpen(false)}
              >
                <User className="size-4 text-slate-400" />
                <span>Tài khoản của tôi</span>
              </Link>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setUserMenuOpen(false)}
              >
                <Settings className="size-4 text-slate-400" />
                <span>Cài đặt hệ thống</span>
              </button>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100 my-1" />

            {/* Logout */}
            <div className="px-1.5 py-0.5">
              <button
                type="button"
                onClick={handleLogoutClick}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="size-4 text-red-500" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
