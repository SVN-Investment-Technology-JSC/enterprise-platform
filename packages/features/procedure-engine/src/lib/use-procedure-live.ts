'use client';

import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import {
  retainProcedureRoom,
  subscribeRealtime,
  subscribeRealtimeStatus,
  type ProcedureInstanceSignal,
} from '@enterprise-platform/shared-ui';
import { useEffect, useRef } from 'react';

/** Nhịp hỏi lại dự phòng khi tab đang hiện: máy dev không có realtime, và phòng có thể chưa vào được. */
export const PROCEDURE_LIVE_POLL_MS = 30_000;
/** Gom các tín hiệu dồn dập (duyệt liền mấy bước, bước Tài chính tự chạy) thành một lần tải. */
export const PROCEDURE_LIVE_DEBOUNCE_MS = 400;
/** `focus` và `visibilitychange` thường đến cùng lúc khi quay lại tab: chỉ tải một lần. */
export const PROCEDURE_LIVE_MIN_GAP_MS = 2_000;

export interface ProcedureLiveOptions {
  /** Hồ sơ đang mở chi tiết: vào phòng realtime của nó (có đếm, dùng chung với tab Trao đổi). */
  readonly roomInstanceId?: string;
  /**
   * Hồ sơ nào cần làm mới khi có tín hiệu. Mặc định chỉ `roomInstanceId`. Màn có danh sách truyền "hồ sơ đang có
   * trong danh sách" để tín hiệu từ phòng mà nơi khác đã vào (tab Trao đổi) cũng cập nhật được dòng của nó.
   */
  readonly watches?: (instanceId: string) => boolean;
  /** Tải lại đúng một hồ sơ vừa có tín hiệu. */
  readonly onSignal: (instanceId: string) => unknown;
  /** Tải lại dự phòng: khi quay lại tab, khi nối lại realtime và theo nhịp lúc tab đang hiện. */
  readonly onPoll: () => unknown;
  /** Đang chạy thao tác của chính người dùng (thao tác tự nạp lại sau đó): không tải chen vào. */
  readonly paused?: boolean;
  readonly pollMs?: number;
  readonly debounceMs?: number;
}

/**
 * Giữ hồ sơ đang mở luôn mới khi người khác duyệt, trả về, hoàn duyệt, huỷ... hay bước Tài chính đổi.
 *
 * Hai đường, đường sau là dự phòng của đường trước:
 * - Tín hiệu `procedure.instance.changed` (chỉ mang id) trong phòng của hồ sơ: gom lại rồi gọi `onSignal`.
 * - Khi tab hiện lại / cửa sổ được focus, khi realtime nối lại, và mỗi `pollMs` lúc tab đang hiện: gọi `onPoll`.
 *
 * Không tải khi tab ở nền (tín hiệu đến lúc đó được bù bằng lần tải khi tab hiện lại) và khi `paused`. Chỉ đọc qua
 * API có kiểm quyền nên không thể tự gây vòng lặp: tải lại không ghi gì, không sinh tín hiệu mới.
 */
export function useProcedureLive(options: ProcedureLiveOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const { roomInstanceId } = options;
  const pollMs = options.pollMs ?? PROCEDURE_LIVE_POLL_MS;
  const debounceMs = options.debounceMs ?? PROCEDURE_LIVE_DEBOUNCE_MS;

  useEffect(() => {
    if (!roomInstanceId) return undefined;
    return retainProcedureRoom(roomInstanceId);
  }, [roomInstanceId]);

  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPoll = Date.now();
    let polling = false;
    const hidden = () => document.visibilityState === 'hidden';

    const watched = (instanceId: string) => {
      const { watches, roomInstanceId: room } = latest.current;
      return watches ? watches(instanceId) : instanceId === room;
    };

    const flush = () => {
      timer = undefined;
      if (hidden()) return;
      const ids = [...pending];
      pending.clear();
      // Thao tác của chính người dùng đang chạy sẽ tự nạp lại sau khi xong.
      if (latest.current.paused) return;
      for (const id of ids) void Promise.resolve().then(() => latest.current.onSignal(id)).catch(() => undefined);
    };

    const poll = () => {
      if (hidden() || latest.current.paused || polling) return;
      const now = Date.now();
      if (now - lastPoll < PROCEDURE_LIVE_MIN_GAP_MS) return;
      lastPoll = now;
      // Lần tải đầy đủ đã bao cả các hồ sơ đang chờ tín hiệu.
      pending.clear();
      clearTimeout(timer);
      timer = undefined;
      polling = true;
      void Promise.resolve()
        .then(() => latest.current.onPoll())
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    };

    const offEvent = subscribeRealtime((event) => {
      if (event.event !== 'procedure.instance.changed') return;
      const instanceId = (event.data as Partial<ProcedureInstanceSignal> | undefined)?.instanceId;
      if (typeof instanceId !== 'string' || !watched(instanceId)) return;
      pending.add(instanceId);
      // Tab ở nền: giữ lại, lần tải khi tab hiện lại sẽ bao luôn.
      if (hidden()) return;
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
    // Nối lại: có thể đã lỡ tín hiệu trong lúc mất mạng (bus đã tự xin vào lại phòng).
    const offStatus = subscribeRealtimeStatus((connected) => {
      if (connected) poll();
    });
    const onVisible = () => {
      if (!hidden()) poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const interval = setInterval(poll, pollMs);
    return () => {
      offEvent();
      offStatus();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [pollMs, debounceMs]);
}

/** Cùng nội dung thì giữ object cũ: bảng không vẽ lại và các `useMemo` theo hồ sơ không tính lại vô ích. */
export function sameInstance(left: ProcedureInstance | undefined, right: ProcedureInstance): boolean {
  return left === right || (left !== undefined && JSON.stringify(left) === JSON.stringify(right));
}

/**
 * Ghép danh sách vừa tải vào danh sách đang hiện: hồ sơ không đổi giữ nguyên object, không có gì đổi thì trả lại
 * chính mảng cũ (người gọi bỏ qua việc cập nhật state).
 */
export function mergeInstances(
  current: readonly ProcedureInstance[],
  fresh: readonly ProcedureInstance[],
): ProcedureInstance[] {
  const previous = new Map(current.map((instance) => [instance.id, instance]));
  let unchanged = current.length === fresh.length;
  const merged = fresh.map((instance, index) => {
    const old = previous.get(instance.id);
    const kept = old && sameInstance(old, instance) ? old : instance;
    if (kept !== current[index]) unchanged = false;
    return kept;
  });
  return unchanged ? (current as ProcedureInstance[]) : merged;
}
