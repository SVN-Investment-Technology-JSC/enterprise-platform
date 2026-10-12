'use client';
import { createContext, useContext, useEffect } from 'react';

/** Setter các bậc breadcrumb thêm sau tên trang; do khung HRM cung cấp. */
const HrmCrumbsContext = createContext<((crumbs: readonly string[]) => void) | null>(null);
export const HrmCrumbsProvider = HrmCrumbsContext.Provider;

/**
 * Đặt các bậc breadcrumb thêm vào cuối đường dẫn của khung ("Nhân sự › Cấu hình › Đơn từ & phê duyệt › Loại đơn & lý do");
 * tự gỡ khi màn hình đóng. Ngoài khung HRM (ví dụ trong test) thì không làm gì.
 */
export function useHrmCrumbs(crumbs: readonly string[]) {
  const set = useContext(HrmCrumbsContext);
  const key = crumbs.join('\u0001');
  useEffect(() => {
    set?.(key ? key.split('\u0001') : []);
    return () => set?.([]);
  }, [set, key]);
}
