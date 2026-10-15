'use client';
import { createContext, useContext, useEffect } from 'react';

/** Setter các bậc breadcrumb thêm sau tên trang; do khung Tài chính cung cấp. */
const FinanceCrumbsContext = createContext<((crumbs: readonly string[]) => void) | null>(null);
export const FinanceCrumbsProvider = FinanceCrumbsContext.Provider;

/** Đặt các bậc breadcrumb thêm vào cuối đường dẫn ("Tài chính › Phiếu thu › PT-2610-0001"); tự gỡ khi màn hình đóng. */
export function useFinanceCrumbs(crumbs: readonly string[]) {
  const set = useContext(FinanceCrumbsContext);
  const key = crumbs.join('\u0001');
  useEffect(() => {
    set?.(key ? key.split('\u0001') : []);
    return () => set?.([]);
  }, [set, key]);
}
