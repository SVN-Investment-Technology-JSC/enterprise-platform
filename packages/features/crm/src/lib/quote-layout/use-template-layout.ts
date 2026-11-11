'use client';

/**
 * Tải bố cục in theo mẫu báo giá (plan 9.1, 9.4; task P3C4-01). Kết quả giữ trong bộ nhớ của phiên (đổi qua lại giữa các
 * mẫu không gọi lại API); mẫu chưa có bố cục hoặc chưa chọn mẫu thì dùng `defaultQuoteLayout()`. Lỗi tải vẫn trả bố cục
 * mặc định để khung xem trước luôn có nội dung, kèm `retry` để tải lại.
 */
import { defaultQuoteLayout, type QuoteLayout } from '@enterprise-platform/contracts-crm';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getQuoteTemplateLayout } from '../crm-api';

export type TemplateLayoutStatus = 'loading' | 'ready' | 'error';

export interface TemplateLayoutState {
  /** Bố cục để dựng: bố cục của mẫu, hoặc bố cục mặc định khi mẫu chưa có, chưa chọn mẫu, đang tải hoặc tải lỗi. */
  readonly layout: QuoteLayout;
  readonly status: TemplateLayoutStatus;
  /** `true` khi `layout` là bố cục thiết kế riêng của mẫu. */
  readonly custom: boolean;
  readonly error?: string;
  readonly retry: () => void;
}

export const TEMPLATE_LAYOUT_LOAD_ERROR = 'Không tải được mẫu. Thử lại.';

/** Bố cục đã tải theo id mẫu (`null`: mẫu chưa có bố cục). Sống hết phiên trình duyệt. */
const cache = new Map<string, QuoteLayout | null>();
/** Yêu cầu đang chạy theo id mẫu: nhiều màn cùng mở một mẫu chỉ gọi API một lần. */
const pending = new Map<string, Promise<QuoteLayout | null>>();

/** Xoá cache (spec; trình thiết kế gọi sau khi lưu bố cục để màn báo giá đọc bản mới). */
export function clearTemplateLayoutCache(templateId?: string): void {
  if (templateId) {
    cache.delete(templateId);
    pending.delete(templateId);
  } else {
    cache.clear();
    pending.clear();
  }
}

function loadLayout(templateId: string): Promise<QuoteLayout | null> {
  const running = pending.get(templateId);
  if (running) return running;
  const next = getQuoteTemplateLayout(templateId)
    .then((result) => {
      cache.set(templateId, result.layout ?? null);
      return result.layout ?? null;
    })
    .finally(() => pending.delete(templateId));
  pending.set(templateId, next);
  return next;
}

/**
 * `hasLayout === false` (biết từ danh sách mẫu) thì dùng ngay bố cục mặc định, không gọi API.
 */
export function useTemplateLayout(templateId: string | null | undefined, hasLayout?: boolean): TemplateLayoutState {
  const id = templateId || '';
  const skip = !id || hasLayout === false;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; layout: QuoteLayout | null } | undefined>(() =>
    id && cache.has(id) ? { id, layout: cache.get(id) ?? null } : undefined,
  );
  const [failed, setFailed] = useState<{ id: string; message: string }>();

  useEffect(() => {
    if (skip) return undefined;
    if (cache.has(id)) {
      setLoaded({ id, layout: cache.get(id) ?? null });
      setFailed(undefined);
      return undefined;
    }
    let active = true;
    setFailed(undefined);
    loadLayout(id)
      .then((layout) => {
        if (!active) return;
        setLoaded({ id, layout });
      })
      .catch(() => {
        if (active) setFailed({ id, message: TEMPLATE_LAYOUT_LOAD_ERROR });
      });
    return () => {
      active = false;
    };
  }, [id, skip, attempt]);

  const retry = useCallback(() => {
    if (id) {
      cache.delete(id);
      pending.delete(id);
    }
    setFailed(undefined);
    setAttempt((value) => value + 1);
  }, [id]);

  const fallback = useMemo(() => defaultQuoteLayout(), []);
  if (skip) return { layout: fallback, status: 'ready', custom: false, retry };
  if (loaded?.id === id) {
    return loaded.layout ? { layout: loaded.layout, status: 'ready', custom: true, retry } : { layout: fallback, status: 'ready', custom: false, retry };
  }
  if (failed?.id === id) return { layout: fallback, status: 'error', custom: false, error: failed.message, retry };
  return { layout: fallback, status: 'loading', custom: false, retry };
}
