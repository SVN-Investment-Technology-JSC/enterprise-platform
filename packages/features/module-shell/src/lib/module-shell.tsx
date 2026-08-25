'use client';

import type { ModuleNavItem, ModuleShellProps } from './module-shell.types';
import styles from './module-shell.module.scss';

/**
 * Khung chung của ba module: rail điều hướng dọc bên trái, header, nội dung.
 *
 * Cố ý thuần trình bày — không fetch, không giữ state dữ liệu. Module truyền
 * `view`/`onViewChange` vào (thường lấy từ `useHashView`) nên shell không cần
 * biết gì về cơ chế định tuyến.
 */
export function ModuleShell<TViewId extends string = string>(props: ModuleShellProps<TViewId>) {
  const visible = props.nav.filter((item) => !item.hidden);

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label={`Điều hướng ${props.title}`}>
        <span className={styles.railBrand}>{props.title}</span>
        {visible.map((item, index) => (
          <NavEntry
            key={item.id}
            item={item}
            active={item.id === props.view}
            // Tiêu đề nhóm chỉ hiện ở mục đầu tiên của nhóm, nên các mục liền
            // nhau cùng `group` gom lại dưới một tiêu đề duy nhất.
            groupHeading={item.group !== undefined && item.group !== visible[index - 1]?.group}
            onSelect={() => props.onViewChange(item.id)}
          />
        ))}
        {props.homeHref ? (
          <div className={styles.railFoot}>
            <a className={styles.homeLink} href={props.homeHref}>
              ← Trang chủ
            </a>
          </div>
        ) : null}
      </nav>

      <main className={styles.main}>
        <header className={styles.head}>
          <div>
            <h1>{props.title}</h1>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          {props.actions ? <div className={styles.headActions}>{props.actions}</div> : null}
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
      {props.groupHeading ? <span className={styles.railGroup}>{item.group}</span> : null}
      <button
        type="button"
        className={`${styles.navItem} ${props.active ? styles.navItemActive : ''}`}
        aria-current={props.active ? 'page' : undefined}
        onClick={props.onSelect}
      >
        {item.icon ? <span className={styles.navIcon}>{item.icon}</span> : null}
        <span className={styles.navLabel}>{item.label}</span>
        {item.badge !== undefined ? <span className={styles.navBadge}>{item.badge}</span> : null}
      </button>
    </>
  );
}
