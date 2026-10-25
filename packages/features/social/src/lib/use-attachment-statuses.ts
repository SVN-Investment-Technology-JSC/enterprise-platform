'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { useEffect, useRef, useState } from 'react';

export const STATUS_POLL_INITIAL_MS = 3000;
export const STATUS_POLL_MAX_MS = 10_000;
/** Server nhận tối đa 10 id mỗi lần hỏi. */
export const STATUS_MAX_IDS_PER_REQUEST = 10;

/** Chờ trước lần hỏi thứ `attempt` (từ 0): 3 giây, rồi lùi dần (nhân 1,5) tới tối đa 10 giây. */
export function nextStatusPollDelay(attempt: number): number {
  return Math.min(STATUS_POLL_MAX_MS, Math.round(STATUS_POLL_INITIAL_MS * 1.5 ** Math.max(0, attempt)));
}

export type FetchAttachmentStatuses = (ids: readonly string[]) => Promise<readonly SocialAttachment[]>;

const isFinished = (attachment: SocialAttachment) =>
  attachment.processingStatus === 'ready' || attachment.processingStatus === 'failed';

/**
 * Hỏi định kỳ trạng thái xử lý của các video chưa `ready` và trả bản mới nhất theo id.
 * - 3 giây một lần, lùi dần tới 10 giây khi lâu; mỗi lần tối đa 10 id;
 * - id đã `ready` hoặc `failed` thì thôi hỏi; không còn id nào thì dừng hẳn;
 * - tab ẩn thì tạm dừng, hiện lại thì hỏi ngay rồi tiếp tục; unmount thì dọn bộ hẹn giờ;
 * - lỗi mạng lúc hỏi bị bỏ qua (lần sau hỏi lại).
 */
export function useAttachmentStatuses(
  ids: readonly string[],
  fetchStatuses: FetchAttachmentStatuses,
): ReadonlyMap<string, SocialAttachment> {
  const [latest, setLatest] = useState<ReadonlyMap<string, SocialAttachment>>(() => new Map());
  const fetchRef = useRef(fetchStatuses);
  fetchRef.current = fetchStatuses;
  /** Id đã xong: không hỏi lại dù nơi gọi vẫn truyền vào. */
  const finished = useRef(new Set<string>());
  const key = [...new Set(ids)].sort().join(',');

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    if (wanted.every((id) => finished.current.has(id))) return undefined;

    let cancelled = false;
    let inFlight = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const remaining = () => wanted.filter((id) => !finished.current.has(id));

    const schedule = () => {
      clear();
      if (cancelled || isHidden() || remaining().length === 0) return;
      timer = setTimeout(() => void poll(), nextStatusPollDelay(attempt));
      attempt += 1;
    };

    const poll = async () => {
      clear();
      if (cancelled || inFlight || isHidden()) return;
      const todo = remaining();
      if (todo.length === 0) return;
      inFlight = true;
      try {
        const items: SocialAttachment[] = [];
        for (let start = 0; start < todo.length; start += STATUS_MAX_IDS_PER_REQUEST) {
          const page = await fetchRef.current(todo.slice(start, start + STATUS_MAX_IDS_PER_REQUEST));
          items.push(...page);
        }
        if (cancelled) return;
        for (const item of items) if (isFinished(item)) finished.current.add(item.id);
        if (items.length > 0) {
          setLatest((previous) => {
            const next = new Map(previous);
            for (const item of items) next.set(item.id, item);
            return next;
          });
        }
      } catch {
        // Lỗi mạng hoặc server tạm thời: hỏi lại ở lần sau.
      } finally {
        inFlight = false;
      }
      schedule();
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (isHidden()) {
        clear();
        return;
      }
      attempt = 0;
      void poll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key]);

  return latest;
}
