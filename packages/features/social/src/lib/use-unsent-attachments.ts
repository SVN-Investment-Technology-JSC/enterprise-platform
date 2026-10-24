'use client';

import { useEffect, useMemo, useRef } from 'react';

/** Cách bỏ tệp chưa gửi: `discard` thường (chờ được), `discardKeepalive` khi trang đang đóng. */
export interface UnsentAttachmentsDeps {
  readonly discard: (id: string, uploadId?: string) => Promise<unknown> | void;
  readonly discardKeepalive: (id: string, uploadId?: string) => void;
  /** Cửa sổ nhận `beforeunload` và `pagehide`; mặc định `window`. Tiêm được để test. */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface UnsentAttachments {
  /** Server đã cấp tệp (đang tải hoặc đã tải): bắt đầu theo dõi. Id đã bỏ rồi thì bị bỏ qua. */
  track(id: string, uploadId?: string): void;
  /** Ngừng theo dõi mà KHÔNG bỏ tệp: đã gắn vào bài/bình luận, hoặc lần tải đã tự huỷ phía server. */
  forget(ids: string | readonly string[]): void;
  /**
   * Bỏ tệp ngay (không chờ, bỏ qua lỗi) và ngừng theo dõi. Mỗi id chỉ bỏ một lần. Dùng cả cho tệp tải xong
   * sau khi người dùng đã gỡ nó (kết quả về muộn).
   */
  discard(id: string): void;
  /** Bỏ mọi tệp còn theo dõi; `keepalive` khi trang đang đóng. */
  discardAll(mode: 'normal' | 'keepalive'): void;
  /** Còn tệp chưa gửi hay không. */
  has(): boolean;
}

/** Bộ theo dõi thuần (không React): mỗi ô soạn một bản. Tách riêng để test. */
export function createUnsentTracker(deps: UnsentAttachmentsDeps): UnsentAttachments {
  const pending = new Map<string, { uploadId?: string }>();
  /** Id đã bỏ: bảo đảm mỗi id chỉ phát sinh một lần bỏ, kể cả khi `track` đến muộn. */
  const discarded = new Set<string>();
  let listening = false;

  const onBeforeUnload = (event: Event) => {
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  const win = () => deps.target ?? (typeof window === 'undefined' ? undefined : window);
  const sync = () => {
    const want = pending.size > 0;
    if (want === listening) return;
    const target = win();
    if (!target) return;
    if (want) target.addEventListener('beforeunload', onBeforeUnload);
    else target.removeEventListener('beforeunload', onBeforeUnload);
    listening = want;
  };
  const discardOne = (id: string, mode: 'normal' | 'keepalive') => {
    const entry = pending.get(id);
    if (!entry || discarded.has(id)) return;
    discarded.add(id);
    pending.delete(id);
    try {
      if (mode === 'keepalive') deps.discardKeepalive(id, entry.uploadId);
      else void Promise.resolve(deps.discard(id, entry.uploadId)).catch(() => undefined);
    } catch {
      // Bỏ qua lỗi: server sẽ dọn tệp mồ côi theo hạn.
    }
  };

  return {
    track(id, uploadId) {
      if (discarded.has(id)) return;
      pending.set(id, { uploadId });
      sync();
    },
    forget(ids) {
      for (const id of typeof ids === 'string' ? [ids] : ids) pending.delete(id);
      sync();
    },
    discard(id) {
      // Tệp tải xong muộn (người dùng đã gỡ) chưa được theo dõi: vẫn phải bỏ.
      if (!pending.has(id) && !discarded.has(id)) pending.set(id, {});
      discardOne(id, 'normal');
      sync();
    },
    discardAll(mode) {
      for (const id of Array.from(pending.keys())) discardOne(id, mode);
      sync();
    },
    has: () => pending.size > 0,
  };
}

/**
 * Quản lý tập tệp chưa gửi của MỘT ô soạn (mỗi ô một bản riêng):
 * - còn tệp chưa gửi thì đăng ký `beforeunload` (trình duyệt hỏi xác nhận trước khi rời trang);
 * - `pagehide`: bỏ từng tệp bằng `keepalive`, mỗi id một lần;
 * - ô soạn bị gỡ (chuyển trang trong ứng dụng, đóng, huỷ): bỏ các tệp còn lại;
 * - gửi thành công: `forget` các id đã gắn để không bị bỏ nhầm.
 */
export function useUnsentAttachments(deps: UnsentAttachmentsDeps): UnsentAttachments {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const tracker = useMemo(
    () =>
      createUnsentTracker({
        discard: (id, uploadId) => depsRef.current.discard(id, uploadId),
        discardKeepalive: (id, uploadId) => depsRef.current.discardKeepalive(id, uploadId),
        get target() {
          return depsRef.current.target;
        },
      }),
    [],
  );

  useEffect(() => {
    const win = depsRef.current.target ?? window;
    const onPageHide = () => tracker.discardAll('keepalive');
    win.addEventListener('pagehide', onPageHide);
    return () => {
      win.removeEventListener('pagehide', onPageHide);
      tracker.discardAll('normal');
    };
  }, [tracker]);

  return tracker;
}
