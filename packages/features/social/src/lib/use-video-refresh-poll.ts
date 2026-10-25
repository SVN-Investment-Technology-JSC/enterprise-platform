'use client';

import { useEffect, useRef } from 'react';

export const VIDEO_REFRESH_INITIAL_MS = 8000;
export const VIDEO_REFRESH_MAX_MS = 30_000;
/** Quá khoảng này mà video vẫn chưa xong thì thôi tự làm mới (người xem tải lại trang sẽ thấy kết quả). */
export const VIDEO_REFRESH_TOTAL_MS = 30 * 60 * 1000;

/** Chờ trước lần làm mới thứ `attempt` (từ 0): 8 giây, lùi dần (nhân 1,5) tới tối đa 30 giây. */
export function nextVideoRefreshDelay(attempt: number): number {
  return Math.min(VIDEO_REFRESH_MAX_MS, Math.round(VIDEO_REFRESH_INITIAL_MS * 1.5 ** Math.max(0, attempt)));
}

/** `silent`: lần làm mới nền định kỳ, nơi nhận không nên báo lỗi mỗi lần thất bại. */
export type VideoRefresh = (options?: { readonly silent?: boolean }) => void | Promise<void>;

/**
 * Khi `active` (video đang chờ hoặc đang chuyển mã), gọi `refresh` định kỳ để cha tải lại dữ liệu và lấy URL khi xong.
 * - lùi dần 8 giây tới 30 giây; ngừng sau khoảng 30 phút;
 * - không gọi chồng: chờ lần trước xong mới hẹn lần sau;
 * - tab ẩn thì tạm dừng; hiện lại thì gọi ngay rồi tiếp tục;
 * - `active` đổi (video xong) hoặc unmount thì dọn bộ hẹn giờ.
 */
export function useVideoRefreshPoll(active: boolean, refresh: VideoRefresh | undefined): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const enabled = active && refresh !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let stopped = false;
    let inFlight = false;
    let attempt = 0;
    let waited = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const schedule = () => {
      clear();
      if (cancelled || stopped || isHidden()) return;
      const delay = nextVideoRefreshDelay(attempt);
      if (waited + delay > VIDEO_REFRESH_TOTAL_MS) {
        stopped = true;
        return;
      }
      attempt += 1;
      waited += delay;
      timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      clear();
      if (cancelled || stopped || inFlight || isHidden()) return;
      inFlight = true;
      try {
        await refreshRef.current?.({ silent: true });
      } catch {
        // Lỗi mạng tạm thời: lần sau thử lại.
      } finally {
        inFlight = false;
      }
      schedule();
    };

    const onVisibility = () => {
      if (cancelled || stopped) return;
      if (isHidden()) clear();
      else void tick();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
