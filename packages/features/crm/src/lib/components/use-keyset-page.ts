'use client';

import type { CrmPage } from '@enterprise-platform/contracts-crm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../crm-api';

/**
 * Danh sách phân trang keyset: giữ chồng con trỏ để quay lại trang trước.
 * Đổi `key` (bộ lọc) thì về trang 1. `reload` tải lại trang đang xem.
 */
export function useKeysetPage<TItem>(key: string, load: (cursor: string | undefined) => Promise<CrmPage<TItem>>) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [items, setItems] = useState<readonly TItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => setCursors([undefined]), [key]);

  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRef
      .current(cursor)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(undefined);
      })
      .catch((cause) => active && setError(errorMessage(cause, 'Không tải được danh sách.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [cursor, key, version]);

  return {
    items,
    loading,
    error,
    page: cursors.length,
    hasNext: Boolean(nextCursor),
    next: useCallback(() => nextCursor && setCursors((stack) => [...stack, nextCursor]), [nextCursor]),
    previous: useCallback(() => setCursors((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack)), []),
    reload: useCallback(() => setVersion((value) => value + 1), []),
  };
}
