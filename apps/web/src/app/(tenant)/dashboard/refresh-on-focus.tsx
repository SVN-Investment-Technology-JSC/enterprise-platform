'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Nạp lại dữ liệu server của trang khi cửa sổ lấy lại focus, để danh sách ứng dụng
 * (ví dụ thẻ HRM) phản ánh việc cấp/thu hồi module mà không cần tải lại tay.
 * Giới hạn tối thiểu 10 giây giữa hai lần để tránh nạp dồn.
 */
export function RefreshOnFocus({ minIntervalMs = 10_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - last < minIntervalMs) return;
      last = Date.now();
      router.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, minIntervalMs]);
  return null;
}
