'use client';

import { CATALOG_MATERIAL_KINDS, CATALOG_MATERIAL_KIND_LABELS, type CrmCatalogMaterial } from '@enterprise-platform/contracts-crm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, listCatalogTradeCategories, searchCatalog, type CatalogSearchQuery } from '../crm-api';
import styles from '../sales.module.scss';
import { useDebounced } from './use-debounced';

/** Nhóm ở màn Hàng hóa của Kho (mã `kind`): hàng hoá hay dịch vụ. */
export const catalogKindLabel = (kind: string | null | undefined) => (kind === 'SERVICE' ? CATALOG_MATERIAL_KIND_LABELS.SERVICE : CATALOG_MATERIAL_KIND_LABELS.STOCK);

const KIND_OPTIONS = CATALOG_MATERIAL_KINDS.map((kind) => ({ value: kind, label: CATALOG_MATERIAL_KIND_LABELS[kind] }));

/**
 * Tìm mặt hàng theo trang (xếp theo mã), đánh số 1, 2, 3. Kho phân trang theo mã cuối của trang trước và không trả
 * tổng số, nên số trang hiện là các trang đã biết: tải xong trang N mà còn hàng thì hiện thêm trang N + 1. Đổi từ khoá
 * hoặc nhóm thì về trang 1. Trước đây chỉ tải 30 mặt hàng đầu nên danh mục dài bị cắt.
 */
export function useCatalogSearch(pricedFor?: CatalogSearchQuery['pricedFor'], initialSearch = '') {
  const [search, setSearch] = useState(initialSearch);
  const [kind, setKindState] = useState('');
  const [tradeCategory, setTradeCategory] = useState('');
  const [tradeCategories, setTradeCategories] = useState<readonly string[]>([]);
  const [items, setItems] = useState<readonly CrmCatalogMaterial[]>([]);
  /** Cursor mở đầu từng trang đã biết: `[null]` là chỉ biết trang 1. */
  const [starts, setStarts] = useState<readonly (string | null)[]>([null]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const q = useDebounced(search.trim(), 300);
  const quoteId = pricedFor?.quoteId;
  const versionNo = pricedFor?.versionNo;
  /** Lần tải mới nhất; kết quả của lần cũ (từ khoá trước) bị bỏ. */
  const request = useRef(0);

  const load = useCallback(
    (target: number, cursor: string | null) => {
      const id = ++request.current;
      setLoading(true);
      searchCatalog({
        search: q,
        cursor,
        kind,
        tradeCategory,
        ...(quoteId && versionNo ? { pricedFor: { quoteId, versionNo } } : {}),
      })
        .then((result) => {
          if (id !== request.current) return;
          setItems(result.items);
          setPage(target);
          setStarts((current) => {
            const known = current.slice(0, target);
            return result.nextCursor ? [...known, result.nextCursor] : known;
          });
          setError(undefined);
        })
        .catch((cause) => id === request.current && setError(errorMessage(cause, 'Không tải được danh mục Kho.')))
        .finally(() => id === request.current && setLoading(false));
    },
    [q, kind, tradeCategory, quoteId, versionNo],
  );

  useEffect(() => {
    setStarts([null]);
    load(1, null);
  }, [load]);

  // Danh sách phân loại theo nhóm đang lọc; lỗi thì chỉ mất ô lọc, vẫn tìm được.
  useEffect(() => {
    let active = true;
    listCatalogTradeCategories(kind || undefined)
      .then((names) => active && setTradeCategories(names))
      .catch(() => active && setTradeCategories([]));
    return () => {
      active = false;
    };
  }, [kind]);

  return {
    search,
    setSearch,
    kind,
    /** Đổi nhóm thì bỏ phân loại đang lọc (phân loại riêng cho hàng hoá, dịch vụ). */
    setKind: (next: string) => {
      setKindState(next);
      setTradeCategory('');
    },
    tradeCategory,
    setTradeCategory,
    tradeCategories,
    items,
    loading,
    error,
    page,
    /** Số trang đã biết (trang cuối có thể còn trang sau khi mở tới). */
    pageCount: starts.length,
    goTo: (target: number) => {
      if (target < 1 || target > starts.length || target === page || loading) return;
      load(target, starts[target - 1]);
    },
  };
}

/** Ô tìm và lọc nhóm đặt trên bảng mặt hàng. */
export function CatalogSearchBar({ catalog }: { catalog: ReturnType<typeof useCatalogSearch> }) {
  return (
    <div className={styles.toolbar}>
      <input
        className={styles.input}
        type="search"
        placeholder="Tìm theo mã, tên hoặc phân loại…"
        maxLength={100}
        value={catalog.search}
        onChange={(event) => catalog.setSearch(event.target.value)}
        style={{ flex: '1 1 260px' }}
      />
      <div style={{ flex: '0 0 160px' }}>
        <SearchableSelect options={KIND_OPTIONS} value={catalog.kind} placeholder="Mọi nhóm" clearable onChange={(next) => catalog.setKind(next)} name="kind" />
      </div>
      <div style={{ flex: '0 0 200px' }}>
        <SearchableSelect
          options={catalog.tradeCategories.map((name) => ({ value: name, label: name }))}
          value={catalog.tradeCategory}
          placeholder="Mọi phân loại"
          emptyText="Chưa có phân loại"
          clearable
          onChange={(next) => catalog.setTradeCategory(next)}
          name="tradeCategory"
        />
      </div>
    </div>
  );
}

/** Thanh trang dưới bảng: Trước, 1 2 3 (các trang đã biết), Sau. */
export function CatalogPager({ catalog }: { catalog: ReturnType<typeof useCatalogSearch> }) {
  const { page, pageCount, loading, goTo } = catalog;
  if (pageCount <= 1) return null;
  return (
    <nav className={styles.pager} aria-label="Phân trang mặt hàng">
      <span>Trang {page}</span>
      <span className={styles.pagerButtons}>
        <button type="button" className={styles.pagerButton} disabled={page <= 1 || loading} aria-label="Trang trước" onClick={() => goTo(page - 1)}>
          ‹ Trước
        </button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
          <button
            key={item}
            type="button"
            className={item === page ? styles.pagerCurrent : styles.pagerButton}
            aria-current={item === page ? 'page' : undefined}
            disabled={loading && item !== page}
            onClick={() => goTo(item)}
          >
            {item}
          </button>
        ))}
        <button type="button" className={styles.pagerButton} disabled={page >= pageCount || loading} aria-label="Trang sau" onClick={() => goTo(page + 1)}>
          Sau ›
        </button>
      </span>
    </nav>
  );
}
