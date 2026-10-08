'use client';

import { authFetch } from '@enterprise-platform/shared-ui';
import { useEffect, useRef, useState } from 'react';
import styles from './module-shell-light.module.scss';

/**
 * Phần của danh mục phân hệ mà ô chuyển cần.
 *
 * Cùng dạng với `TenantModuleCatalogItem` của contracts-tenancy, khai báo lại
 * ở đây cho khung khỏi phụ thuộc cả gói hợp đồng tenancy chỉ vì vài trường.
 */
interface CatalogModule {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly launchUrl: string;
  /** Mã ngắn hiện trong ô vuông, như "WS", "IV". */
  readonly icon: string | null;
  readonly entitlementStatus: string;
}

export interface ModuleSwitcherProps {
  /** Phân hệ đang mở, để đánh dấu và không tự dẫn về chính nó. */
  readonly moduleKey: string;
  /** Trang danh sách ứng dụng của tenant, cho dòng "Tất cả ứng dụng". */
  readonly homeHref: string;
}

/**
 * Nút lưới trên thanh bên: bấm mở danh sách các phân hệ tenant đang dùng để
 * nhảy thẳng sang, không phải quay về trang Ứng dụng rồi chọn lại.
 *
 * Danh mục chỉ tải khi mở lần đầu. Tải hỏng thì vẫn còn dòng "Tất cả ứng
 * dụng", nên nút không bao giờ thành ngõ cụt.
 */
export function ModuleSwitcher({ moduleKey, homeHref }: ModuleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [modules, setModules] = useState<readonly CatalogModule[]>();
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || modules) return;
    let active = true;
    authFetch('/api/platform/v1/modules/catalog', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { modules: CatalogModule[] };
        if (active) setModules(payload.modules.filter((m) => m.entitlementStatus === 'active'));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, modules]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.switcher}>
      <button
        type="button"
        className={styles.squareButton}
        title="Chuyển phân hệ"
        aria-label="Chuyển phân hệ"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>

      {open ? (
        <div className={styles.switcherMenu} role="menu" aria-label="Chuyển phân hệ">
          <span className={styles.switcherHead}>Chuyển phân hệ</span>
          {!modules && !failed ? <span className={styles.switcherNote}>Đang tải…</span> : null}
          {failed ? (
            <span className={styles.switcherNote}>Không tải được danh sách phân hệ.</span>
          ) : null}
          {modules?.map((module) => {
            const current = module.key === moduleKey;
            return (
              <a
                key={module.key}
                role="menuitem"
                href={module.launchUrl}
                aria-current={current ? 'page' : undefined}
                className={
                  current ? `${styles.switcherItem} ${styles.switcherCurrent}` : styles.switcherItem
                }
                onClick={(event) => {
                  if (current) {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              >
                <span className={styles.switcherBadge} aria-hidden>
                  {module.icon || module.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className={styles.switcherText}>
                  <span className={styles.switcherName}>{module.name}</span>
                  <span className={styles.switcherDesc}>{module.description}</span>
                </span>
              </a>
            );
          })}
          <a role="menuitem" href={homeHref} className={styles.switcherAll}>
            Tất cả ứng dụng
          </a>
        </div>
      ) : null}
    </div>
  );
}
