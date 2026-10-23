'use client';

import { userAvatarUrl, type ChatConversationView, type MyProfile } from '@enterprise-platform/contracts-chat';
import type { CoreChatSignal } from '@enterprise-platform/contracts-realtime';
import { useRealtimeEvent, useRealtimeStatus } from '@enterprise-platform/shared-ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { chatApi } from './chat-api';
import { previewText } from './chat-model';
import { notifyChat, refreshDesktopPermission } from './desktop-notify';
import { ensurePeople, usePeople } from './people-directory';

/** Mở khung chat từ nơi khác (ví dụ nút "Nhắn tin" ở trang người dùng): kèm cuộc trò chuyện hoặc người cần nhắn. */
export const OPEN_CHAT_EVENT = 'ep-chat:open';

export interface OpenChatDetail {
  readonly conversationId?: string;
  readonly userId?: string;
}

export function openChat(detail: OpenChatDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
}

const HASH = /^#chat\/([0-9a-f-]{36})$/i;
const REFRESH_DEBOUNCE_MS = 300;
const FALLBACK_POLL_MS = 30_000;

export interface ChatContextValue {
  readonly me: MyProfile;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly activeId: string | null;
  readonly setActiveId: (id: string | null) => void;
  readonly conversations: readonly ChatConversationView[];
  readonly unreadTotal: number;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Đặt (hoặc thay) một cuộc trong danh sách sau khi tạo, đổi tên, đọc... không chờ tải lại cả danh sách. */
  readonly upsert: (conversation: ChatConversationView) => void;
  readonly remove: (conversationId: string) => void;
  /** Mở chat 1-1 với một người (tạo nếu chưa có). */
  readonly openDirect: (userId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat phải nằm trong ChatProvider.');
  return value;
}

/**
 * Trạng thái chung của chat cho cả trang: danh sách cuộc trò chuyện, số tin chưa đọc, cuộc đang mở. Nghe tín hiệu
 * `core.chat.changed` để làm mới (gộp các tín hiệu liền nhau), báo tin mới bằng thông báo Windows khi người dùng
 * không đang xem đúng cuộc đó. Mất kết nối realtime thì hỏi lại định kỳ.
 */
export function ChatProvider({ me, children }: { me: MyProfile; children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<readonly ChatConversationView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = useRealtimeStatus();
  const { byId } = usePeople();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingNotices = useRef(new Set<string>());
  const state = useRef({ open, activeId, byId, conversations });
  state.current = { open, activeId, byId, conversations };

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) refreshDesktopPermission();
  }, []);

  const notifyNew = useCallback((items: readonly ChatConversationView[]) => {
    for (const messageId of [...pendingNotices.current]) {
      const conversation = items.find((item) => item.lastMessage?.id === messageId);
      if (!conversation?.lastMessage) continue;
      pendingNotices.current.delete(messageId);
      const current = state.current;
      const watching =
        current.open && current.activeId === conversation.id && typeof document !== 'undefined' && document.visibilityState === 'visible';
      if (conversation.muted || watching || conversation.lastMessage.senderId.toLowerCase() === me.userId.toLowerCase()) continue;
      const nameOf = (userId: string) => current.byId.get(userId.toLowerCase())?.fullName ?? 'Đồng nghiệp';
      const sender = conversation.lastMessage.senderId;
      const senderPerson = current.byId.get(sender.toLowerCase());
      const title =
        conversation.kind === 'direct' ? nameOf(sender) : `${nameOf(sender)} · ${conversation.title ?? 'Nhóm'}`;
      const body = previewText(conversation.lastMessage, { me: me.userId, kind: 'direct', nameOf });
      void notifyChat({
        id: messageId,
        title: conversation.unreadMentionCount > 0 ? `${title} nhắc đến bạn` : title,
        body,
        icon: senderPerson?.avatarVersion != null ? userAvatarUrl(sender, senderPerson.avatarVersion) : undefined,
        onClick: () => {
          setActiveId(conversation.id);
          setOpen(true);
        },
      });
    }
    // Tin không còn là tin mới nhất (đã có tin khác đè) thì thôi báo, tránh dồn thông báo cũ.
    if (pendingNotices.current.size > 20) pendingNotices.current.clear();
  }, [me.userId, setOpen]);

  const refresh = useCallback(async () => {
    try {
      const list = await chatApi.conversations();
      setConversations(list.items);
      setError(null);
      setLoaded(true);
      notifyNew(list.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách trò chuyện.');
      setLoaded(true);
    }
  }, [notifyNew]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    void ensurePeople();
    void refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  useRealtimeEvent(
    'core.chat.changed',
    (event) => {
      const signal = event.data as CoreChatSignal;
      if (signal.change === 'message.created' && signal.messageId && signal.actorUserId.toLowerCase() !== me.userId.toLowerCase()) {
        pendingNotices.current.add(signal.messageId);
      }
      if (signal.change === 'members.changed') void ensurePeople();
      scheduleRefresh();
    },
    (isConnected) => {
      if (isConnected) scheduleRefresh();
    },
  );

  // Không có kết nối realtime (mất mạng, máy chủ realtime tắt): hỏi lại định kỳ để số tin chưa đọc vẫn đúng.
  useEffect(() => {
    if (connected) return;
    const poll = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(poll);
  }, [connected, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshDesktopPermission();
        scheduleRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [scheduleRefresh]);

  const upsert = useCallback((conversation: ChatConversationView) => {
    setConversations((current) => {
      const rest = current.filter((item) => item.id !== conversation.id);
      return [conversation, ...rest].sort(compareConversations);
    });
  }, []);

  const remove = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((item) => item.id !== conversationId));
    setActiveId((current) => (current === conversationId ? null : current));
  }, []);

  const openDirect = useCallback(
    async (userId: string) => {
      const conversation = await chatApi.direct(userId);
      upsert(conversation);
      setActiveId(conversation.id);
      setOpen(true);
    },
    [setOpen, upsert],
  );

  // Liên kết `#chat/<id>` (từ thông báo "được nhắc tên") và sự kiện mở chat từ màn hình khác.
  useEffect(() => {
    const fromHash = () => {
      const match = HASH.exec(window.location.hash);
      if (!match) return;
      setActiveId(match[1].toLowerCase());
      setOpen(true);
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    };
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenChatDetail>).detail ?? {};
      if (detail.userId) void openDirect(detail.userId).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
      else {
        if (detail.conversationId) setActiveId(detail.conversationId);
        setOpen(true);
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
    };
  }, [openDirect, setOpen]);

  const unreadTotal = useMemo(
    () => conversations.filter((item) => !item.muted).reduce((sum, item) => sum + item.unreadCount, 0),
    [conversations],
  );

  const value = useMemo<ChatContextValue>(
    () => ({ me, open, setOpen, activeId, setActiveId, conversations, unreadTotal, loaded, error, refresh, upsert, remove, openDirect }),
    [me, open, setOpen, activeId, conversations, unreadTotal, loaded, error, refresh, upsert, remove, openDirect],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function compareConversations(a: ChatConversationView, b: ChatConversationView): number {
  if (a.kind === 'company' && b.kind !== 'company') return -1;
  if (b.kind === 'company' && a.kind !== 'company') return 1;
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
}
