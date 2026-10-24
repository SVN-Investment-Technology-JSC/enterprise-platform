'use client';

import {
  CHAT_COMPANY_TITLE,
  type ChatConversationView,
  type ChatMemberView,
  type ChatMessageView,
  type ChatReaction,
} from '@enterprise-platform/contracts-chat';
import type { CoreChatSignal, CoreChatTyping } from '@enterprise-platform/contracts-realtime';
import { sendRealtime, useRealtimeEvent } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowLeft, Bell, BellOff, Building2, Info, Users } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from './chat-api';
import { useChat } from './chat-context';
import { deliveryStatus, mergeMessages, systemText, threadItems, type DeliveryStatus } from './chat-model';
import styles from './chat.module.scss';
import { Composer, type ComposerHandle, type ComposerSubmit } from './composer';
import { GroupInfoDialog } from './group-dialog';
import { MessageBubble } from './message-bubble';
import { usePeople } from './people-directory';
import { lastSeenLabel, usePresence } from './presence';
import { UserAvatar } from './user-avatar';

const TYPING_TTL_MS = 6_000;
const NEAR_BOTTOM_PX = 80;
const NEAR_TOP_PX = 60;

interface PendingMessage {
  readonly clientId: string;
  readonly view: ChatMessageView;
  readonly request: ComposerSubmit;
  readonly state: 'sending' | 'failed';
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Cuộc trò chuyện đang mở: tiêu đề, dải tin (tải thêm khi cuộn lên), "đang nhập", ô soạn tin. */
export function ThreadView({ conversation, onBack }: { conversation: ChatConversationView; onBack: () => void }) {
  const { me, open, upsert, remove } = useChat();
  const { people, byId } = usePeople();
  const presence = usePresence();
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [members, setMembers] = useState<readonly ChatMemberView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null);
  const [editing, setEditing] = useState<ChatMessageView | null>(null);
  const [typers, setTypers] = useState<ReadonlyMap<string, number>>(new Map());
  const [showInfo, setShowInfo] = useState(false);
  const [unseenBelow, setUnseenBelow] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const atBottom = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const lastMarked = useRef<string | null>(null);
  const sequence = useRef(0);
  const firstLoad = useRef(true);
  const id = conversation.id;
  const myId = me.userId;

  const nameOf = useCallback(
    (userId: string) => (userId.toLowerCase() === myId.toLowerCase() ? 'Bạn' : (byId.get(userId.toLowerCase())?.fullName ?? 'Người dùng')),
    [byId, myId],
  );

