'use client';

import { useEffect, useRef, useState } from 'react';
import {
  authFetch,
  NotificationBell,
  NotificationProvider,
  revokeSession,
} from '@enterprise-platform/shared-ui';
import type { ModuleNavItem, ModuleShellProps } from './module-shell.types';
import styles from './module-shell.module.scss';

interface UserPrincipal {
  readonly kind?: string;
  readonly displayName?: string;
  readonly tenantSlug?: string;
  readonly roles?: readonly string[];
}

function getInitials(name?: string): string {
  if (!name) return 'EP';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Khung chung của ba module: rail điều hướng dọc bên trái theo chuẩn dark navy #091426 của t/savina,
 * top header sticky với thông tin người dùng, avatar, nút đăng xuất / đăng nhập.
 */
export function ModuleShell<TViewId extends string = string>(props: ModuleShellProps<TViewId>) {
  const visible = props.nav.filter((item) => !item.hidden);
  const activeItem = visible.find((item) => item.id === props.view);
  /** Trang đầu của module — đích của mục tên module trên breadcrumb. */
  const firstItem = visible[0];
  const [principal, setPrincipal] = useState<UserPrincipal | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);

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


  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const response = await authFetch('/api/auth/v1/me', {
          cache: 'no-store',
        });
        if (response.ok) {
          const data = (await response.json()) as UserPrincipal;
          if (active) setPrincipal(data);
        } else {
          if (active) setPrincipal(null);
        }
      } catch {
        if (active) setPrincipal(null);
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  const tenantSlug =
    props.tenantSlug ||
    (principal && principal.kind === 'tenant-user' ? principal.tenantSlug : undefined) ||
    'savina';

  const homeHref =
    props.homeHref ||
    '/applications';

  const loginPath = '/';
  const displayName = props.actor || principal?.displayName || 'Savina Member';

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await revokeSession();
      window.location.replace(loginPath);
    } catch (cause) {
      setLogoutError(
        cause instanceof Error ? cause.message : 'Không thể đăng xuất. Vui lòng thử lại.',
      );
      setLoggingOut(false);
    }
  };

  const collapsed = Boolean(props.collapsible && props.collapsed);

  return (
    <NotificationProvider>
      <div className={`${styles.shell} ${collapsed ? styles.shellMin : ''}`}>
      <nav
        className={`${styles.rail} ${collapsed ? styles.railMin : ''}`}
        aria-label={`Điều hướng ${props.title}`}
      >
        <div className={styles.brand}>
          <img
            src="/brand-logo.jpg"
            alt="SVN DTS Logo"
            className={styles.brandLogo}
          />
          {collapsed ? null : (
            <div className={styles.brandText}>
              <h2 className={styles.brandTitle}>{props.title}</h2>
              <span className={styles.brandSubtitle}>
                {tenantSlug.toUpperCase()} · Phân hệ
              </span>
            </div>
          )}
          {props.collapsible ? (
            <button
              type="button"
              className={styles.railToggle}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu nhỏ thanh điều hướng'}
              title={collapsed ? 'Mở rộng' : 'Thu vào cạnh trái'}
              onClick={() => props.onCollapsedChange?.(!collapsed)}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={collapsed ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
              </svg>
            </button>
          ) : null}
        </div>

        <div className={styles.railNav}>
          {visible.map((item, index) => (
            <NavEntry
              key={item.id}
              item={item}
              active={item.id === props.view}
              // Tiêu đề nhóm chỉ hiện ở mục đầu tiên của nhóm, nên các mục liền
              // nhau cùng `group` gom lại dưới một tiêu đề duy nhất.
              groupHeading={
                item.group !== undefined &&
                item.group !== visible[index - 1]?.group
              }
              collapsed={collapsed}
              onSelect={() => props.onViewChange(item.id)}
            />
          ))}
        </div>

        <div className={styles.railFoot}>
          <a className={styles.homeLink} href={homeHref} title="Quay lại Trang chủ">
            <svg
              className={styles.railFootIcon}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Trang chủ
          </a>
          <button
            type="button"
            className={styles.railLogoutBtn}
            onClick={handleLogout}
            disabled={loggingOut}
            title={logoutError || (loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất')}
            aria-label="Đăng xuất"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
          {logoutError ? <span className={styles.logoutError} role="alert">{logoutError}</span> : null}
        </div>
      </nav>

      <main className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.headTitles}>
            {/*
              Mỗi cấp trên breadcrumb là một lối tắt: "SVN DTS" về trang chủ
              ứng dụng, tên module về trang đầu của module. Cấp cuối là trang
              đang đứng nên chỉ là chữ, không phải link.
            */}
            <nav className={styles.headBreadcrumb} aria-label="Breadcrumb">
              <a className={styles.crumbLink} href={homeHref}>
                SVN DTS
              </a>
              <span className={styles.crumbSep} aria-hidden>/</span>
              {activeItem && firstItem && activeItem.id !== firstItem.id ? (
                <button
                  type="button"
                  className={styles.crumbLink}
                  title={`Về ${firstItem.label}`}
                  onClick={() => props.onViewChange(firstItem.id)}
                >
                  {props.title}
                </button>
              ) : (
                <span aria-current={activeItem ? undefined : 'page'}>{props.title}</span>
              )}
              {activeItem ? (
                <>
                  <span className={styles.crumbSep} aria-hidden>/</span>
                  <span className={styles.crumbCurrent} aria-current="page">
                    {activeItem.label}
                  </span>
                </>
              ) : null}
            </nav>
            <h1>{activeItem?.label ?? props.title}</h1>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>

          <div className={styles.headRight}>
            {props.actions ? (
              <div className={styles.headActions}>{props.actions}</div>
            ) : null}

            {/* 1. Search Bar */}
            <div className={styles.topSearch}>
              <svg
                className={styles.topSearchIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm..."
                className={styles.topSearchInput}
              />
            </div>

            {/* 2. Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className={styles.iconBtn}
              title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
              aria-label="Toàn màn hình"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>


            <NotificationBell />

            {/* 5. User Dropdown */}
            <div style={{ position: 'relative' }} ref={userMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                }}
                className={styles.userBtn}
              >
                <div style={{ position: 'relative' }}>
                  <div className={styles.userAvatar}>
                    {getInitials(displayName)}
                  </div>
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      width: '0.6rem',
                      height: '0.6rem',
                      borderRadius: '9999px',
                      backgroundColor: '#10b981',
                      border: '2px solid #ffffff',
                    }}
                  />
                </div>
                {/* <div className={styles.userInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className={styles.userName}>{displayName}</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  <span className={styles.userRole}>
                    {userRole} · {tenantSlug.toUpperCase()}
                  </span>
                </div> */}
              </button>

              {userMenuOpen ? (
                <div className={`${styles.popoverDropdown} ${styles.userMenu}`}>
                  <div className={styles.userMenuHeader}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Xin chào !</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{displayName}</div>
                  </div>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span>Tài khoản của tôi</span>
                  </button>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>Cài đặt hệ thống</span>
                  </button>

                  <div className={styles.menuDivider} />

                  <button
                    type="button"
                    className={`${styles.menuItem} ${styles.menuItemDanger}`}
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {props.banner ? <div className={styles.banner}>{props.banner}</div> : null}

        <div className={styles.body}>{props.children}</div>
      </main>
      </div>
    </NotificationProvider>
  );
}

function NavEntry<TViewId extends string>(props: {
  item: ModuleNavItem<TViewId>;
  active: boolean;
  groupHeading: boolean;
  /** Rail đang thu: chỉ còn chữ viết tắt hoặc biểu tượng, nhãn vào `title`. */
  collapsed?: boolean;
  onSelect: () => void;
}) {
  const { item } = props;
  return (
    <>
      {props.groupHeading && !props.collapsed ? (
        <span className={styles.railGroup}>{item.group}</span>
      ) : null}
      <button
        type="button"
        className={`${styles.navItem} ${props.active ? styles.navItemActive : ''
          }`}
        aria-current={props.active ? 'page' : undefined}
        title={props.collapsed ? item.label : undefined}
        onClick={props.onSelect}
      >
        {item.icon ? <span className={styles.navIcon}>{item.icon}</span> : null}
        {/*
          Rail thu gọn: có biểu tượng thì dùng biểu tượng, không có mới rơi về
          chữ tắt. Hai chữ cái đầu ("DÁ", "BC") gần như không gợi được gì.
        */}
        {props.collapsed ? (
          item.icon ? null : (
            <span className={styles.navInitial} aria-hidden>
              {initialsOf(item.label)}
            </span>
          )
        ) : (
          <span className={styles.navLabel}>{item.label}</span>
        )}
        {item.badge !== undefined ? (
          <span className={styles.navBadge}>{item.badge}</span>
        ) : null}
      </button>
    </>
  );
}

/** Chữ tắt cho rail thu gọn: "Công việc của tôi" → "CV". */
function initialsOf(label: string): string {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

