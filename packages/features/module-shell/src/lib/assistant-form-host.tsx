'use client';

import { ASSISTANT_MESSAGE, isAssistantFrameMessage } from '@enterprise-platform/contracts-assistant';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  deliverAssistantAction,
  hasAssistantAction,
  rejectAssistantAction,
  setAssistantResultSink,
} from './assistant-actions';
import styles from './assistant-form-host.module.scss';

const AssistantEmbedContext = createContext(false);

/**
 * Form đang dựng trong trang form nhúng của card Trợ lý: hiện ngay tại chỗ, chiếm hết bề ngang card, không mở popup
 * và không có lớp phủ. Ngoài card (màn hình bình thường của phân hệ) trả `false`.
 */
export function useAssistantEmbed(): boolean {
  return useContext(AssistantEmbedContext);
}

/** Không component nào nhận thao tác sau ngần này thì báo card là phân hệ chưa có form đó. */
const UNHANDLED_TIMEOUT_MS = 15_000;

/** Chiều cao nội dung, tính cả dropdown, lịch chọn ngày… các thư viện gắn thẳng vào `body` ngoài form. */
function contentHeight(root: HTMLElement): number {
  let bottom = root.getBoundingClientRect().bottom;
  for (const element of Array.from(document.body.children)) {
    if (element.contains(root) || !(element instanceof HTMLElement)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.width > 0) bottom = Math.max(bottom, rect.bottom);
  }
  return Math.ceil(bottom + window.scrollY);
}

export interface AssistantFormHostProps {
  /** Component form của phân hệ; đăng ký thao tác bằng `useAssistantAction` và dựng form ngay tại chỗ. */
  readonly children: ReactNode;
}

/**
 * Khung của trang form nhúng `/modules/<phân hệ>/assistant/form?key=<thao tác>&rid=<requestId>`.
 *
 * Card trong khung chat đặt trang này trong iframe cùng tên miền. Host báo `formReady`, nhận `action` (bản nháp, và
 * các lần sửa tiếp cùng `requestId`) chỉ từ chính khung chat cha, giao cho component form đã đăng ký thao tác, gửi
 * `result` và chiều cao nội dung (`formSize`) về card. Form và API là của chính phân hệ.
 */
export function AssistantFormHost({ children }: AssistantFormHostProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('rid') ?? '';
    const key = params.get('key') ?? '';
    const parent = window.parent;
    const root = rootRef.current;
    if (parent === window || !requestId || !key || !root) return;
    const origin = window.location.origin;
    const post = (message: object) => parent.postMessage(message, origin);

    setAssistantResultSink((result) => post({ type: ASSISTANT_MESSAGE.result, ...result }));

    let unhandled: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== parent) return;
      const message: unknown = event.data;
      if (!isAssistantFrameMessage(message) || message.type !== ASSISTANT_MESSAGE.action) return;
      if (message.requestId !== requestId || message.key !== key) return;
      const request = {
        key: message.key,
        requestId: message.requestId,
        draft: message.draft,
        ...(message.variant ? { variant: message.variant } : {}),
      };
      deliverAssistantAction(request);
      if (!hasAssistantAction(request.key) && unhandled === undefined) {
        unhandled = setTimeout(() => {
          if (!hasAssistantAction(request.key)) rejectAssistantAction(request, 'Phân hệ chưa có form này.');
        }, UNHANDLED_TIMEOUT_MS);
      }
    };
    window.addEventListener('message', onMessage);

    let frame = 0;
    let last = -1;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = contentHeight(root);
        if (height === last) return;
        last = height;
        post({ type: ASSISTANT_MESSAGE.formSize, requestId, height });
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    const mutations = new MutationObserver(measure);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
    measure();

    post({ type: ASSISTANT_MESSAGE.formReady, requestId });

    return () => {
      window.removeEventListener('message', onMessage);
      resize.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(unhandled);
      setAssistantResultSink(undefined);
    };
  }, []);

  return (
    <AssistantEmbedContext.Provider value>
      <div ref={rootRef} className={styles.host}>
        {children}
      </div>
    </AssistantEmbedContext.Provider>
  );
}
