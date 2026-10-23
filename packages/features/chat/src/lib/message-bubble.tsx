'use client';

import {
  CHAT_EDIT_WINDOW_MINUTES,
  CHAT_REACTIONS,
  CHAT_REACTION_LABELS,
  type ChatMessageView,
  type ChatReaction,
} from '@enterprise-platform/contracts-chat';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import { MessageAttachments } from './attachments';
import { canEdit, clockTime, splitBody, type DeliveryStatus, type NameOf } from './chat-model';
import styles from './chat.module.scss';
import { REACTION_ICONS } from './reaction-icons';
import { UserAvatar } from './user-avatar';

export interface BubbleProps {
  readonly message: ChatMessageView;
  readonly me: string;
  readonly mine: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly showSender: boolean;
  readonly nameOf: NameOf;
  /** Trạng thái gửi (chỉ cho tin cuối của mình). */
  readonly status?: DeliveryStatus;
  readonly onReply: (message: ChatMessageView) => void;
  readonly onEdit: (message: ChatMessageView) => void;
  readonly onRecall: (message: ChatMessageView) => void;
  readonly onReact: (message: ChatMessageView, reaction: ChatReaction | null) => void;
  readonly onRetry?: () => void;
  readonly onJump?: (messageId: string) => void;
}

function Body({ message, me, nameOf }: { message: ChatMessageView; me: string; nameOf: NameOf }): ReactNode {
  const segments = splitBody(
    message.body,
    message.mentions.map((id) => ({ id, name: nameOf(id) })),
  );
  return segments.map((segment, index) => {
    if (segment.kind === 'mention') {
      const isMe = segment.userId.toLowerCase() === me.toLowerCase();
      return (
        <span key={index} className={isMe ? `${styles.mention} ${styles.mentionMe}` : styles.mention}>
          {segment.text}
        </span>
      );
    }
    if (segment.kind === 'link') {
      return (
        <a key={index} className={styles.messageLink} href={segment.href} target="_blank" rel="noopener noreferrer">
          {segment.text}
        </a>
      );
    }
    return <span key={index}>{segment.text}</span>;
  });
}

function StatusLine({ status, nameOf, onRetry }: { status: DeliveryStatus; nameOf: NameOf; onRetry?: () => void }) {
  if (status.kind === 'sending')
    return (
      <span className={styles.status}>
        <Clock aria-hidden="true" /> Đang gửi
      </span>
    );
  if (status.kind === 'failed')
    return (
      <span className={`${styles.status} ${styles.statusFailed}`}>
        <AlertCircle aria-hidden="true" /> Gửi lỗi.{' '}
        {onRetry ? (
          <button type="button" className={styles.linkButton} onClick={onRetry}>
            Gửi lại
          </button>
        ) : null}
      </span>
    );
  if (status.kind === 'sent')
    return (
      <span className={styles.status}>
        <Check aria-hidden="true" /> Đã gửi
      </span>
    );
  if (status.kind === 'delivered')
    return (
      <span className={styles.status}>
        <CheckCheck aria-hidden="true" /> Đã nhận
      </span>
    );
  const names = status.readers.map(nameOf);
  return (
    <span className={styles.status} title={`Đã xem: ${names.join(', ')}`}>
      Đã xem
      <span className={styles.readers}>
        {status.readers.slice(0, 4).map((userId) => (
          <UserAvatar key={userId} userId={userId} size={16} />
        ))}
      </span>
      {status.readers.length > 4 ? `+${status.readers.length - 4}` : null}
    </span>
  );
}

