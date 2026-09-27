'use client';

import { useEffect, useState } from 'react';
import { authFetch, revokeSession } from '@enterprise-platform/shared-ui';
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
  const [principal, setPrincipal] = useState<UserPrincipal | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();

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
  const userRole = principal?.roles?.[0] || 'Tenant Admin';

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
    // Rail thu gọn thì cột đầu của lưới cũng phải hẹp lại, nếu không phần nội
    // dung vẫn bắt đầu ở mốc 16rem và để trống đúng bằng chỗ vừa nhường ra.
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
            <nav className={styles.headBreadcrumb} aria-label="Breadcrumb">
              <span>SVN DTS</span>
              <span>/</span>
              <span>{props.title}</span>
              {activeItem ? (
                <>
                  <span>/</span>
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>{activeItem.label}</span>
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

            <div className={styles.userProfile}>
              <div className={styles.userAvatar}>
                {getInitials(displayName)}
              </div>
              <div className={styles.userInfo}>
                <span className={styles.userName}>{displayName}</span>
                <span className={styles.userRole}>
                  {userRole} · {tenantSlug.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </header>

        {props.banner ? <div className={styles.banner}>{props.banner}</div> : null}

        <div className={styles.body}>{props.children}</div>
      </main>
    </div>
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
        className={`${styles.navItem} ${
          props.active ? styles.navItemActive : ''
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

