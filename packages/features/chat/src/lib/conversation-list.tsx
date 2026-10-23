'use client';

import { CHAT_COMPANY_TITLE, type ChatConversationView, type ChatPerson } from '@enterprise-platform/contracts-chat';
import { AtSign, BellOff, Building2, Search, UsersRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useChat } from './chat-context';
import { fold, matchesPerson, previewText, shortTime, type NameOf } from './chat-model';
import styles from './chat.module.scss';
import { lastSeenLabel, usePresence } from './presence';
import { UserAvatar } from './user-avatar';

function badge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Cột trái: tìm người hoặc nhóm, nút tạo nhóm, danh sách cuộc trò chuyện (cuộc chung đứng đầu, rồi theo tin mới
 * nhất) và những người chưa từng nhắn (kèm trạng thái trực tuyến) để bắt đầu chat 1-1.
 */
export function ConversationList({
  people,
  nameOf,
  onCreateGroup,
}: {
  people: readonly ChatPerson[];
  nameOf: NameOf;
  onCreateGroup: () => void;
}) {
  const { me, conversations, activeId, setActiveId, openDirect, loaded, error } = useChat();
  const presence = usePresence();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const myId = me.userId.toLowerCase();

  const titleOf = (conversation: ChatConversationView) =>
    conversation.kind === 'direct' ? nameOf(conversation.peerUserId ?? '') : (conversation.title ?? CHAT_COMPANY_TITLE);

  const visibleConversations = conversations.filter((conversation) => !query.trim() || fold(titleOf(conversation)).includes(fold(query.trim())));

  // Người chưa có chat 1-1 với mình: đang trực tuyến lên trước, rồi theo tên.
  const others = useMemo(() => {
    const withDirect = new Set(
      conversations.filter((conversation) => conversation.kind === 'direct' && conversation.peerUserId).map((c) => (c.peerUserId as string).toLowerCase()),
    );
    return people
      .filter((person) => person.id.toLowerCase() !== myId && !withDirect.has(person.id.toLowerCase()) && matchesPerson(person, query))
      .sort((a, b) => {
        const online = Number(presence.online.has(b.id.toLowerCase())) - Number(presence.online.has(a.id.toLowerCase()));
        return online || a.fullName.localeCompare(b.fullName, 'vi');
      });
  }, [conversations, myId, people, presence.online, query]);

  const start = async (person: ChatPerson) => {
    setOpening(person.id);
    try {
      await openDirect(person.id);
      setQuery('');
    } finally {
      setOpening(null);
    }
  };

  return (
    <aside className={styles.sidebar} aria-label="Cuộc trò chuyện">
      <div className={styles.sidebarTools}>
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm người hoặc nhóm..." aria-label="Tìm người hoặc nhóm" />
        </label>
        <button type="button" className={styles.iconButton} aria-label="Tạo nhóm chat" title="Tạo nhóm chat" onClick={onCreateGroup} style={{ width: 36, height: 36 }}>
          <UsersRound aria-hidden="true" />
        </button>
      </div>
      <div className={styles.list} role="list">
        {!loaded ? <p className={styles.emptyList}>Đang tải…</p> : null}
        {loaded && error && conversations.length === 0 ? <p className={styles.emptyList}>{error}</p> : null}
        {visibleConversations.map((conversation) => {
          const active = conversation.id === activeId;
          const peer = conversation.peerUserId?.toLowerCase();
          const online = peer ? presence.online.has(peer) : false;
          const unread = conversation.unreadCount > 0;
          const sub =
            conversation.lastMessage || conversation.kind !== 'direct'
              ? previewText(conversation.lastMessage, { me: me.userId, kind: conversation.kind, nameOf })
              : online
                ? 'Đang trực tuyến'
                : lastSeenLabel(peer ? presence.lastSeen.get(peer) : undefined);
          return (
            <button
              key={conversation.id}
              type="button"
              role="listitem"
              aria-current={active ? 'true' : undefined}
              className={[styles.item, active ? styles.itemActive : '', unread ? styles.itemUnread : ''].filter(Boolean).join(' ')}
              onClick={() => setActiveId(conversation.id)}
            >
              {conversation.kind === 'direct' ? (
                <UserAvatar userId={conversation.peerUserId} size={38} presence={online ? 'online' : 'offline'} />
              ) : (
                <span className={styles.groupIcon} aria-hidden="true">
                  {conversation.kind === 'company' ? <Building2 /> : <Users />}
                </span>
              )}
              <span className={styles.itemText}>
                <span className={styles.itemTop}>
                  <span className={styles.itemName}>{titleOf(conversation)}</span>
                  <span className={styles.itemTime}>{shortTime(conversation.lastMessage?.createdAt)}</span>
                </span>
                <span className={styles.itemTop}>
                  <span className={styles.itemSub}>
                    {conversation.kind === 'company' && !conversation.lastMessage ? 'Gửi cho toàn bộ nhân viên' : sub}
                  </span>
                  <span className={styles.itemBadges}>
                    {conversation.muted ? <BellOff className={styles.mutedIcon} aria-label="Đã tắt thông báo" /> : null}
                    {conversation.unreadMentionCount > 0 ? (
                      <span className={styles.mentionBadge} aria-label="Có người nhắc đến bạn">
                        <AtSign aria-hidden="true" />
                      </span>
                    ) : null}
                    {unread ? (
                      <span className={styles.unreadBadge} aria-label={`${conversation.unreadCount} tin chưa đọc`}>
                        {badge(conversation.unreadCount)}
                      </span>
                    ) : null}
                  </span>
                </span>
              </span>
            </button>
          );
        })}

        {others.length > 0 ? <div className={styles.listSection}>Mọi người</div> : null}
        {others.map((person) => {
          const online = presence.online.has(person.id.toLowerCase());
          return (
            <button
              key={person.id}
              type="button"
              role="listitem"
              className={styles.item}
              disabled={opening === person.id}
              onClick={() => void start(person)}
            >
              <UserAvatar userId={person.id} name={person.fullName} size={38} presence={online ? 'online' : 'offline'} />
              <span className={styles.itemText}>
                <span className={styles.itemName}>{person.fullName}</span>
                <span className={online ? `${styles.itemSub} ${styles.itemSubOnline}` : styles.itemSub}>
                  {online ? 'Đang trực tuyến' : lastSeenLabel(presence.lastSeen.get(person.id.toLowerCase()))}
                </span>
              </span>
            </button>
          );
        })}
        {loaded && visibleConversations.length === 0 && others.length === 0 ? <p className={styles.emptyList}>Không tìm thấy người hoặc nhóm phù hợp.</p> : null}
      </div>
    </aside>
  );
}
