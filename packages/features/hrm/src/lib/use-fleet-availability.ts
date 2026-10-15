'use client';

import { useEffect, useState } from 'react';
import type { HrmFleetAvailability } from '@enterprise-platform/contracts-hrm';
import type { TransportAvailability, TransportRange } from '@enterprise-platform/shared-ui';
import { hrmFetch } from './hrm-api';

/** Chờ người dùng gõ xong giờ rồi mới hỏi xe trống, tránh gọi API sau mỗi phím. */
const DEBOUNCE_MS = 300;

/** Khung giờ hợp lệ để hỏi lịch xe: có đủ hai đầu và giờ về sau giờ đi. */
export function validFleetRange(range: TransportRange | null): range is TransportRange {
  return Boolean(range && range.startAt && range.endAt && Date.parse(range.endAt) > Date.parse(range.startAt));
}

/**
 * Xe và tài xế đang hoạt động kèm khoảng bận quanh khung giờ [startAt, endAt]. Chỉ gọi khi `enabled`
 * (người dùng đã chọn Xe công ty) và khung giờ hợp lệ.
 */
export function useFleetAvailability(range: TransportRange | null, enabled: boolean) {
  const [availability, setAvailability] = useState<TransportAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startAt = range?.startAt ?? '';
  const endAt = range?.endAt ?? '';
  const ready = enabled && validFleetRange(range);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      hrmFetch<{ data: HrmFleetAvailability }>(
        `/fleet/availability?from=${encodeURIComponent(startAt)}&to=${encodeURIComponent(endAt)}`,
      )
        .then((result) => {
          if (cancelled) return;
          setAvailability(result.data);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được danh sách xe.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, startAt, endAt]);

  return { availability, loading: ready && loading, error: ready ? error : null };
}
