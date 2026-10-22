'use client';

import { NotificationBell, NotificationProvider, SearchableSelect, SessionKeepAlive } from '@enterprise-platform/shared-ui';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  ModuleNavItem,
  ModuleShellProps,
  ModuleSidebarSection,
} from './module-shell.types';
import { AssistantLauncher } from './assistant-launcher';
import { ModuleSwitcher } from './module-switcher';
import { initialsOfName, useShellSession } from './use-shell-session';
import styles from './module-shell-light.module.scss';

/** Giới hạn độ rộng thanh bên khi kéo tay, và khoá lưu theo từng module. */
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE = 'ep-sidebar-width:';

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
  // Tìm cả trong mục ẩn: một trang có thể không có dòng riêng trên thanh bên
  // (mở từ mục khác) mà breadcrumb vẫn phải mang tên trang đó.
  const activeItem = props.nav.find((item) => item.id === props.view);
  const firstItem = visible[0];
  const { principal, loggingOut, logoutError, logout } = useShellSession();
  const collapsed = Boolean(props.collapsible && props.collapsed);
  // Menu cha mặc định mở; người dùng thu lại thì nhớ trong phiên.
  const [closedParents, setClosedParents] = useState<ReadonlySet<string>>(new Set());
  const homeHref = props.homeHref || '/applications';
  const dashboardHref = props.dashboardHref || '/dashboard';
  const displayName = props.actor || principal?.displayName || 'Thành viên';
  const isTenantAdmin =
    principal?.systemRole === 'tenant-admin' || (principal?.roles ?? []).includes('tenant-admin');
  const tenantSlug =
    props.tenantSlug ||
    (principal?.kind === 'tenant-user' ? principal.tenantSlug : undefined) ||
    'savina';
  /**
   * Bậc giữa mang nhãn của trang đang mở (ví dụ "Dự án") bấm được để quay về
   * trang mặc định của trang đó — hữu ích khi đang xem chi tiết một mục và muốn
   * về danh sách. Các bậc do `props.crumbs` cung cấp là văn bản tĩnh.
   */
  const crumbs: readonly { readonly label: string; readonly onClick?: () => void }[] = [
    ...(activeItem && activeItem.id !== firstItem?.id
      ? [{ label: activeItem.label, onClick: () => props.onViewChange(activeItem.id) }]
      : []),
    ...(props.crumbs ?? []).map((label) => ({ label })),
  ];
  const { onQuickSearch } = props;

  /**
   * Độ rộng thanh bên do người dùng kéo. `undefined` nghĩa là chưa đụng tới,
   * dùng mặc định trong scss; vì vậy module nào không kéo thì giữ nguyên như cũ.
   */
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>();
  const [resizing, setResizing] = useState(false);
  const draggingRef = useRef(false);

  // Khôi phục độ rộng đã lưu theo từng module (mỗi module một thói quen riêng).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE + props.moduleKey);
      const value = saved ? Number(saved) : NaN;
      if (Number.isFinite(value)) {
        setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value)));
      }
    } catch {
      // localStorage có thể bị chặn (chế độ riêng tư); bỏ qua, dùng mặc định.
    }
  }, [props.moduleKey]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      setResizing(true);
      // Thanh bên bám sát cạnh trái màn hình, nên con trỏ theo trục X chính là
      // độ rộng mong muốn.
      const onMove = (move: PointerEvent) => {
        if (!draggingRef.current) return;
        const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, move.clientX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        draggingRef.current = false;
        setResizing(false);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        setSidebarWidth((current) => {
          if (current !== undefined) {
            try {
              window.localStorage.setItem(
                SIDEBAR_WIDTH_STORAGE + props.moduleKey,
                String(current),
              );
            } catch {
              // bỏ qua nếu không ghi được.
            }
          }
          return current;
        });
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [props.moduleKey],
  );

  // Chỉ ghi đè độ rộng khi không thu gọn: lúc thu gọn phải nhường cho dải 64px.
  const shellStyle =
    !collapsed && sidebarWidth !== undefined
      ? ({ '--ep-sidebar-w': `${sidebarWidth}px` } as CSSProperties)
      : undefined;

  useEffect(() => {
    if (!onQuickSearch) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onQuickSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onQuickSearch]);

  return (
    <NotificationProvider>
      <SessionKeepAlive />
      <div
        className={collapsed ? `${styles.shell} ${styles.shellCollapsed}` : styles.shell}
        style={shellStyle}
      >
        <nav
          className={resizing ? `${styles.sidebar} ${styles.sidebarResizing}` : styles.sidebar}
          aria-label={`Điều hướng ${props.title}`}
        >
          <div className={styles.brand}>
            <img src="/brand-logo.jpg" alt="" className={styles.brandLogo} />
            {collapsed ? null : (
              <div className={styles.brandText}>
                <span className={styles.brandOrg}>SVN DTS</span>
                <span className={styles.brandTitle}>{props.title}</span>
              </div>
            )}
            {collapsed || props.hideModuleSwitcher ? null : <ModuleSwitcher moduleKey={props.moduleKey} homeHref={homeHref} />}
          </div>

          <div className={styles.user}>
            <a className={styles.userLink} href={dashboardHref} title="Về Bảng điều khiển">
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
            </a>
            {collapsed ? null : <NotificationBell className={styles.bell} />}
            {collapsed ? null : <AssistantLauncher className={styles.bell} />}
          </div>

          {onQuickSearch ? (
            <div className={styles.searchWrap}>
              <button
                type="button"
                className={collapsed ? styles.squareButton : styles.search}
                aria-label="Tìm nhanh (Ctrl+K)"
                title="Tìm nhanh (Ctrl+K)"
                onClick={onQuickSearch}
              >
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                {collapsed ? null : (
                  <>
                    <span className={styles.searchLabel}>Tìm nhanh</span>
                    <kbd className={styles.kbd}>Ctrl K</kbd>
                  </>
                )}
              </button>
            </div>
          ) : null}

          <div className={styles.scroll}>
            <div className={styles.navList}>
              {visible.map((item, index) => {
                const previous = visible[index - 1];
                const parent = item.parent;
                const startsParent = parent !== undefined && parent !== previous?.parent;
                const parentOpen = parent !== undefined && (collapsed || !closedParents.has(parent));
                const groupMembers = parent === undefined ? [] : visible.filter((entry) => entry.parent === parent);
                const containsActive = groupMembers.some((entry) => entry.id === props.view);
                if (parent !== undefined && !parentOpen && !startsParent) return null;
                return (
                  <Fragment key={item.id}>
                    {startsParent && !collapsed ? (
                      <NavParent
                        active={containsActive}
                        icon={item.parentIcon ?? item.icon}
                        label={parent}
                        onToggle={() =>
                          setClosedParents((current) => {
                            const next = new Set(current);
                            if (next.has(parent)) next.delete(parent);
                            else next.add(parent);
                            return next;
                          })
                        }
                        open={parentOpen}
                      />
                    ) : null}
                    {parent !== undefined && !parentOpen ? null : (
                      <NavEntry
                        item={item}
                        active={item.id === props.view}
                        child={parent !== undefined && !collapsed}
                        groupHeading={
                          !collapsed &&
                          item.group !== undefined &&
                          item.group !== previous?.group
                        }
                        collapsed={collapsed}
                        onSelect={() => props.onViewChange(item.id)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
            {(props.sidebarSections ?? []).map((section) => (
              <SidebarSection key={section.id} section={section} collapsed={collapsed} />
            ))}
          </div>

          <div className={styles.foot}>
            {!props.hideHomeButton ? (
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
            ) : null}
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
            {props.settings ? (
              <button
                type="button"
                className={
                  props.settings.active
                    ? `${styles.squareButton} ${styles.squareButtonActive}`
                    : styles.squareButton
                }
                aria-label={props.settings.label ?? 'Cài đặt'}
                aria-current={props.settings.active ? 'page' : undefined}
                title={props.settings.label ?? 'Cài đặt'}
                onClick={props.settings.onOpen}
              >
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
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

          {/* Kéo cạnh phải để đổi độ rộng thanh bên. Ẩn khi thu gọn và trên
              màn hẹp (thanh bên lúc đó nằm ngang trên nội dung). */}
          {collapsed ? null : (
            <div
              className={styles.resizeHandle}
              role="separator"
              aria-orientation="vertical"
              aria-label="Kéo để đổi độ rộng thanh bên"
              onPointerDown={startResize}
            />
          )}
        </nav>

        <main className={styles.main}>
          <div className={styles.head}>
            <nav className={styles.breadcrumb} aria-label="Đường dẫn">
              {homeHref && !props.hideHomeButton ? (
                <>
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
                </>
              ) : null}
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
              {crumbs.map((crumb, index) => (
                <span key={`${index}-${crumb.label}`} className={styles.crumbItem}>
                  <span className={styles.crumbSep} aria-hidden>
                    ›
                  </span>
                  {index === crumbs.length - 1 ? (
                    <span className={styles.crumbCurrent} aria-current="page">
                      {crumb.label}
                    </span>
                  ) : crumb.onClick ? (
                    <button type="button" className={styles.crumbLink} onClick={crumb.onClick}>
                      {crumb.label}
                    </button>
                  ) : (
                    <span className={styles.crumbParent}>{crumb.label}</span>
                  )}
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

/** Mục riêng của module trên thanh bên (xem `ModuleSidebarSection`). */
function SidebarSection(props: { section: ModuleSidebarSection; collapsed: boolean }) {
  const { section, collapsed } = props;
  return (
    <div className={styles.section}>
      {collapsed ? null : (
        <div className={styles.sectionHead}>
          {section.onTitleClick ? (
            <button
              type="button"
              className={
                section.titleActive
                  ? `${styles.sectionTitle} ${styles.sectionTitleButton} ${styles.sectionTitleActive}`
                  : `${styles.sectionTitle} ${styles.sectionTitleButton}`
              }
              aria-current={section.titleActive ? 'page' : undefined}
              onClick={section.onTitleClick}
            >
              {section.title}
              {section.count !== undefined ? (
                <span className={styles.sectionCount}>{section.count}</span>
              ) : null}
            </button>
          ) : (
            <span className={styles.sectionTitle}>
              {section.title}
              {section.count !== undefined ? (
                <span className={styles.sectionCount}>{section.count}</span>
              ) : null}
            </span>
          )}
          {section.action ? (
            <button
              type="button"
              className={styles.sectionAction}
              aria-label={section.action.label}
              title={section.action.label}
              onClick={section.action.onClick}
            >
              {section.action.icon ?? (
                <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              )}
            </button>
          ) : null}
        </div>
      )}
      {!collapsed && section.filter ? (
        // Combobox gõ-để-lọc theo quy chuẩn chung (không dùng `<select>` tĩnh);
        // ô to hơn, tìm nhanh theo tên loại.
        <div
          className={styles.sectionFilter}
          role="group"
          aria-label={section.filter.label}
          title={section.filter.label}
        >
          <SearchableSelect
            options={section.filter.options}
            value={section.filter.value}
            placeholder={section.filter.label}
            clearable
            onChange={(value) => section.filter?.onChange(value)}
          />
        </div>
      ) : null}
      {section.items.map((item, index) => (
        <Fragment key={item.id}>
          {!collapsed && item.group && item.group !== section.items[index - 1]?.group ? (
            <span className={styles.sectionGroup}>{item.group}</span>
          ) : null}
        <button
          type="button"
          className={item.active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
          aria-current={item.active ? 'page' : undefined}
          title={item.title ?? item.label}
          aria-label={collapsed ? item.label : undefined}
          onClick={item.onSelect}
        >
          {item.leading ? <span className={styles.navIcon}>{item.leading}</span> : null}
          {collapsed ? null : <span className={styles.navLabel}>{item.label}</span>}
          {!collapsed && item.trailing !== undefined ? (
            <span className={styles.sectionTrailing}>{item.trailing}</span>
          ) : null}
        </button>
        </Fragment>
      ))}
      {!collapsed && section.items.length === 0 && section.emptyText ? (
        <span className={styles.sectionEmpty}>{section.emptyText}</span>
      ) : null}
      {!collapsed && section.footer ? (
        <button type="button" className={styles.sectionFooter} onClick={section.footer.onClick}>
          {section.footer.label}
        </button>
      ) : null}
    </div>
  );
}

function NavParent(props: { label: string; icon?: ReactNode; active: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button
      aria-expanded={props.open}
      className={props.active ? `${styles.navItem} ${styles.navParent} ${styles.navParentActive}` : `${styles.navItem} ${styles.navParent}`}
      onClick={props.onToggle}
      type="button"
    >
      {props.icon ? <span className={styles.navIcon}>{props.icon}</span> : null}
      <span className={styles.navLabel}>{props.label}</span>
      <svg
        aria-hidden="true"
        className={props.open ? `${styles.navChevron} ${styles.navChevronOpen}` : styles.navChevron}
        fill="none"
        height="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="14"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function NavEntry<TViewId extends string>(props: {
  item: ModuleNavItem<TViewId>;
  active: boolean;
  child?: boolean;
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
        className={[styles.navItem, props.active ? styles.navItemActive : '', props.child ? styles.navChild : '']
          .filter(Boolean)
          .join(' ')}
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
