'use client';

import { useRealtimeStatus } from '@enterprise-platform/shared-ui';
import { BellRing, CheckCircle2, Maximize2, MessageCircle, Minimize2, Settings, ShieldAlert, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from './chat-context';
import styles from './chat.module.scss';
import { ConversationList } from './conversation-list';
import { requestDesktopPermission, updateChatSettings, useChatSettings } from './desktop-notify';
import { CreateGroupDialog } from './group-dialog';
import { usePeople } from './people-directory';
import { ThreadView } from './thread-view';

function NotificationBar() {
  const { settings, permission } = useChatSettings();
  const { push } = useChat();
  if (permission === 'unsupported') return null;
  if (permission === 'denied')
    return (
      <div className={`${styles.notifyBar} ${styles.notifyBarWarn}`} role="status">
        <ShieldAlert aria-hidden="true" />
        Trình duyệt đang chặn thông báo. Mở biểu tượng ổ khoá trên thanh địa chỉ để cho phép.
      </div>
    );
  if (permission === 'granted' && settings.desktop)
    return (
      <div className={`${styles.notifyBar} ${styles.notifyBarOk}`} role="status">
        <CheckCircle2 aria-hidden="true" />
        {push === 'active' ? 'Đã bật thông báo Windows, kể cả khi đóng tab ERP' : 'Đã bật thông báo Windows'}
      </div>
    );
  return (
    <div className={styles.notifyBar}>
      <BellRing aria-hidden="true" />
      Nhận thông báo Windows khi có tin nhắn mới.
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => (permission === 'granted' ? updateChatSettings({ desktop: true }) : void requestDesktopPermission())}
      >
        Bật thông báo
      </button>
    </div>
  );
}

function SettingsPopover({ onClose }: { onClose: () => void }) {
  const { settings, permission } = useChatSettings();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  const desktopOn = settings.desktop && permission === 'granted';
  return (
    <div ref={ref} className={`${styles.popover} ${styles.settings}`} role="dialog" aria-label="Cài đặt chat">
      <p className={styles.settingsTitle}>Cài đặt chat</p>
      <div className={styles.toggleRow}>
        <span>
          Thông báo Windows
          <small>{permission === 'denied' ? 'Trình duyệt đang chặn thông báo của trang này.' : 'Hiện thông báo của hệ điều hành khi có tin mới.'}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={desktopOn}
          aria-label="Thông báo Windows"
          className={styles.switch}
          disabled={permission === 'denied' || permission === 'unsupported'}
          onClick={() => {
            if (desktopOn) updateChatSettings({ desktop: false });
            else if (permission === 'granted') updateChatSettings({ desktop: true });
            else void requestDesktopPermission();
          }}
        />
      </div>
      <div className={styles.toggleRow}>
        <span>
          Âm báo
          <small>Phát tiếng ngắn khi có tin mới.</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.sound}
          aria-label="Âm báo"
          className={styles.switch}
          onClick={() => updateChatSettings({ sound: !settings.sound })}
        />
      </div>
    </div>
  );
}

/** Khung chat nổi: tiêu đề, thanh thông báo Windows, cột danh sách và cuộc đang mở. */
export function ChatPanel({ hidden }: { hidden: boolean }) {
  const { me, conversations, activeId, setActiveId, setOpen, upsert } = useChat();
  const { people, byId } = usePeople();
  const connected = useRealtimeStatus();
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const myId = me.userId.toLowerCase();

  const nameOf = useCallback(
    (userId: string) => (userId.toLowerCase() === myId ? 'Bạn' : (byId.get(userId.toLowerCase())?.fullName ?? 'Người dùng')),
    [byId, myId],
  );

  // Mở khung lần đầu mà chưa chọn cuộc nào: mở cuộc chung toàn công ty (màn hình rộng).
  useEffect(() => {
    if (hidden || activeId || conversations.length === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches) return;
    setActiveId(conversations[0].id);
  }, [activeId, conversations, hidden, setActiveId]);

  // Esc đóng khung (bảng nổi bên trong tự chặn Esc trước khi tới đây).
  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, setOpen]);

  return (
    <div
      className={expanded ? `${styles.panel} ${styles.panelExpanded}` : styles.panel}
      hidden={hidden}
      role="dialog"
      aria-label="Cổng chat nội bộ"
    >
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <MessageCircle />
        </span>
        <h2 className={styles.headerTitle}>Cổng chat nội bộ</h2>
        <span
          className={connected ? styles.connection : `${styles.connection} ${styles.connectionOff}`}
          title={connected ? 'Đang kết nối thời gian thực' : 'Mất kết nối thời gian thực, đang thử lại'}
        >
          {connected ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <span>{connected ? 'Trực tuyến' : 'Đang kết nối lại'}</span>
        </span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={settingsOpen ? `${styles.iconButton} ${styles.iconButtonActive}` : styles.iconButton}
            aria-label="Cài đặt chat"
            title="Cài đặt chat"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={expanded ? 'Thu nhỏ khung chat' : 'Phóng to khung chat'}
            title={expanded ? 'Thu nhỏ' : 'Phóng to'}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
          <button type="button" className={styles.iconButton} aria-label="Đóng khung chat" title="Đóng" onClick={() => setOpen(false)}>
            <X aria-hidden="true" />
          </button>
        </div>
        {settingsOpen ? <SettingsPopover onClose={() => setSettingsOpen(false)} /> : null}
      </header>
      <NotificationBar />
      <div className={active ? `${styles.body} ${styles.bodyThreadOpen}` : styles.body}>
        <ConversationList people={people} nameOf={nameOf} onCreateGroup={() => setCreating(true)} />
        {active ? (
          <ThreadView key={active.id} conversation={active} onBack={() => setActiveId(null)} />
        ) : (
          <section className={styles.thread}>
            <div className={styles.empty}>
              <MessageCircle aria-hidden="true" />
              <strong>Chọn một cuộc trò chuyện</strong>
              Hoặc chọn một người ở cột bên trái để bắt đầu nhắn tin.
            </div>
          </section>
        )}
      </div>
      {creating ? (
        <CreateGroupDialog
          me={me.userId}
          people={people}
          onClose={() => setCreating(false)}
          onCreated={(conversation) => {
            setCreating(false);
            upsert(conversation);
            setActiveId(conversation.id);
          }}
        />
      ) : null}
    </div>
  );
}
