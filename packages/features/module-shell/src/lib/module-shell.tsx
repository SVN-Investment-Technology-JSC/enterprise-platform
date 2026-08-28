'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const response = await fetch('/api/auth/v1/me', {
          credentials: 'include',
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
    (tenantSlug ? `/t/${tenantSlug}/applications` : '/t/savina');

  const loginPath = `/t/${tenantSlug}/login`;
  const displayName = props.actor || principal?.displayName || 'Savina Member';
  const userRole = principal?.roles?.[0] || 'Tenant Admin';

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/v1/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = loginPath;
    }
  };

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label={`Điều hướng ${props.title}`}>
        <div className={styles.brand}>
          <img
            src="/brand-logo.jpg"
            alt="SVN DTS Logo"
            className={styles.brandLogo}
          />
          <div className={styles.brandText}>
            <h2 className={styles.brandTitle}>{props.title}</h2>
            <span className={styles.brandSubtitle}>
              {tenantSlug.toUpperCase()} · Phân hệ
            </span>
          </div>
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
              onSelect={() => props.onViewChange(item.id)}
            />
          ))}
        </div>

        <div className={styles.railFoot}>
          <a className={styles.homeLink} href={homeHref}>
            ← Trang chủ
          </a>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={handleLogout}
          >
            Đăng xuất
          </button>
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
  onSelect: () => void;
}) {
  const { item } = props;
  return (
    <>
      {props.groupHeading ? (
        <span className={styles.railGroup}>{item.group}</span>
      ) : null}
      <button
        type="button"
        className={`${styles.navItem} ${
          props.active ? styles.navItemActive : ''
        }`}
        aria-current={props.active ? 'page' : undefined}
        onClick={props.onSelect}
      >
        {item.icon ? <span className={styles.navIcon}>{item.icon}</span> : null}
        <span className={styles.navLabel}>{item.label}</span>
        {item.badge !== undefined ? (
          <span className={styles.navBadge}>{item.badge}</span>
        ) : null}
      </button>
    </>
  );
}

