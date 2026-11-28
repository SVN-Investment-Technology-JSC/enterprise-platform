'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatLauncher, UserAvatar } from '@enterprise-platform/feature-chat';
import { AppIcon, NotificationBell, NotificationProvider, SessionKeepAlive } from '@enterprise-platform/shared-ui';
import { AssistantLauncher } from './assistant-launcher';
import { BrandLogo } from './brand-logo';
import { ModuleShellLight } from './module-shell-light';
import type { ModuleNavItem, ModuleShellProps } from './module-shell.types';
import {
  ClassicAccountFallback,
  ClassicFullscreenFallback,
  ClassicHomeFallback,
  ClassicLogoutDangerFallback,
  ClassicLogoutFallback,
  ClassicSearchFallback,
  ClassicSettingsFallback,
} from './shell-icons';
import { initialsOfName, useShellSession } from './use-shell-session';
import styles from './module-shell.module.scss';

/**
 * Khung của module.
 *
 * `appearance="light"` dùng thanh bên sáng kiểu mới, không có thanh trên; mặc
 * định giữ khung tối cũ để Kho, Bảo trì và Quy trình không đổi gì.
 */
export function ModuleShell<TViewId extends string = string>(props: ModuleShellProps<TViewId>) {
  return props.appearance === 'light' ? (
    <ModuleShellLight<TViewId> {...props} />
  ) : (
    <ClassicShell<TViewId> {...props} />
  );
}

/**
 * Khung chung của ba module: rail điều hướng dọc bên trái theo chuẩn dark navy #091426 của t/savina,
 * top header sticky với thông tin người dùng, avatar, nút đăng xuất / đăng nhập.
 */
function ClassicShell<TViewId extends string = string>(props: ModuleShellProps<TViewId>) {
  const visible = props.nav.filter((item) => !item.hidden);
  const activeItem = visible.find((item) => item.id === props.view);
  /** Trang đầu của module — đích của mục tên module trên breadcrumb. */
  const firstItem = visible[0];
  const { principal, loggingOut, logoutError, logout: handleLogout } = useShellSession();

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


  const tenantSlug =
    props.tenantSlug ||
    (principal && principal.kind === 'tenant-user' ? principal.tenantSlug : undefined) ||
    'savina';

  const homeHref =
    props.homeHref ||
    '/applications';

  const displayName = props.actor || principal?.displayName || 'Savina Member';

  const collapsed = Boolean(props.collapsible && props.collapsed);

  return (
    <NotificationProvider>
      <SessionKeepAlive />
      <div className={`${styles.shell} ${collapsed ? styles.shellMin : ''}`}>
      <nav
        className={`${styles.rail} ${collapsed ? styles.railMin : ''}`}
        aria-label={`Điều hướng ${props.title}`}
      >
        <div className={styles.brand}>
          <BrandLogo
            alt="Logo"
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
            <AppIcon
              slot="shell.home"
              fallback={ClassicHomeFallback}
              size={14}
              className={styles.railFootIcon}
            />
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
            <AppIcon slot="shell.logout" fallback={ClassicLogoutFallback} size={14} />
          </button>
          {logoutError ? <span className={styles.logoutError} role="alert">{logoutError}</span> : null}
        </div>
      </nav>

      <main className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.headTitles}>
            {/*
              Mỗi cấp trên breadcrumb là một lối tắt: "Trang chủ" về trang chủ
              ứng dụng, tên module về trang đầu của module. Cấp cuối là trang
              đang đứng nên chỉ là chữ, không phải link.
            */}
            <nav className={styles.headBreadcrumb} aria-label="Breadcrumb">
              <a className={styles.crumbLink} href="/dashboard">
                Trang chủ
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
              <AppIcon
                slot="header.search"
                fallback={ClassicSearchFallback}
                className={styles.topSearchIcon}
              />
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
              <AppIcon slot="header.fullscreen" fallback={ClassicFullscreenFallback} size={15} />
            </button>


            <NotificationBell />

            <AssistantLauncher />

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
                  {principal?.kind === 'tenant-user' && principal.userId ? (
                    <UserAvatar userId={principal.userId} name={displayName} size={36} />
                  ) : (
                    <div className={styles.userAvatar}>
                      {initialsOfName(displayName)}
                    </div>
                  )}
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
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Xin chào !</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a' }}>{displayName}</div>
                  </div>

                  {/* Trang tài khoản nằm ở app web gốc, không đi qua basePath của module. */}
                  <a
                    href="/account"
                    className={styles.menuItem}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <AppIcon slot="nav.account" fallback={ClassicAccountFallback} size={14} />
                    <span>Tài khoản của tôi</span>
                  </a>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <AppIcon slot="nav.settings" fallback={ClassicSettingsFallback} size={14} />
                    <span>Cài đặt hệ thống</span>
                  </button>

                  <div className={styles.menuDivider} />

                  <button
                    type="button"
                    className={`${styles.menuItem} ${styles.menuItemDanger}`}
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    <AppIcon slot="shell.logout" fallback={ClassicLogoutDangerFallback} size={14} />
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
      {/* Chat nội bộ của core: nút ở góc phải dưới, có ở mọi trang, không phụ thuộc phân hệ nào được bật. */}
      <ChatLauncher />
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

