'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  RealtimeEventEnvelope,
  WorkspaceChatSignal,
} from '@enterprise-platform/contracts-realtime';

// Tái xuất để các màn hình dùng bus không phải thêm phụ thuộc vào contracts-realtime.
export type { RealtimeEventEnvelope, WorkspaceChatSignal };

/**
 * Cầu nối sự kiện realtime cho mọi màn hình.
 *
 * Trình duyệt chỉ giữ MỘT kết nối socket (do trung tâm thông báo mở). Màn hình
 * nào cần sự kiện riêng (chat dự án, ...) đăng ký ở đây thay vì tự mở thêm một
 * kết nối. Không có trung tâm thông báo trên trang thì không có sự kiện nào đến,
 * và mọi nơi dùng vẫn phải có đường tải lại dự phòng.
 */
type EventListener = (event: RealtimeEventEnvelope) => void;
type StatusListener = (connected: boolean) => void;

const eventListeners = new Set<EventListener>();
const statusListeners = new Set<StatusListener>();

export function publishRealtimeEvent(event: RealtimeEventEnvelope): void {
  for (const listener of [...eventListeners]) {
    try {
      listener(event);
    } catch {
      // Một người nghe lỗi không được chặn những người còn lại.
    }
  }
}

// `undefined` = chưa có kết nối nào được thử (hoặc trang không có trung tâm thông báo).
let currentStatus: boolean | undefined;

export function getRealtimeStatus(): boolean | undefined {
  return currentStatus;
}

/** `connected = true` được phát cả lúc nối lại, để người nghe tải bù phần đã lỡ. */
export function publishRealtimeStatus(connected: boolean): void {
  currentStatus = connected;
  for (const listener of [...statusListeners]) {
    try {
      listener(connected);
    } catch {
      // như trên
    }
  }
}

export function subscribeRealtime(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function subscribeRealtimeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/**
 * Trạng thái kết nối realtime để hiện cho người dùng: `true` đang nối,
 * `false` đã mất kết nối, `undefined` chưa nối được lần nào.
 */
export function useRealtimeStatus(): boolean | undefined {
  return useSyncExternalStore(
    (onChange) => subscribeRealtimeStatus(() => onChange()),
    getRealtimeStatus,
    () => undefined,
  );
}

/**
 * Nghe sự kiện realtime theo tên, và (tuỳ chọn) biến động kết nối.
 * Hàm xử lý luôn là bản mới nhất mà không cần đăng ký lại mỗi lần render.
 */
export function useRealtimeEvent(
  eventName: RealtimeEventEnvelope['event'],
  onEvent: EventListener,
  onStatus?: StatusListener,
): void {
  const eventRef = useRef(onEvent);
  const statusRef = useRef(onStatus);
  eventRef.current = onEvent;
  statusRef.current = onStatus;
  useEffect(() => {
    const offEvent = subscribeRealtime((event) => {
      if (event.event === eventName) eventRef.current(event);
    });
    const offStatus = subscribeRealtimeStatus((connected) => statusRef.current?.(connected));
    return () => {
      offEvent();
      offStatus();
    };
  }, [eventName]);
}
