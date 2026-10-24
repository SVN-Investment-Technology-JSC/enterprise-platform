'use client';

import { useSyncExternalStore } from 'react';

/**
 * Thông báo Windows (thông báo của hệ điều hành qua Notification API của trình duyệt) và âm báo cho tin mới.
 * Nhiều tab cùng mở chỉ một tab hiện thông báo cho mỗi tin: tab giành được khoá theo id tin mới hiện.
 */

export type DesktopPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export interface ChatSettings {
  /** Hiện thông báo Windows khi có tin mới (cần trình duyệt cho phép). */
  readonly desktop: boolean;
  /** Phát âm báo khi có tin mới. */
  readonly sound: boolean;
}

const SETTINGS_KEY = 'ep-chat-settings';
const NOTIFIED_PREFIX = 'ep-chat-notified:';
const DEFAULT_SETTINGS: ChatSettings = { desktop: true, sound: true };

let settings: ChatSettings = readSettings();
let permission: DesktopPermission = readPermission();
const listeners = new Set<() => void>();

function readSettings(): ChatSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    return {
      desktop: typeof parsed.desktop === 'boolean' ? parsed.desktop : DEFAULT_SETTINGS.desktop,
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_SETTINGS.sound,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readPermission(): DesktopPermission {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
  return window.Notification.permission as DesktopPermission;
}

function publish(): void {
  for (const listener of [...listeners]) listener();
}

export function updateChatSettings(patch: Partial<ChatSettings>): void {
  settings = { ...settings, ...patch };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Trình duyệt chặn bộ nhớ cục bộ: vẫn áp dụng trong phiên này.
  }
  publish();
}

/** Xin quyền hiện thông báo; phải gọi từ một thao tác của người dùng (bấm nút). */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (readPermission() === 'unsupported') return 'unsupported';
  try {
    permission = (await window.Notification.requestPermission()) as DesktopPermission;
  } catch {
    permission = readPermission();
  }
  if (permission === 'granted' && !settings.desktop) updateChatSettings({ desktop: true });
  publish();
  return permission;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useChatSettings(): { readonly settings: ChatSettings; readonly permission: DesktopPermission } {
  const current = useSyncExternalStore(subscribe, () => settings, () => DEFAULT_SETTINGS);
  const currentPermission = useSyncExternalStore(subscribe, () => permission, () => 'unsupported' as DesktopPermission);
  return { settings: current, permission: currentPermission };
}

/** Quyền có thể đổi ngoài trang (người dùng đổi trong cài đặt trình duyệt): đọc lại khi cửa sổ được mở lại. */
export function refreshDesktopPermission(): void {
  const next = readPermission();
  if (next !== permission) {
    permission = next;
    publish();
  }
}

interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void> | void): Promise<void>;
}

/**
 * Chạy `work` đúng một lần cho mỗi `id` giữa các tab: tab nào giành được khoá trước thì đánh dấu đã báo và chạy.
 * Trình duyệt không có Web Locks thì dựa vào dấu trong bộ nhớ cục bộ (đủ tốt khi các tab không trùng mili giây).
 */
async function oncePerTabs(id: string, work: () => void): Promise<void> {
  const key = `${NOTIFIED_PREFIX}${id}`;
  const claim = () => {
    try {
      if (window.localStorage.getItem(key)) return false;
      window.localStorage.setItem(key, String(Date.now()));
      pruneMarks();
    } catch {
      // Không có bộ nhớ cục bộ: vẫn báo (thà trùng còn hơn mất).
    }
    return true;
  };
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  if (locks?.request) {
    await locks.request(key, { ifAvailable: true }, (lock) => {
      if (lock && claim()) work();
    });
    return;
  }
  if (claim()) work();
}

function pruneMarks(): void {
  const cutoff = Date.now() - 10 * 60_000;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(NOTIFIED_PREFIX)) continue;
    if (Number(window.localStorage.getItem(key)) < cutoff) window.localStorage.removeItem(key);
  }
}

export interface ChatNotice {
  /** Id tin nhắn: một tin chỉ báo một lần dù mở nhiều tab. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly icon?: string;
  readonly onClick?: () => void;
  /** Báo ngay trong trang (toast) khi người dùng đang nhìn trang này. */
  readonly inApp?: () => void;
}

