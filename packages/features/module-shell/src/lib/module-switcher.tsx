'use client';

import { AppIcon, authFetch } from '@enterprise-platform/shared-ui';
import { useEffect, useRef, useState } from 'react';
import { isLauncherOnlyModule } from './launcher-only-modules';
import { ModuleLauncherPanel, type LauncherModule } from './module-launcher';
import { ModuleGridFallback } from './shell-icons';
import styles from './module-shell-light.module.scss';

/**
 * Danh mục phân hệ dùng chung cho mọi nút chuyển trên trang và nhớ trong phiên (sessionStorage): mở menu là có ngay danh
 * sách cũ, đồng thời tải lại ngầm nếu bản nhớ đã quá `CATALOG_FRESH_MS`. Danh mục ít khi đổi (bật/tắt phân hệ).
 * Giữ cả phân hệ chưa kích hoạt (menu hiện mờ), chỉ bỏ phân hệ chỉ mở từ nút riêng (trợ lý, chat).
 */
const CATALOG_KEY = 'module-switcher.catalog.v2';
const CATALOG_FRESH_MS = 5 * 60_000;
let catalogRequest: Promise<readonly LauncherModule[]> | undefined;

function readCachedCatalog(): { readonly at: number; readonly modules: readonly LauncherModule[] } | undefined {
  try {
    const raw = window.sessionStorage.getItem(CATALOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as { at?: unknown; modules?: unknown }) : undefined;
    return parsed && typeof parsed.at === 'number' && Array.isArray(parsed.modules)
      ? { at: parsed.at, modules: parsed.modules as LauncherModule[] }
      : undefined;
  } catch {
    return undefined;
  }
}

function loadCatalog(): Promise<readonly LauncherModule[]> {
  catalogRequest ??= authFetch('/api/platform/v1/modules/catalog', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { modules: LauncherModule[] };
      const modules = payload.modules.filter((m) => !isLauncherOnlyModule(m.key));
      try {
        window.sessionStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), modules }));
      } catch {
        /* bộ nhớ trình duyệt bị chặn: chỉ giữ trong trang này */
      }
      return modules;
    })
    .finally(() => {
      catalogRequest = undefined;
    });
  return catalogRequest;
}

/** Đang gõ trong ô nhập (hoặc vùng soạn thảo) thì phím G là chữ, không phải phím tắt. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export interface ModuleSwitcherProps {
  /** Phân hệ đang mở, để đánh dấu và không tự dẫn về chính nó. */
  readonly moduleKey: string;
  /** Trang danh sách ứng dụng của tenant, cho dòng "Tất cả ứng dụng". */
  readonly homeHref: string;
  /** Trang chủ (Bảng điều khiển), luôn là ô đầu tiên của menu để người dùng biết đường quay về. */
  readonly dashboardHref?: string;
}

/**
 * Nút lưới trên thanh bên (hoặc phím G): mở menu toàn bộ phân hệ để nhảy thẳng sang, không phải quay về trang Ứng dụng.
 *
 * Danh mục được tải ngầm ngay sau khi trang mở (và nhớ trong phiên) nên bấm mở là có danh sách ngay. Tải hỏng thì
 * vẫn còn ô Trang chủ và dòng "Tất cả ứng dụng", nên nút không bao giờ thành ngõ cụt.
 */
export function ModuleSwitcher({ moduleKey, homeHref, dashboardHref = '/dashboard' }: ModuleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [modules, setModules] = useState<readonly LauncherModule[]>();
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Phím tắt G mở menu từ bất kỳ đâu, trừ khi đang gõ chữ hoặc đang mở một hộp thoại.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'g' && event.key !== 'G') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Có bản nhớ trong phiên thì dùng ngay; tải (lại) ngầm khi chưa có hoặc đã cũ — không chờ người dùng bấm mở.
  useEffect(() => {
    let active = true;
    const cached = readCachedCatalog();
    if (cached) setModules(cached.modules);
    if (cached && Date.now() - cached.at < CATALOG_FRESH_MS) return;
    const run = () =>
      loadCatalog()
        .then((list) => {
          if (active) {
            setModules(list);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active && !cached) setFailed(true);
        });
    // Chờ trang mở xong rồi mới tải, để không giành mạng với dữ liệu chính của phân hệ.
    const timer = window.setTimeout(run, cached ? 0 : 800);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  // Bấm mở trước khi kịp tải ngầm (hoặc lần trước hỏng): tải ngay.
  useEffect(() => {
    if (!open || modules) return;
    let active = true;
    setFailed(false);
    loadCatalog()
      .then((list) => {
        if (active) setModules(list);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={rootRef} className={styles.switcher}>
      <button
        type="button"
        className={styles.squareButton}
        title="Chuyển phân hệ (G)"
        aria-label="Chuyển phân hệ"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AppIcon slot="shell.module-switcher" fallback={ModuleGridFallback} className={styles.icon} />
      </button>

      {open ? (
        <ModuleLauncherPanel
          modules={modules}
          failed={failed}
          moduleKey={moduleKey}
          homeHref={homeHref}
          dashboardHref={dashboardHref}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
