'use client';

import type { MyProfile } from '@enterprise-platform/contracts-chat';
import { MessageCircle, X } from 'lucide-react';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { chatApi } from './chat-api';
import { ChatProvider, useChat } from './chat-context';
import { ChatPanel } from './chat-panel';
import styles from './chat.module.scss';

/** Hồ sơ của người đang đăng nhập; chỉ tải một lần mỗi trang. Null khi không phải người dùng doanh nghiệp. */
let profile: Promise<MyProfile | null> | undefined;

function isProfile(value: unknown): value is MyProfile {
  const record = value as Partial<MyProfile> | null;
  return typeof record?.userId === 'string' && record.userId.length > 0 && typeof record.fullName === 'string';
}

function loadProfile(): Promise<MyProfile | null> {
  profile ??= chatApi
    .profile()
    .then((value) => {
      if (isProfile(value)) return value;
      profile = undefined;
      return null;
    })
    .catch(() => {
      // Quản trị nền tảng, phiên hết hạn hay mất mạng: không có chat; lần mở trang sau thử lại.
      profile = undefined;
      return null;
    });
  return profile;
}

function LauncherButton() {
  const { open, setOpen, unreadTotal } = useChat();
  const [mounted, setMounted] = useState(false);
  const [pulse, setPulse] = useState(false);
  const previous = useRef(unreadTotal);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  // Số tin chưa đọc tăng: nút rung nhẹ và toả vòng sáng vài giây để người dùng để ý.
  useEffect(() => {
    const grew = unreadTotal > previous.current;
    previous.current = unreadTotal;
    if (!grew || open) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 2_600);
    return () => clearTimeout(timer);
  }, [open, unreadTotal]);
  return (
    <>
      <button
        type="button"
        className={[styles.launcher, open ? styles.launcherOpen : '', pulse ? styles.launcherPulse : ''].filter(Boolean).join(' ')}
        aria-label={open ? 'Đóng chat nội bộ' : unreadTotal > 0 ? `Mở chat nội bộ, ${unreadTotal} tin chưa đọc` : 'Mở chat nội bộ'}
        aria-expanded={open}
        title="Chat nội bộ"
        onClick={() => setOpen(!open)}
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
        {!open && unreadTotal > 0 ? (
          <span className={styles.launcherBadge} aria-hidden="true">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        ) : null}
      </button>
      {/* Khung chỉ dựng ở lần mở đầu tiên và giữ lại khi đóng, để không mất nội dung đang soạn. */}
      {mounted ? <ChatPanel hidden={!open} /> : null}
    </>
  );
}

/** Chat gặp lỗi bất ngờ thì chỉ ẩn khung chat, trang của phân hệ vẫn chạy bình thường. */
class ChatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.warn('Chat nội bộ tạm ẩn do lỗi:', error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Chat nội bộ của toàn hệ thống: nút tròn ở góc phải dưới, bấm để mở khung chat. Gắn trong khung chung (ModuleShell)
 * nên có ở mọi trang của mọi phân hệ; không phụ thuộc phân hệ nào được bật. Chỉ hiện cho người dùng doanh nghiệp.
 */
export function ChatLauncher() {
  const [me, setMe] = useState<MyProfile | null>(null);
  useEffect(() => {
    let active = true;
    void loadProfile().then((value) => active && setMe(value));
    return () => {
      active = false;
    };
  }, []);
  if (!me) return null;
  return (
    <ChatBoundary>
      <ChatProvider me={me}>
        <LauncherButton />
      </ChatProvider>
    </ChatBoundary>
  );
}