  const loadLatest = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const page = await chatApi.messages(id);
      if (mine !== sequence.current) return;
      setMessages((current) => mergeMessages(current, page.messages));
      setMembers(page.members);
      // Lần tải đầu quyết định còn tin cũ hơn không; các lần làm mới sau chỉ thêm tin mới nên giữ nguyên cờ đó.
      if (firstLoad.current) setHasMore(page.hasMore);
      firstLoad.current = false;
      upsert(page.conversation);
      setError(null);
    } catch (cause) {
      if (mine === sequence.current) setError(cause instanceof Error ? cause.message : 'Không tải được tin nhắn.');
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [id, upsert]);

  // Đổi cuộc: bắt đầu lại.
  useEffect(() => {
    setMessages([]);
    setMembers([]);
    setPending([]);
    setReplyTo(null);
    setEditing(null);
    setTypers(new Map());
    setLoading(true);
    setHasMore(false);
    firstLoad.current = true;
    lastMarked.current = null;
    atBottom.current = true;
    void loadLatest();
  }, [id, loadLatest]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    const element = scroller.current;
    setLoadingOlder(true);
    try {
      const page = await chatApi.messages(id, messages[0].id);
      if (element) prepend.current = { height: element.scrollHeight, top: element.scrollTop };
      setMessages((current) => mergeMessages(current, page.messages));
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được tin cũ hơn.');
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, id, loadingOlder, messages]);

  // Tín hiệu của chính cuộc này: tải lại trang mới nhất (gộp các tín hiệu liền nhau).
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useRealtimeEvent(
    'core.chat.changed',
    (event) => {
      const signal = event.data as CoreChatSignal;
      if (signal.conversationId !== id) return;
      if (signal.change === 'message.created') {
        setTypers((current) => {
          if (!current.has(signal.actorUserId.toLowerCase())) return current;
          const next = new Map(current);
          next.delete(signal.actorUserId.toLowerCase());
          return next;
        });
      }
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => void loadLatest(), 200);
    },
    (connected) => {
      if (connected) void loadLatest();
    },
  );
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  useRealtimeEvent('core.chat.typing', (event) => {
    const signal = event.data as CoreChatTyping;
    if (signal.conversationId !== id || signal.userId.toLowerCase() === myId.toLowerCase()) return;
    setTypers((current) => {
      const next = new Map(current);
      if (signal.typing) next.set(signal.userId.toLowerCase(), Date.now() + TYPING_TTL_MS);
      else next.delete(signal.userId.toLowerCase());
      return next;
    });
  });

  useEffect(() => {
    if (typers.size === 0) return;
    const timer = setInterval(() => {
      setTypers((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, until]) => until > now));
        return next.size === current.size ? current : next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [typers.size]);

  // Đã xem: báo máy chủ khi cuộc đang mở, cửa sổ đang hiện và đang ở cuối dải tin.
  const markSeen = useCallback(() => {
    const latest = [...messages].reverse().find((message) => !message.id.startsWith('pending:'));
    if (!latest || latest.id === lastMarked.current || !open || document.visibilityState !== 'visible' || !atBottom.current) return;
    lastMarked.current = latest.id;
    void chatApi
      .markRead(id, latest.id)
      .then(upsert)
      .catch(() => {
        lastMarked.current = null;
      });
  }, [id, messages, open, upsert]);

  useEffect(() => {
    markSeen();
    const onVisible = () => markSeen();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [markSeen]);

  const allMessages = useMemo(() => [...messages, ...pending.map((item) => item.view)], [messages, pending]);
  const items = useMemo(() => threadItems(allMessages), [allMessages]);

  // Giữ vị trí khi chèn tin cũ lên trên; tự cuộn xuống khi có tin mới mà đang ở cuối.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (prepend.current) {
      element.scrollTop = element.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
      return;
    }
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
      setUnseenBelow(false);
    } else setUnseenBelow(true);
  }, [items.length]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) {
      setUnseenBelow(false);
      markSeen();
    }
    if (element.scrollTop < NEAR_TOP_PX) void loadOlder();
  };

  const jumpToBottom = () => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    atBottom.current = true;
    setUnseenBelow(false);
    markSeen();
  };

  const jumpTo = (messageId: string) => {
    const target = scroller.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const send = useCallback(
    async (request: ComposerSubmit, clientId = newClientId()) => {
      const view: ChatMessageView = {
        id: `pending:${clientId}`,
        conversationId: id,
        senderId: myId,
        kind: 'text',
        body: request.body,
        mentions: request.mentions,
        replyTo: request.replyTo
          ? { id: request.replyTo.id, senderId: request.replyTo.senderId, excerpt: request.replyTo.body, isDeleted: false, hasAttachments: request.replyTo.attachments.length > 0 }
          : null,
        attachments: request.attachments,
        reactions: [],
        systemEvent: null,
        clientId,
        isEdited: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      atBottom.current = true;
      setPending((current) => [...current.filter((item) => item.clientId !== clientId), { clientId, view, request, state: 'sending' }]);
      setReplyTo(null);
      try {
        const result = await chatApi.send(id, {
          body: request.body,
          mentions: request.mentions,
          replyToId: request.replyTo?.id ?? null,
          attachmentIds: request.attachments.map((attachment) => attachment.id),
          clientId,
        });
        setMessages((current) => mergeMessages(current, [result.message]));
        setPending((current) => current.filter((item) => item.clientId !== clientId));
        if (result.droppedMentions.length > 0) {
          setError(`${result.droppedMentions.map(nameOf).join(', ')} không ở trong cuộc trò chuyện nên không được nhắc tên.`);
        }
        void loadLatest();
      } catch (cause) {
        setPending((current) => current.map((item) => (item.clientId === clientId ? { ...item, state: 'failed' } : item)));
        setError(cause instanceof Error ? cause.message : 'Không gửi được tin nhắn.');
      }
    },
    [id, loadLatest, myId, nameOf],
  );

  const saveEdit = async (message: ChatMessageView, body: string, mentions: string[]) => {
    const updated = await chatApi.edit(message.id, { body, mentions });
    setMessages((current) => mergeMessages(current, [updated]));
    setEditing(null);
  };

  const recall = async (message: ChatMessageView) => {
    try {
      const updated = await chatApi.recall(message.id);
      setMessages((current) => mergeMessages(current, [updated]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thu hồi được tin.');
    }
  };

  const react = async (message: ChatMessageView, reaction: ChatReaction | null) => {
    try {
      const updated = await chatApi.react(message.id, reaction);
      setMessages((current) => mergeMessages(current, [updated]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thả được cảm xúc.');
    }
  };

  const toggleMute = async () => {
    try {
      upsert(await chatApi.update(id, { muted: !conversation.muted }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đổi được cài đặt thông báo.');
    }
  };

  const onTyping = useCallback((typing: boolean) => {
    sendRealtime('core-chat.typing', { conversationId: id, typing });
  }, [id]);

  // Người nhắc tên được: thành viên cuộc (cuộc chung: mọi người).
  const mentionable = useMemo(() => {
    if (conversation.kind === 'company') return people;
    const allowed = new Set(conversation.memberIds.map((memberId) => memberId.toLowerCase()));
    return people.filter((person) => allowed.has(person.id.toLowerCase()));
  }, [conversation.kind, conversation.memberIds, people]);

  // Trạng thái chỉ hiện dưới tin cuối cùng của chính mình (như Messenger).
  const lastOwn = [...allMessages].reverse().find((message) => message.kind === 'text' && message.senderId.toLowerCase() === myId.toLowerCase());
  const statusOf = (message: ChatMessageView): DeliveryStatus | undefined => {
    if (message.id.startsWith('pending:')) {
      const item = pending.find((entry) => entry.view.id === message.id);
      return item ? { kind: item.state === 'failed' ? 'failed' : 'sending' } : undefined;
    }
    if (message.id !== lastOwn?.id || message.isDeleted) return undefined;
    return deliveryStatus(message, members, myId);
  };

  const peer = conversation.peerUserId;
  const peerOnline = peer ? presence.online.has(peer.toLowerCase()) : false;
  const title = conversation.kind === 'direct' ? nameOf(peer ?? '') : (conversation.title ?? CHAT_COMPANY_TITLE);
  const subtitle =
    conversation.kind === 'company'
      ? `Tin nhắn gửi đến toàn bộ ${conversation.memberCount} người trong công ty`
      : conversation.kind === 'group'
        ? `${conversation.memberCount} thành viên · ${conversation.memberIds.filter((memberId) => presence.online.has(memberId.toLowerCase())).length} đang trực tuyến`
        : peerOnline
          ? 'Đang trực tuyến'
          : lastSeenLabel(peer ? presence.lastSeen.get(peer.toLowerCase()) : undefined);
  const typingNames = [...typers.keys()].map(nameOf);

  return (
    <section className={styles.thread} aria-label={`Trò chuyện: ${title}`}>
      <header className={styles.threadHeader}>
        <button type="button" className={`${styles.iconButton} ${styles.backButton}`} aria-label="Quay lại danh sách" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
        {conversation.kind === 'direct' ? (
          <UserAvatar userId={peer} size={36} presence={peerOnline ? 'online' : 'offline'} />
        ) : (
          <span className={styles.groupIcon} aria-hidden="true">
            {conversation.kind === 'company' ? <Building2 /> : <Users />}
          </span>
        )}
        <div className={styles.threadTitle}>
          <strong>{title}</strong>
          <span className={conversation.kind === 'direct' && peerOnline ? styles.threadStatusOnline : undefined}>{subtitle}</span>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={conversation.muted ? 'Bật thông báo cuộc này' : 'Tắt thông báo cuộc này'}
          title={conversation.muted ? 'Bật thông báo cuộc này' : 'Tắt thông báo cuộc này'}
          onClick={() => void toggleMute()}
        >
          {conversation.muted ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
        </button>
        {conversation.kind === 'group' ? (
          <button type="button" className={styles.iconButton} aria-label="Thông tin nhóm" title="Thông tin nhóm" onClick={() => setShowInfo(true)}>
            <Info aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className={styles.messages} ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Tin nhắn">
        {loadingOlder ? <div className={styles.loadingOlder}>Đang tải tin cũ hơn…</div> : null}
        {loading && messages.length === 0 ? <div className={styles.threadNotice}>Đang tải tin nhắn…</div> : null}
        {!loading && allMessages.length === 0 ? (
          <div className={styles.empty}>
            <strong>Chưa có tin nhắn</strong>
            Gửi lời chào để bắt đầu trò chuyện.
          </div>
        ) : null}
        {items.map((item) => {
          if (item.kind === 'date') return <div key={item.key} className={styles.dateDivider}>{item.label}</div>;
          if (item.kind === 'system') {
            const event = item.message.systemEvent;
            return (
              <div key={item.key} className={styles.systemMessage}>
                {event ? systemText(event, nameOf(item.message.senderId), nameOf) : null}
              </div>
            );
          }
          const message = item.message;
          const mine = message.senderId.toLowerCase() === myId.toLowerCase();
          const failed = pending.find((entry) => entry.view.id === message.id && entry.state === 'failed');
          return (
            <MessageBubble
              key={item.key}
              message={message}
              me={myId}
              mine={mine}
              first={item.first}
              last={item.last}
              showSender={conversation.kind !== 'direct'}
              nameOf={nameOf}
              status={statusOf(message)}
              onReply={(target) => {
                setEditing(null);
                setReplyTo(target);
              }}
              onEdit={(target) => {
                setReplyTo(null);
                setEditing(target);
              }}
              onRecall={(target) => void recall(target)}
              onReact={(target, reaction) => void react(target, reaction)}
              onRetry={failed ? () => void send(failed.request, failed.clientId) : undefined}
              onJump={jumpTo}
            />
          );
        })}
      </div>

      {unseenBelow ? (
        <button type="button" className={styles.jumpLatest} onClick={jumpToBottom}>
          <ArrowDown aria-hidden="true" /> Tin mới
        </button>
      ) : null}

      <div className={styles.typing} aria-live="polite">
        {typingNames.length > 0 ? (
          <>
            <span className={styles.typingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {typingNames.length === 1 ? `${typingNames[0]} đang nhập…` : `${typingNames.slice(0, 2).join(', ')}${typingNames.length > 2 ? ` và ${typingNames.length - 2} người khác` : ''} đang nhập…`}
          </>
        ) : error ? (
          <span className={styles.statusFailed} role="alert">
            {error}{' '}
            <button type="button" className={styles.linkButton} onClick={() => setError(null)}>
              Đóng
            </button>
          </span>
        ) : null}
      </div>

      <Composer
        ref={composer}
        conversationId={id}
        me={myId}
        people={mentionable}
        nameOf={nameOf}
        replyTo={replyTo}
        editing={editing}
        onCancelContext={() => {
          setReplyTo(null);
          setEditing(null);
        }}
        onSubmit={(request) => send(request)}
        onSaveEdit={saveEdit}
        onTyping={onTyping}
      />

      {showInfo ? (
        <GroupInfoDialog
          conversation={conversation}
          me={myId}
          people={people}
          nameOf={nameOf}
          onClose={() => setShowInfo(false)}
          onChanged={(next) => {
            upsert(next);
            void loadLatest();
          }}
          onLeft={() => {
            setShowInfo(false);
            remove(id);
          }}
        />
      ) : null}
    </section>
  );
}