function BubbleImpl(props: BubbleProps) {
  const { message, me, mine, first, last, showSender, nameOf, status } = props;
  const [picking, setPicking] = useState(false);
  const recalled = message.isDeleted;
  const myReaction = message.reactions.find((group) => group.userIds.some((id) => id.toLowerCase() === me.toLowerCase()))?.reaction;
  const imagesOnly = !recalled && !message.body && message.attachments.length > 0 && message.attachments.every((a) => a.isImage) && !message.replyTo;
  const editable = mine && !recalled && canEdit(message, CHAT_EDIT_WINDOW_MINUTES);
  const pending = status?.kind === 'sending' || status?.kind === 'failed';

  return (
    <div className={[styles.row, first ? styles.rowFirst : '', mine ? styles.rowMine : ''].filter(Boolean).join(' ')} data-message-id={message.id}>
      {mine ? null : <div className={styles.avatarSlot}>{last ? <UserAvatar userId={message.senderId} size={30} /> : null}</div>}
      <div className={styles.stack}>
        {showSender && first && !mine ? <span className={styles.senderName}>{nameOf(message.senderId)}</span> : null}
        <div
          className={[
            styles.bubble,
            mine && !recalled ? styles.bubbleMine : '',
            recalled ? styles.bubbleRecalled : '',
            imagesOnly ? styles.bubbleImagesOnly : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title={clockTime(message.createdAt)}
        >
          {recalled ? (
            mine ? 'Bạn đã thu hồi một tin nhắn' : 'Tin nhắn đã được thu hồi'
          ) : (
            <>
              {message.replyTo ? (
                <button type="button" className={styles.quote} onClick={() => props.onJump?.(message.replyTo?.id ?? '')}>
                  <strong>{nameOf(message.replyTo.senderId)}</strong>
                  {': '}
                  {message.replyTo.isDeleted ? 'Tin nhắn đã được thu hồi' : message.replyTo.excerpt || 'Tệp đính kèm'}
                </button>
              ) : null}
              {message.body ? <Body message={message} me={me} nameOf={nameOf} /> : null}
              {message.isEdited ? <span className={styles.edited}>(đã sửa)</span> : null}
              <MessageAttachments attachments={message.attachments} />
            </>
          )}
        </div>
        {!recalled && message.reactions.length > 0 ? (
          <div className={styles.reactions}>
            {message.reactions.map((group) => {
              const Icon = REACTION_ICONS[group.reaction];
              const minePicked = group.reaction === myReaction;
              return (
                <button
                  key={group.reaction}
                  type="button"
                  className={minePicked ? `${styles.reactionChip} ${styles.reactionChipMine}` : styles.reactionChip}
                  title={`${CHAT_REACTION_LABELS[group.reaction]}: ${group.userIds.map(nameOf).join(', ')}`}
                  onClick={() => props.onReact(message, minePicked ? null : group.reaction)}
                >
                  <Icon aria-hidden="true" className={styles[`reaction-${group.reaction}`]} />
                  {group.userIds.length}
                </button>
              );
            })}
          </div>
        ) : null}
        {status ? <StatusLine status={status} nameOf={nameOf} onRetry={props.onRetry} /> : null}
      </div>

      {!recalled && !pending ? (
        <div className={`${styles.tools} ${mine ? styles.toolsMine : styles.toolsTheirs}`}>
          <button type="button" className={styles.iconButton} aria-label="Thả cảm xúc" title="Thả cảm xúc" onClick={() => setPicking((value) => !value)}>
            <SmilePlus aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Trả lời" title="Trả lời" onClick={() => props.onReply(message)}>
            <CornerUpLeft aria-hidden="true" />
          </button>
          {editable ? (
            <button type="button" className={styles.iconButton} aria-label="Sửa tin" title="Sửa tin" onClick={() => props.onEdit(message)}>
              <Pencil aria-hidden="true" />
            </button>
          ) : null}
          {mine ? (
            <Popconfirm
              title="Thu hồi tin nhắn?"
              description="Mọi người trong cuộc trò chuyện sẽ không còn thấy nội dung và tệp của tin này."
              okText="Thu hồi"
              okType="danger"
              placement="top"
              onConfirm={() => props.onRecall(message)}
            >
              <button type="button" className={styles.iconButton} aria-label="Thu hồi" title="Thu hồi">
                <Trash2 aria-hidden="true" />
              </button>
            </Popconfirm>
          ) : null}
        </div>
      ) : null}

      {picking ? (
        <div className={styles.reactionPicker} style={mine ? { right: 4 } : { left: 44 }} role="menu" aria-label="Chọn cảm xúc" onMouseLeave={() => setPicking(false)}>
          {CHAT_REACTIONS.map((reaction) => {
            const Icon = REACTION_ICONS[reaction];
            return (
              <button
                key={reaction}
                type="button"
                role="menuitem"
                className={styles.reactionOption}
                aria-label={CHAT_REACTION_LABELS[reaction]}
                title={CHAT_REACTION_LABELS[reaction]}
                onClick={() => {
                  setPicking(false);
                  props.onReact(message, reaction === myReaction ? null : reaction);
                }}
              >
                <Icon aria-hidden="true" className={styles[`reaction-${reaction}`]} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(BubbleImpl);
