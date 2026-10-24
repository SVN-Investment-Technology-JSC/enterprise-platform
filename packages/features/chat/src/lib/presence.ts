'use client';

import type { PresenceSignal } from '@enterprise-platform/contracts-realtime';
import { subscribeRealtime, subscribeRealtimeStatus } from '@enterprise-platform/shared-ui';
import { useEffect, useSyncExternalStore } from 'react';
import { chatApi } from './chat-api';

/**
 * Trạng thái trực tuyến của mọi người trong công ty: ảnh chụp từ realtime-api lúc bắt đầu dùng và mỗi lần nối lại,
 * cộng tín hiệu `core.presence.changed` khi có người vào hoặc rời mạng. Làm mới định kỳ để sửa chỗ lỡ tín hiệu
 * (replica mất đột ngột không kịp báo ngoại tuyến).
 */
interface PresenceState {
  readonly online: ReadonlySet<string>;
  readonly lastSeen: ReadonlyMap<string, string>;
}

const REFRESH_MS = 60_000;
const EMPTY: PresenceState = { online: new Set(), lastSeen: new Map() };

let state: PresenceState = EMPTY;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let offEvents: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(next: PresenceState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

async function refresh(): Promise<void> {
  try {
    const snapshot = await chatApi.presence();
    if (!Array.isArray(snapshot?.online)) return;
    publish({
      online: new Set(snapshot.online.map((id) => id.toLowerCase())),
      lastSeen: new Map(Object.entries(snapshot.lastSeen ?? {}).map(([id, at]) => [id.toLowerCase(), at])),
    });
  } catch {
    // Giữ trạng thái cũ; lần làm mới sau thử lại.
  }
}

/** Áp một tín hiệu vào trạng thái (tách ra để kiểm thử). */
export function applyPresenceSignal(current: PresenceState, signal: PresenceSignal): PresenceState {
  const id = signal.userId.toLowerCase();
  const online = new Set(current.online);
  const lastSeen = new Map(current.lastSeen);
  if (signal.online) {
    online.add(id);
    lastSeen.delete(id);
  } else {
    online.delete(id);
    if (signal.lastSeenAt) lastSeen.set(id, signal.lastSeenAt);
  }
  return { online, lastSeen };
}

function start(): void {
  void refresh();
  timer = setInterval(() => void refresh(), REFRESH_MS);
  const offEvent = subscribeRealtime((event) => {
    if (event.event !== 'core.presence.changed') return;
    publish(applyPresenceSignal(state, event.data as PresenceSignal));
  });
  const offStatus = subscribeRealtimeStatus((connected) => {
    if (connected) void refresh();
  });
  offEvents = () => {
    offEvent();
    offStatus();
  };
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  offEvents?.();
  offEvents = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bắt đầu theo dõi trạng thái trực tuyến khi có ít nhất một nơi dùng; dừng khi không còn ai. */
export function usePresence(): PresenceState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    users += 1;
    if (users === 1) start();
    return () => {
      users -= 1;
      if (users === 0) stop();
    };
  }, []);
  return snapshot;
}

/** "Hoạt động 5 phút trước", "Hoạt động 2 giờ trước", "Hoạt động hôm qua"... */
export function lastSeenLabel(lastSeenAt: string | undefined, now: Date = new Date()): string {
  if (!lastSeenAt) return 'Ngoại tuyến';
  const minutes = Math.floor((now.getTime() - Date.parse(lastSeenAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'Vừa mới hoạt động';
  if (minutes < 60) return `Hoạt động ${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hoạt động hôm qua';
  if (days < 30) return `Hoạt động ${days} ngày trước`;
  return 'Ngoại tuyến';
}
