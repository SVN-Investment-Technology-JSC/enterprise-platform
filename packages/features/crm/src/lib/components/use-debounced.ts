'use client';

import { useEffect, useState } from 'react';

/** Giá trị trễ `delay` ms sau lần đổi cuối (ô tìm kiếm không gọi API mỗi phím). */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
