import { useSyncExternalStore } from 'react';

/**
 * Theo dõi một media query. `serverValue` là giá trị khi dựng trên máy chủ và khi môi trường không có `matchMedia`
 * (ví dụ jsdom); ở trình duyệt thì giá trị thật được áp dụng ngay sau khi hydrate.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : serverValue),
    () => serverValue,
  );
}
