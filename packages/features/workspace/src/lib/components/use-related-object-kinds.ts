'use client';

import type { RelatedObjectKind } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';

/**
 * Loại hồ sơ gắn được ("Đối tượng liên quan"), một lần tải cho cả trang.
 *
 * Form dự án, form công việc (mỗi việc một khối) và tab Liên quan cùng cần danh sách này; nó chỉ đổi khi công ty bật
 * hay tắt module, nên giữ ở cấp module một lúc. Lỗi thì coi như không có loại nào (khối bị ẩn, không báo lỗi) và không
 * giữ lại, để lần mở sau hỏi lại.
 */
const KINDS_TTL_MS = 60_000;
let cached: { readonly at: number; readonly kinds: readonly RelatedObjectKind[] } | undefined;
let pending: Promise<readonly RelatedObjectKind[]> | undefined;

function loadKinds(): Promise<readonly RelatedObjectKind[]> {
  if (cached && Date.now() - cached.at < KINDS_TTL_MS) return Promise.resolve(cached.kinds);
  pending ??= api
    .listRelatedObjectKinds()
    .then((result) => {
      // Giữ đúng thứ tự server trả: server đã xếp loại theo thứ tự nên hiện.
      const kinds = result.kinds ?? [];
      cached = { at: Date.now(), kinds };
      return kinds;
    })
    .catch(() => [] as readonly RelatedObjectKind[])
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export interface RelatedObjectKindsView {
  readonly kinds: readonly RelatedObjectKind[];
  /** Đã có kết quả (kể cả rỗng); trước đó danh sách rỗng chưa có nghĩa gì. */
  readonly loaded: boolean;
}

/** `enabled = false` (vd form đang đóng) thì không hỏi server. */
export function useRelatedObjectKinds(enabled = true): RelatedObjectKindsView {
  const [view, setView] = useState<RelatedObjectKindsView>(() =>
    cached ? { kinds: cached.kinds, loaded: true } : { kinds: [], loaded: false },
  );

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadKinds().then((kinds) => {
      if (alive) setView({ kinds, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return view;
}
