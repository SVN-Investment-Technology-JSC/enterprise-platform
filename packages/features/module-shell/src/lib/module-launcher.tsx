'use client';

import { AppIcon, useBrandSlot } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { BrandLogo } from './brand-logo';
import { ClassicHomeFallback } from './shell-icons';
import { sortForLauncher } from './module-launcher-order';
import { MODULE_SLOT_MAP, type ModuleSlotId } from './module-slots';
import styles from './module-launcher.module.scss';

/** Phần của danh mục phân hệ mà menu cần (cùng dạng `TenantModuleCatalogItem`). */
export interface LauncherModule {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly launchUrl: string;
  /** Mã ngắn của danh mục, như "WS", "FIN". */
  readonly icon: string | null;
  /** Trạng thái kích hoạt của tenant; khác `active` thì menu hiện mờ, không bấm được. */
  readonly entitlementStatus?: string;
}

const isActive = (module: LauncherModule) => !module.entitlementStatus || module.entitlementStatus === 'active';

/** Chữ thường, bỏ dấu tiếng Việt: gõ "tai chinh" vẫn ra "Tài chính". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Màu nền ô mã phân hệ (khi chưa có icon thương hiệu): chọn theo khoá phân hệ nên phân hệ mới tự có màu. */
const BADGE_COLORS = ['blue', 'green', 'amber', 'violet', 'rose', 'teal', 'orange', 'sky', 'pink', 'slate'] as const;

export function badgeColorOf(moduleKey: string): (typeof BADGE_COLORS)[number] {
  let hash = 0;
  for (const char of moduleKey) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}

/**
 * Icon phân hệ theo đúng logic cũ của ô chuyển: công ty đã cấu hình icon thương hiệu cho phân hệ thì dùng icon đó (lấp
 * đầy ô), không thì hiện mã ngắn của danh mục ("WS", "FIN"…) hoặc chữ đầu của tên.
 */
function ModuleIcon({ module }: { readonly module: LauncherModule }) {
  const className = `${styles.icon} ${styles[`c-${badgeColorOf(module.key)}`]}`;
  const badge = (
    <span className={className} aria-hidden>
      <span className={styles.iconText}>{module.icon || module.name.trim().charAt(0).toUpperCase()}</span>
    </span>
  );
  const slot = MODULE_SLOT_MAP[module.key];
  return slot ? <BrandModuleIcon slot={slot} className={className} fallback={badge} /> : badge;
}

function BrandModuleIcon({
  slot,
  className,
  fallback,
}: {
  readonly slot: ModuleSlotId;
  readonly className: string;
  readonly fallback: ReactNode;
}) {
  const { hasCustom } = useBrandSlot(slot);
  if (!hasCustom) return <>{fallback}</>;
  return (
    <span className={`${className} ${styles.iconBrand}`} aria-hidden>
      <AppIcon slot={slot} fallback={() => <>{fallback}</>} />
    </span>
  );
}

/**
 * Mặt thẻ trong menu: icon + tên. Icon theo logic cũ (icon thương hiệu nếu công ty đã cấu hình, không thì mã ngắn /
 * hình mặc định), nên phân hệ mới tự có thẻ đầy đủ.
 */
function CardFace({
  slot,
  name,
  code,
  glyph,
}: {
  readonly slot?: ModuleSlotId;
  readonly name: string;
  /** Mã ngắn ("WS") khi không có icon thương hiệu và không có hình mặc định. */
  readonly code?: string;
  /** Hình mặc định (svg nét) khi chưa có icon thương hiệu, vd ngôi nhà của Trang chủ. */
  readonly glyph?: (size: number) => ReactNode;
}) {
  const { hasCustom } = useBrandSlot(slot ?? 'shell.home');
  const brand = !!slot && hasCustom;
  let icon: ReactNode;
  if (brand && slot) icon = <AppIcon slot={slot} size={32} fallback={() => null} />;
  else if (glyph) icon = glyph(20);
  else icon = <span className={styles.cardCode}>{code}</span>;
  return (
    <>
      <span className={brand ? `${styles.cardIcon} ${styles.cardIconBrand}` : styles.cardIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.cardName}>{name}</span>
    </>
  );
}

export interface ModuleLauncherPanelProps {
  /** Phân hệ của công ty (cả phân hệ chưa kích hoạt); `undefined` khi đang tải. */
  readonly modules: readonly LauncherModule[] | undefined;
  readonly failed: boolean;
  readonly moduleKey: string;
  /** Trang danh sách ứng dụng (dòng "Tất cả ứng dụng"). */
  readonly homeHref: string;
  /** Trang chủ (Bảng điều khiển): ô đầu tiên của lưới. */
  readonly dashboardHref: string;
  readonly onClose: () => void;
}

/**
 * Menu toàn bộ phân hệ: ngăn cao hết màn hình mở từ mép trái, che luôn thanh bên trái. Một lưới icon duy nhất: ô Trang
 * chủ đứng đầu, rồi các phân hệ theo thứ tự dùng hằng ngày; phân hệ công ty chưa kích hoạt hiện mờ ở cuối. Danh sách lấy
 * từ danh mục nên phân hệ mới tự xuất hiện. Ô tìm không dấu. Mọi ô bấm được là thẻ `<a>` thật (Ctrl + bấm mở thẻ mới).
 */
