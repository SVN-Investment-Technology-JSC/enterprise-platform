'use client';

import { ASSISTANT_MESSAGE, isAssistantFrameMessage } from '@enterprise-platform/contracts-assistant';
import { authFetch } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dispatchAssistantAction,
  readAssistantHandoff,
  resumeAssistantAction,
  setAssistantResultSink,
} from './assistant-actions';
import styles from './assistant-launcher.module.scss';
import { ASSISTANT_MODULE_KEY } from './launcher-only-modules';

/** Giao diện chat (savina-agent) mà gateway chuyển về; `embed=1` là bản gọn cho ngăn bên phải. */
const ASSISTANT_URL = '/modules/assistant/';
const OPEN_EVENT = 'savina-assistant:open';

/** Mở ngăn Trợ lý của khung chung (ví dụ từ nút "Truy cập" ở trang Ứng dụng phân hệ). */
export function openAssistant(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface CatalogEntry {
  readonly key: string;
  readonly entitlementStatus: string;
}

/** Danh mục chỉ tải một lần cho cả trang: khung render lại không gọi lại API. */
let assistantEnabled: Promise<boolean> | undefined;

function loadAssistantEnabled(): Promise<boolean> {
  assistantEnabled ??= authFetch('/api/platform/v1/modules/catalog', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = (await response.json()) as { modules?: CatalogEntry[] };
      return (payload.modules ?? []).some(
        (m) => m.key === ASSISTANT_MODULE_KEY && m.entitlementStatus === 'active',
      );
    })
    .catch(() => {
      // Lỗi mạng: lần sau mở trang thì thử lại, không ghi nhớ "không có".
      assistantEnabled = undefined;
      return false;
    });
  return assistantEnabled;
}

/** Mã người dùng của phiên, để bản nháp cất qua chuyển trang chỉ dùng lại cho đúng người đó. */
async function loadUserId(): Promise<string | undefined> {
  try {
    const response = await authFetch('/api/auth/v1/me', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const principal = (await response.json()) as { userId?: string };
    return principal.userId;
  } catch {
    return undefined;
  }
}

function currentPage(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

export interface AssistantLauncherProps {
  /** Class của nút, để cùng cỡ với chuông Thông báo của từng kiểu khung. */
  readonly className?: string;
}

/**
 * Nút Trợ lý cạnh chuông Thông báo và ngăn chat bên phải.
 *
 * Chỉ hiện khi tenant đã bật phân hệ Trợ lý. Ngăn chat là trang của savina-agent nhúng cùng
 * tên miền (`/modules/assistant/?embed=1`), nên dùng luôn phiên đăng nhập ERP. Trang đang mở
 * được gửi kèm để Trợ lý trả lời đúng ngữ cảnh "trang này". Ngăn chỉ tạo khi mở lần đầu và
 * giữ lại khi đóng, để không mất cuộc trò chuyện.
 */
export function AssistantLauncher({ className }: AssistantLauncherProps) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const userIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadAssistantEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(() => {
    setMounted(true);
    setOpen((value) => !value);
  }, []);

  // Ctrl+/ mở hoặc đóng ngăn chat; openAssistant() thì chỉ mở.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        toggle();
      }
    };
    const onOpen = () => {
      setMounted(true);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [enabled, toggle]);

  // Bản nháp từ trang trước (Trợ lý chuyển trang để mở form): mở lại ngăn chat và giao cho màn hình của thao tác.
  useEffect(() => {
    if (!enabled) return;
    const handoff = readAssistantHandoff();
    if (!handoff) return;
    void loadUserId().then((userId) => {
      userIdRef.current = userId;
      if (!userId || userId !== handoff.userId) return;
      setMounted(true);
      setOpen(true);
      resumeAssistantAction(handoff.request);
    });
  }, [enabled]);

  useEffect(() => {
    if (mounted && !userIdRef.current) void loadUserId().then((userId) => (userIdRef.current ??= userId));
  }, [mounted]);

  // Tin từ khung chat: đóng ngăn, sẵn sàng nhận kết quả, mở form của phân hệ. Chỉ nhận tin từ chính khung chat cùng
  // tên miền, và chỉ khi đúng hình dạng.
  useEffect(() => {
    if (!mounted) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message: unknown = event.data;
      if (!isAssistantFrameMessage(message)) return;
      if (message.type === ASSISTANT_MESSAGE.close) setOpen(false);
      else if (message.type === ASSISTANT_MESSAGE.ready)
        setAssistantResultSink((result) =>
          frameRef.current?.contentWindow?.postMessage(
            { type: ASSISTANT_MESSAGE.result, ...result },
            window.location.origin,
          ),
        );
      else if (message.type === ASSISTANT_MESSAGE.action) {
        const { type: _type, ...request } = message;
        dispatchAssistantAction(request, userIdRef.current);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      setAssistantResultSink(undefined);
    };
  }, [mounted]);

  // Module chuyển màn bằng hash hoặc ?view=: báo Trợ lý trang hiện tại mỗi lần mở ngăn và khi đổi trang.
  useEffect(() => {
    if (!mounted) return;
    const post = () =>
      frameRef.current?.contentWindow?.postMessage(
        { type: 'savina-assistant:page', page: currentPage() },
        window.location.origin,
      );
    post();
    window.addEventListener('hashchange', post);
    window.addEventListener('popstate', post);
    return () => {
      window.removeEventListener('hashchange', post);
      window.removeEventListener('popstate', post);
    };
  }, [mounted, open]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className={[styles.button, className, open ? styles.buttonActive : ''].filter(Boolean).join(' ')}
        aria-label="Trợ lý Savina (Ctrl+/)"
        title="Trợ lý Savina (Ctrl+/)"
        aria-expanded={open}
        aria-controls="savina-assistant-panel"
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden>
          <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6-4.6-1.9 4.6-1.9z" />
          <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      </button>
      {mounted ? (
        <aside
          id="savina-assistant-panel"
          className={styles.panel}
          aria-label="Trợ lý Savina"
          hidden={!open}
        >
          <iframe
            ref={frameRef}
            className={styles.frame}
            title="Trợ lý Savina"
            src={`${ASSISTANT_URL}?embed=1&page=${encodeURIComponent(currentPage())}`}
          />
        </aside>
      ) : null}
    </>
  );
}
