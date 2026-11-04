'use client';

import type { CrmPage } from '@enterprise-platform/contracts-crm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../crm-api';
import { pageCountOf } from './pagination.model';

/**
 * Danh sách phân trang theo số trang: API trả `total` nên chọn được trang bất kỳ. Đổi `key` (bộ lọc) thì về trang 1;
 * `reload` tải lại trang đang xem.
 */
export function usePagedList<TItem>(key: string, pageSize: number, load: (page: number) => Promise<CrmPage<TItem>>) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<readonly TItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => setPage(1), [key]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRef
      .current(page)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total ?? result.items.length);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, key, version]);

  return {
    items,
    loading,
    error,
    page,
    total,
    pageSize,
    pageCount: pageCountOf(total, pageSize),
    goTo: useCallback((next: number) => setPage(Math.max(1, next)), []),
    reload: useCallback(() => setVersion((value) => value + 1), []),
  };
}