export function ModuleLauncherPanel({ modules, failed, moduleKey, homeHref, dashboardHref, onClose }: ModuleLauncherPanelProps) {
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const ordered = useMemo(() => sortForLauncher(modules ?? []), [modules]);

  const folded = foldText(query.trim());
  const hits = useMemo(
    () => (folded ? ordered.filter((module) => isActive(module) && foldText(module.name).includes(folded)) : []),
    [folded, ordered],
  );
  const safeHit = Math.min(hitIndex, Math.max(hits.length - 1, 0));

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Còn chữ thì Esc chỉ xoá chữ; không cho lan lên tài liệu (menu đóng khi nhận Esc ở đó).
      if (query) {
        event.stopPropagation();
        setQuery('');
      } else onClose();
      return;
    }
    if (folded) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHitIndex(Math.min(safeHit + 1, hits.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHitIndex(Math.max(safeHit - 1, 0));
      } else if (event.key === 'Enter' && hits[safeHit]) {
        event.preventDefault();
        onClose();
        if (hits[safeHit].key !== moduleKey) window.location.assign(hits[safeHit].launchUrl);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      gridRef.current?.querySelector<HTMLAnchorElement>('a[data-tile]')?.focus();
    }
  };

  /** Mũi tên đi giữa các thẻ trong lưới (2 cột), lên khỏi hàng đầu thì về ô tìm. */
  const onTileKey = (event: KeyboardEvent<HTMLAnchorElement>) => {
    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-tile]') ?? []);
    const index = tiles.indexOf(event.currentTarget);
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 } as Record<string, number>)[event.key];
    if (step === undefined || index < 0) return;
    event.preventDefault();
    const next = index + step;
    if (next < 0) searchRef.current?.focus();
    else tiles[Math.min(next, tiles.length - 1)]?.focus();
  };

  /** Bấm vào phân hệ đang mở thì chỉ đóng menu (Ctrl + bấm vẫn mở thẻ mới). */
  const onPick = (event: MouseEvent, key: string) => {
    if (key === moduleKey && !event.ctrlKey && !event.metaKey) event.preventDefault();
    onClose();
  };

  return (
    // Ngăn cao hết màn hình mở từ mép trái, che cả thanh bên trái; bấm ra vùng mờ bên phải để đóng.
    <div className={styles.overlay} onMouseDown={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Chuyển phân hệ"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <BrandLogo className={styles.headLogo} alt="Logo" />
          <label className={styles.searchRow}>
            <SearchGlyph />
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder="Tìm phân hệ…"
              aria-label="Tìm phân hệ"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHitIndex(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <button type="button" className={styles.close} aria-label="Đóng" title="Đóng (Esc)" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className={styles.scroll}>
          {folded ? (
            <div className={styles.results} role="listbox" aria-label="Kết quả tìm">
              {hits.length === 0 ? <div className={styles.note}>Không có phân hệ khớp “{query.trim()}”.</div> : null}
              {hits.map((module, index) => (
                <a
                  key={module.key}
                  href={module.launchUrl}
                  role="option"
                  aria-selected={index === safeHit}
                  className={index === safeHit ? `${styles.result} ${styles.resultActive}` : styles.result}
                  onMouseEnter={() => setHitIndex(index)}
                  onClick={(event) => onPick(event, module.key)}
                >
                  <ModuleIcon module={module} />
                  <span className={styles.resultText}>{module.name}</span>
                </a>
              ))}
            </div>
          ) : (
            <div ref={gridRef} className={styles.grid} aria-label="Phân hệ">
              {/* Trang chủ là thẻ đầu tiên, cùng dáng các phân hệ: ở đâu cũng thấy đường quay về Bảng điều khiển. */}
              <a data-tile href={dashboardHref} className={`${styles.card} ${styles['tone-blue']}`} onKeyDown={onTileKey} onClick={onClose}>
                <CardFace slot="shell.home" name="Trang chủ" glyph={(size) => <ClassicHomeFallback size={size} />} />
              </a>
              {ordered.map((module) => {
                const current = module.key === moduleKey;
                const tone = styles[`tone-${badgeColorOf(module.key)}`];
                const face = (
                  <CardFace
                    slot={MODULE_SLOT_MAP[module.key]}
                    name={module.name}
                    code={module.icon || module.name.trim().charAt(0).toUpperCase()}
                  />
                );
                if (!isActive(module)) {
                  return (
                    <span key={module.key} className={`${styles.card} ${tone} ${styles.cardInactive}`} aria-disabled="true">
                      {face}
                    </span>
                  );
                }
                return (
                  <a
                    key={module.key}
                    data-tile
                    href={module.launchUrl}
                    aria-current={current ? 'page' : undefined}
                    className={current ? `${styles.card} ${tone} ${styles.cardCurrent}` : `${styles.card} ${tone}`}
                    onKeyDown={onTileKey}
                    onClick={(event) => onPick(event, module.key)}
                  >
                    {face}
                  </a>
                );
              })}
            </div>
          )}
          {!modules && !failed ? <div className={styles.note}>Đang tải danh sách phân hệ…</div> : null}
          {failed ? <div className={styles.note}>Không tải được danh sách phân hệ.</div> : null}
        </div>

        <div className={styles.foot}>
          <a href={homeHref} className={styles.footLink} onClick={onClose}>
            Tất cả ứng dụng →
          </a>
        </div>
      </aside>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