export type ChatNoticeChannel = 'in-app' | 'desktop' | 'none';

/** Người dùng đang nhìn đúng tab này: tab đang hiện và cửa sổ trình duyệt đang được chọn. */
export function isLookingAtPage(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
}

/** Tab đang xem giành quyền báo trước; tab nền chờ một chút để không tranh với nó. */
const BACKGROUND_TAB_DELAY_MS = 400;

/**
 * Báo một tin mới cho người dùng, mỗi tin đúng một lần dù mở nhiều tab:
 * - đang nhìn trang: toast ngay trong trang (không cần quyền của trình duyệt) và âm báo;
 * - không nhìn trang (tab nền, thu nhỏ, đang dùng ứng dụng khác): thông báo Windows nếu được phép, không thì vẫn để
 *   toast chờ sẵn trong trang; kèm âm báo và tiêu đề tab nhấp nháy.
 */
export async function notifyChat(notice: ChatNotice): Promise<ChatNoticeChannel> {
  if (typeof window === 'undefined') return 'none';
  const looking = isLookingAtPage();
  if (!looking) {
    flashTitle(notice.title);
    await new Promise((resolve) => setTimeout(resolve, BACKGROUND_TAB_DELAY_MS));
  }
  let channel: ChatNoticeChannel = 'none';
  await oncePerTabs(notice.id, () => {
    if (settings.sound) playChime();
    if (!looking && settings.desktop && readPermission() === 'granted' && showDesktop(notice)) {
      channel = 'desktop';
      return;
    }
    if (notice.inApp) {
      notice.inApp();
      channel = 'in-app';
    }
  });
  return channel;
}

function showDesktop(notice: ChatNotice): boolean {
  try {
    const notification = new window.Notification(notice.title, {
      body: notice.body,
      icon: notice.icon ?? '/brand-logo.jpg',
      tag: `ep-chat:${notice.id}`,
    });
    notification.onclick = () => {
      window.focus();
      notice.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    // Một số trình duyệt chỉ cho tạo thông báo qua service worker: báo trong trang thay thế.
    return false;
  }
}

let flashTimer: ReturnType<typeof setInterval> | undefined;
let stopFlash: (() => void) | undefined;

/**
 * Tiêu đề tab nhấp nháy giữa "Tên người gửi: tin mới" và tiêu đề trang, tới khi người dùng quay lại trang. Tiêu đề
 * trang đổi trong lúc nhấp nháy (chuyển trang) thì lấy tiêu đề mới làm gốc.
 */
export function flashTitle(text: string): void {
  if (typeof document === 'undefined') return;
  stopFlash?.();
  const message = `Tin nhắn mới · ${text}`;
  let base = document.title;
  let on = false;
  const tick = () => {
    if (document.title !== message) base = document.title;
    on = !on;
    document.title = on ? message : base;
  };
  tick();
  flashTimer = setInterval(tick, 1_500);
  const stop = () => {
    if (flashTimer) clearInterval(flashTimer);
    flashTimer = undefined;
    if (document.title === message) document.title = base;
    window.removeEventListener('focus', stop);
    document.removeEventListener('visibilitychange', onVisible);
    stopFlash = undefined;
  };
  const onVisible = () => {
    if (isLookingAtPage()) stop();
  };
  window.addEventListener('focus', stop);
  document.addEventListener('visibilitychange', onVisible);
  stopFlash = stop;
}

let audio: AudioContext | undefined;

/** Hai nốt ngắn, nhỏ; tạo bằng Web Audio nên không cần tệp âm thanh. */
export function playChime(): void {
  try {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    const start = audio.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.12, 1320],
    ] as const) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.08, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.2);
    }
  } catch {
    // Trình duyệt chặn phát âm thanh khi chưa có thao tác nào: bỏ qua.
  }
}

/** Dùng trong test. */
export function resetChatSettingsForTest(next: Partial<ChatSettings> = {}): void {
  settings = { ...DEFAULT_SETTINGS, ...next };
  permission = readPermission();
  publish();
}
