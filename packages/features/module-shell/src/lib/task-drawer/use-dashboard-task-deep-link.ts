'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Hook đồng bộ query params với Universal Task Drawer:
 * Tự động đọc ?task=<id> hoặc ?request=<id> từ thanh địa chỉ trình duyệt
 * khi người dùng bấm vào liên kết từ NotificationBell hoặc tin nhắn Chat.
 */
export function useDashboardTaskDeepLink() {
  const [deepLinkTaskId, setDeepLinkTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readParam = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const taskId =
        searchParams.get('task') ||
        searchParams.get('request') ||
        searchParams.get('task_id');
      setDeepLinkTaskId(taskId);
    };

    readParam();
    window.addEventListener('popstate', readParam);
    return () => window.removeEventListener('popstate', readParam);
  }, []);

  const clearDeepLink = useCallback(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.delete('request');
    url.searchParams.delete('task_id');

    window.history.replaceState({}, '', url.toString());
    setDeepLinkTaskId(null);
  }, []);

  return { deepLinkTaskId, clearDeepLink };
}
