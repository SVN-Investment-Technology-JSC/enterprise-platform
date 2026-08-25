'use client';

import { useCallback, useEffect, useState } from 'react';

export interface HashViewOptions<TViewId extends string> {
  readonly views: readonly TViewId[];
  readonly fallback: TViewId;
  /** Hash cũ cần tiếp tục phân giải được, để link đã chia sẻ không vỡ. */
  readonly legacy?: Readonly<Record<string, TViewId>>;
}

export interface HashView<TViewId extends string> {
  readonly view: TViewId;
  /** Đoạn hash thứ hai, ví dụ `#settings/dashboard` cho ra `dashboard`. */
  readonly sub: string | undefined;
  readonly navigate: (view: TViewId, sub?: string) => void;
}

/**
 * Điều hướng trong module bằng hash, không sinh route Next mới.
 *
 * Ba điểm phải giữ đúng:
 *  - Giá trị khởi tạo **không** đọc `window`, nếu không server và client render
 *    khác nhau và React sẽ báo lệch hydration. Hash chỉ được đọc trong effect.
 *  - Có lắng nghe `hashchange`, nên nút back/forward của trình duyệt hoạt động.
 *  - Hash là nguồn sự thật duy nhất: `navigate` ghi hash, effect đọc hash ra
 *    state. Không giữ song song một state riêng rồi đồng bộ hai chiều.
 */
export function useHashView<TViewId extends string>(
  options: HashViewOptions<TViewId>,
): HashView<TViewId> {
  const { views, fallback, legacy } = options;
  const [view, setView] = useState<TViewId>(fallback);
  const [sub, setSub] = useState<string>();

  const resolve = useCallback(() => {
    if (typeof window === 'undefined') return;
    const raw = window.location.hash.slice(1);
    const separator = raw.indexOf('/');
    const head = separator < 0 ? raw : raw.slice(0, separator);
    const tail = separator < 0 ? undefined : raw.slice(separator + 1);
    const matched = views.find((candidate) => candidate === head);
    setView(matched ?? legacy?.[head] ?? fallback);
    setSub(tail || undefined);
  }, [views, fallback, legacy]);

  useEffect(() => {
    resolve();
    window.addEventListener('hashchange', resolve);
    return () => window.removeEventListener('hashchange', resolve);
  }, [resolve]);

  const navigate = useCallback((next: TViewId, nextSub?: string) => {
    if (typeof window === 'undefined') return;
    window.location.hash = nextSub ? `${next}/${nextSub}` : next;
  }, []);

  return { view, sub, navigate };
}
