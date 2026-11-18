'use client';

/**
 * Tổ chức báo giá cho màn lập và sửa báo giá (plan mục 16.4). Danh sách tổ chức đang bật và chi tiết từng tổ chức (có
 * logo) giữ trong bộ nhớ của phiên như `use-template-layout`; màn Cấu hình gọi `clearSalesOrganizationCache` sau khi sửa.
 */
import type { SalesOrganization, SalesOrganizationSummary } from '@enterprise-platform/contracts-crm';
import { useEffect, useState } from 'react';
import { getSalesOrganization, listSalesOrganizations } from '../crm-api';

let listCache: Promise<SalesOrganizationSummary[]> | undefined;
const detailCache = new Map<string, Promise<SalesOrganization>>();

/** Xoá cache (spec; màn Cấu hình gọi sau khi thêm, sửa, tắt, xoá tổ chức). */
export function clearSalesOrganizationCache(): void {
  listCache = undefined;
  detailCache.clear();
}

/** Danh sách tổ chức đang bật (không có logo). Lỗi thì bỏ cache để lần sau tải lại. */
export function loadActiveSalesOrganizations(): Promise<SalesOrganizationSummary[]> {
  if (!listCache) {
    const next = listSalesOrganizations().then((rows) => rows.filter((row) => row.active));
    next.catch(() => {
      if (listCache === next) listCache = undefined;
    });
    listCache = next;
  }
  return listCache;
}

/** Chi tiết một tổ chức (có logo), mỗi id gọi API một lần trong phiên. */
export function loadSalesOrganization(id: string): Promise<SalesOrganization> {
  let running = detailCache.get(id);
  if (!running) {
    running = getSalesOrganization(id);
    const current = running;
    running.catch(() => {
      if (detailCache.get(id) === current) detailCache.delete(id);
    });
    detailCache.set(id, running);
  }
  return running;
}

/** Tổ chức đang bật; `loaded` là đã tải xong (kể cả lỗi: danh sách rỗng, báo giá vẫn lập được). */
export function useSalesOrganizations(): { organizations: readonly SalesOrganizationSummary[]; loaded: boolean } {
  const [state, setState] = useState<{ organizations: readonly SalesOrganizationSummary[]; loaded: boolean }>({ organizations: [], loaded: false });
  useEffect(() => {
    let active = true;
    loadActiveSalesOrganizations()
      .then((organizations) => active && setState({ organizations, loaded: true }))
      .catch(() => active && setState({ organizations: [], loaded: true }));
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/** Chi tiết tổ chức theo id (xem trước cần logo); rỗng khi chưa chọn, đang tải hoặc tải lỗi. */
export function useSalesOrganization(id: string | null | undefined): SalesOrganization | undefined {
  const [loaded, setLoaded] = useState<SalesOrganization>();
  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    loadSalesOrganization(id)
      .then((organization) => active && setLoaded(organization))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);
  return id && loaded?.id === id ? loaded : undefined;
}
