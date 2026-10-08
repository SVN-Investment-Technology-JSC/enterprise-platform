'use client';

import { NotificationBell, NotificationProvider } from '@enterprise-platform/shared-ui';
import type { ModuleNavItem, ModuleShellProps } from './module-shell.types';
import { initialsOfName, useShellSession } from './use-shell-session';
import styles from './module-shell-light.module.scss';

/**
 * Khung sáng: thanh bên trắng có khối người dùng và các mục điều hướng; không
 * có thanh trên.
 *
 * Breadcrumb và nút thao tác của trang nằm ngay đầu vùng nội dung, nên phần
 * trên cùng của màn hình dành cho nội dung chứ không cho một thanh tiêu đề lặp
 * lại tên trang.
 */
export function ModuleShellLight<TViewId extends string = string>(
  props: ModuleShellProps<TViewId>,
) {
  const visible = props.nav.filter((item) => !item.hidden);
  const activeItem = visible.find((item) => item.id === props.view);
  const firstItem = visible[0];
  const { principal, loggingOut, logoutError, logout } = useShellSession();
  const collapsed = Boolean(props.collapsible && props.collapsed);
  const homeHref = props.homeHref || '/applications';
  const displayName = props.actor || principal?.displayName || 'Thành viên';
  const isTenantAdmin =
    principal?.systemRole === 'tenant-admin' || (principal?.roles ?? []).includes('tenant-admin');
  const tenantSlug =
    props.tenantSlug ||
    (principal?.kind === 'tenant-user' ? principal.tenantSlug : undefined) ||
    'savina';
  const crumbs = activeItem && activeItem.id !== firstItem?.id ? [activeItem.label] : [];

  return (
    <NotificationProvider>
      <div className={collapsed ? `${styles.shell} ${styles.shellCollapsed}` : styles.shell}>
        <nav className={styles.sidebar} aria-label={`Điều hướng ${props.title}`}>
          <div className={styles.brand}>
            <img src="/brand-logo.jpg" alt="" className={styles.brandLogo} />
            {collapsed ? null : (
              <div className={styles.brandText}>
                <span className={styles.brandOrg}>SVN DTS</span>
                <span className={styles.brandTitle}>{props.title}</span>
              </div>
            )}
            {collapsed ? null : (
              <a
                className={styles.squareButton}
                href={homeHref}
                title="Chuyển phân hệ"
                aria-label="Chuyển phân hệ"
              >
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
              </a>
            )}
          </div>

          <div className={styles.user}>
            <span className={styles.avatar} aria-hidden>
              {initialsOfName(displayName)}
            </span>
            {collapsed ? null : (
              <span className={styles.userText}>
                <span className={styles.userName}>{displayName}</span>
                <span className={styles.userRole}>
                  {isTenantAdmin ? 'Quản trị viên' : 'Thành viên'} · {tenantSlug.toUpperCase()}
                </span>
              </span>
            )}
            {collapsed ? null : <NotificationBell className={styles.bell} />}
          </div>

          <div className={styles.scroll}>
            <div className={styles.navList}>
              {visible.map((item, index) => (
                <NavEntry
                  key={item.id}
                  item={item}
                  active={item.id === props.view}
                  groupHeading={
                    !collapsed &&
                    item.group !== undefined &&
                    item.group !== visible[index - 1]?.group
                  }
                  collapsed={collapsed}
                  onSelect={() => props.onViewChange(item.id)}
                />
              ))}
            </div>
          </div>

          <div className={styles.foot}>
            <a
              className={styles.squareButton}
              href={homeHref}
              title="Trang chủ"
              aria-label="Trang chủ"
            >
              <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M9 22V12h6v10" />
              </svg>
            </a>
            {props.collapsible ? (
              <button
                type="button"
                className={styles.squareButton}
                aria-expanded={!collapsed}
                aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
                title={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
                onClick={() => props.onCollapsedChange?.(!collapsed)}
              >
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            ) : null}
            <span className={styles.footSpacer} />
            <button
              type="button"
              className={styles.squareButton}
              onClick={() => void logout()}
              disabled={loggingOut}
              aria-label="Đăng xuất"
              title={logoutError || (loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất')}
            >
              <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
          {logoutError ? (
            <p className={styles.logoutError} role="alert">
              {logoutError}
            </p>
          ) : null}
        </nav>

        <main className={styles.main}>
          <div className={styles.head}>
            <nav className={styles.breadcrumb} aria-label="Đường dẫn">
              <a
                className={styles.crumbHome}
                href={homeHref}
                aria-label="Trang chủ"
                title="Trang chủ"
              >
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <path d="M9 22V12h6v10" />
                </svg>
              </a>
              <span className={styles.crumbSep} aria-hidden>
                ›
              </span>
              {crumbs.length > 0 && firstItem ? (
                <button
                  type="button"
                  className={styles.crumbLink}
                  onClick={() => props.onViewChange(firstItem.id)}
                >
                  {props.title}
                </button>
              ) : (
                <span className={styles.crumbCurrent} aria-current="page">
                  {props.title}
                </span>
              )}
              {crumbs.map((label) => (
                <span key={label} className={styles.crumbItem}>
                  <span className={styles.crumbSep} aria-hidden>
                    ›
                  </span>
                  <span className={styles.crumbCurrent} aria-current="page">
                    {label}
                  </span>
                </span>
              ))}
            </nav>
            {props.actions ? <div className={styles.actions}>{props.actions}</div> : null}
          </div>

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
  collapsed: boolean;
  onSelect: () => void;
}) {
  const { item } = props;
  return (
    <>
      {props.groupHeading ? <span className={styles.groupHeading}>{item.group}</span> : null}
      <button
        type="button"
        className={props.active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
        aria-current={props.active ? 'page' : undefined}
        title={props.collapsed ? item.label : undefined}
        aria-label={props.collapsed ? item.label : undefined}
        onClick={props.onSelect}
      >
        {item.icon ? <span className={styles.navIcon}>{item.icon}</span> : null}
        {props.collapsed ? null : <span className={styles.navLabel}>{item.label}</span>}
        {item.badge !== undefined && !props.collapsed ? (
          <span className={styles.navBadge}>{item.badge}</span>
        ) : null}
      </button>
    </>
  );
}
