'use client';

import type {
  ProcedureActivity,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  sendRealtime,
  useRealtimeEvent,
  useRealtimeStatus,
  type ProcedureCommentSignal,
  type ProcedureTypingSignal,
} from '@enterprise-platform/shared-ui';
import { Ellipsis, Reply } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  applyMention,
  extractMentionIds,
  findMentionQuery,
  nextActiveIndex,
  scanMentions,
  splitByMentions,
  suggestPeople,
  type MentionQuery,
} from '../chat-mentions';
import type { ChatPerson } from '../chat-people';
import {
  activeTypers,
  nextTypingSignal,
  pruneTyping,
  typingLabel,
  withTyping,
  type TypingMap,
} from '../chat-typing';
import { activityTime, dayLabel } from './activity-format';
import styles from './workspace-board.module.scss';

/** Tô nổi tên người được nhắc trong tin đã gửi, dùng đúng bộ quét với phần rút id người nhận. */
function renderMentions(text: string, people: readonly ChatPerson[]): ReactNode {
  const parts = splitByMentions(text, scanMentions(text, people));
  if (parts.length === 0) return text;
  return parts.map((part, index) =>
    part.mention ? (
      <mark key={index} className={styles.mention}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

const PAGE = 20;
/** Gom nhiều tín hiệu dồn dập thành một lần tải lại. */
const REFRESH_DEBOUNCE_MS = 250;
/** Không có realtime thì hỏi lại theo nhịp này khi đang mở trao đổi. */
const FALLBACK_REFRESH_MS = 30_000;

export function ChatPanel({
  instance,
  busy,
  participants,
  currentUserId,
  onSend,
  onRefreshInstance,
}: {
  instance: ProcedureInstance;
  busy?: string;
  /** Những NGƯỜI có thể được nhắc (đã mở rộng từ chức danh/đơn vị), không gồm chính mình. */
  participants: readonly ChatPerson[];
  currentUserId?: string;
  onSend: (body: string, mentions: string[], replyToId?: string) => void;
  /** Tải lại đúng hồ sơ này khi người khác có trao đổi mới (tín hiệu thời gian thực). */
  onRefreshInstance?: (instanceId: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [mention, setMention] = useState<MentionQuery>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [typers, setTypers] = useState<TypingMap>({});
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  // Trạng thái "tôi đang gõ" đã báo lên máy chủ, để không báo mỗi phím.
  const typingState = useRef({ typing: false, at: 0 });
  const live = useRealtimeStatus();
  const instanceId = instance.id;

  const canComment = instance.authorization?.canComment ?? false;

  /**
   * Chỉ bình luận. Các chuyển trạng thái đã có tab "Lịch sử thao tác" riêng —
   * trộn chung khiến một cuộc trao đổi ba câu bị đẩy trôi giữa hàng chục dòng
   * duyệt/trả về.
   *
   * Server trả mới-nhất-trước và AC-CHT-06 cũng yêu cầu vậy — không sắp lại.
   */
  const comments = useMemo(
    () => instance.activity.filter((entry) => entry.action === 'comment'),
    [instance.activity],
  );
  /** Trao đổi đang được trả lời. Giữ id chứ không giữ cả object: hồ sơ được nạp
   *  lại sau mỗi lần gửi, object cũ sẽ thành bản sao mồ côi. */
  const [replyToId, setReplyToId] = useState<string>();
  const commentById = useMemo(
    () => new Map(comments.map((entry) => [entry.id, entry])),
    [comments],
  );
  const replyTo = replyToId ? commentById.get(replyToId) : undefined;

  /**
   * Gom trao đổi thành CÂY theo `replyToId`.
   *
   * Danh sách phẳng không đọc được khi có nhiều nhánh: câu trả lời nằm cách câu
   * hỏi vài mục, phải đối chiếu bản trích mới biết ai đang nói với ai.
   *
   * Mục có `replyToId` trỏ vào thứ không tồn tại (bản gốc đã bị gỡ) được coi là
   * GỐC, không bị vứt đi — mất mạch hội thoại còn hơn mất hẳn nội dung.
   */
  const { roots, childrenOf } = useMemo(() => {
    const children = new Map<string, ProcedureActivity[]>();
    const top: ProcedureActivity[] = [];
    // Duyệt từ cũ tới mới để con của mỗi nhánh xếp theo thứ tự thời gian.
    for (const entry of [...comments].reverse()) {
      const parentId = entry.replyToId;
      if (parentId && comments.some((candidate) => candidate.id === parentId)) {
        const list = children.get(parentId) ?? [];
        list.push(entry);
        children.set(parentId, list);
      } else {
        top.push(entry);
      }
    }
    // Gốc hiện mới nhất trước, giống mọi bảng tin khác trong sản phẩm.
    return { roots: top.reverse(), childrenOf: children };
  }, [comments]);

  // Phân trang tính theo GỐC, không theo tổng số mục: cắt giữa một nhánh sẽ để
  // lại những câu trả lời mồ côi không hiểu nổi.
  const entries = roots.slice(0, visible);

  /* ---------------------------------------------------------- thời gian thực */

  /** Vào phòng của hồ sơ: máy chủ kiểm quyền rồi mới cho vào; tín hiệu chỉ đến người đang mở hồ sơ. */
  const joinRoom = useCallback(() => {
    sendRealtime('procedure.subscribe', { instanceId });
  }, [instanceId]);

  useEffect(() => {
    joinRoom();
    return () => {
      // Báo ngừng gõ TRƯỚC khi rời phòng (rời rồi thì máy chủ không nhận nữa).
      if (typingState.current.typing) {
        sendRealtime('procedure.typing', { instanceId, typing: false });
        typingState.current = { typing: false, at: 0 };
      }
      sendRealtime('procedure.unsubscribe', { instanceId });
    };
  }, [instanceId, joinRoom]);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Tín hiệu đến lúc tab ở nền: tải khi tab hiện lại.
  const pendingRefresh = useRef(false);
  const requestRefresh = useCallback(() => {
    if (!onRefreshInstance) return;
    if (document.visibilityState !== 'visible') {
      pendingRefresh.current = true;
      return;
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      pendingRefresh.current = false;
      void onRefreshInstance(instanceId);
    }, REFRESH_DEBOUNCE_MS);
  }, [onRefreshInstance, instanceId]);

  useRealtimeEvent(
    'procedure.comment.changed',
    (event) => {
      const signal = event.data as Partial<ProcedureCommentSignal> | undefined;
      if (signal?.instanceId !== instanceId) return;
      // Người vừa gửi tin thì chắc chắn không còn đang gõ.
      if (signal.actorUserId) {
        setTypers((current) => withTyping(current, signal.actorUserId as string, false, Date.now()));
      }
      requestRefresh();
    },
    (connected) => {
      // Nối lại: phòng đã mất (hoặc chưa từng vào) nên phải xin vào lại, và có thể đã lỡ tin trong lúc mất mạng.
      if (connected) {
        joinRoom();
        requestRefresh();
      }
    },
  );

  useRealtimeEvent('procedure.comment.typing', (event) => {
    const typing = event.data as Partial<ProcedureTypingSignal> | undefined;
    if (
      typing?.instanceId !== instanceId ||
      !typing.userId ||
      typing.userId === currentUserId
    ) {
      return;
    }
    setTypers((current) => withTyping(current, typing.userId as string, typing.typing === true, Date.now()));
  });

  // Mỗi giây dọn người đã hết hạn; không có ai đang gõ thì không chạy gì cả.
  const hasTypers = Object.keys(typers).length > 0;
  useEffect(() => {
    if (!hasTypers) return;
    const timer = setInterval(() => setTypers((current) => pruneTyping(current, Date.now())), 1_000);
    return () => clearInterval(timer);
  }, [hasTypers]);

  // Không có realtime (mất kết nối hoặc trang không có kênh) thì tự hỏi lại theo nhịp.
  useEffect(() => {
    if (live === true) return;
    const timer = setInterval(requestRefresh, FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, requestRefresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pendingRefresh.current) requestRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(refreshTimer.current);
    };
  }, [requestRefresh]);

  const announceTyping = useCallback(
    (hasText: boolean) => {
      const next = nextTypingSignal(typingState.current, hasText, Date.now());
      typingState.current = next.state;
      if (next.send !== undefined) {
        sendRealtime('procedure.typing', { instanceId, typing: next.send });
      }
    },
    [instanceId],
  );

  /* ---------------------------------------------------------------- nhắc tên */

  const suggestions = useMemo(
    () => (mention ? suggestPeople(participants, mention.term) : []),
    [mention, participants],
  );

  // Đổi từ khoá thì chọn lại từ đầu danh sách.
  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.start, mention?.term]);

  // Gõ tiếp sau một `@` còn dang dở luôn mở lại danh sách tương ứng, kể cả khi trước đó đã bị đóng.
  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    setMention(findMentionQuery(value, caret));
    announceTyping(value.trim().length > 0);
  };

  // Bấm ra chỗ khác, rời ô nhập hay nhấn Esc: ẩn danh sách cho tới lần gõ kế tiếp.
  const closeSuggestions = () => setMention(undefined);

  // Con trỏ đi ra khỏi lượt nhắc (bấm chuột vào chỗ khác, phím mũi tên trái/phải).
  const onCaretMove = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    if (!mention) return;
    const field = event.currentTarget;
    const query = findMentionQuery(field.value, field.selectionStart ?? 0);
    if (!query || query.start !== mention.start) closeSuggestions();
  };

  const pickMention = (person: ChatPerson) => {
    const input = textarea.current;
    if (!mention || !input) return;
    const result = applyMention(draft, mention, input.selectionStart ?? draft.length, person.name);
    setDraft(result.text);
    setMention(undefined);
    // Đặt lại con trỏ sau khi React vẽ xong giá trị mới.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.caret, result.caret);
    });
  };

  const appendQuickMention = (name: string) => {
    const textEl = textarea.current;
    const start = textEl?.selectionStart ?? draft.length;
    const end = textEl?.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    const after = draft.slice(end);

    // Kiểm tra xem trước đó đã có khoảng trắng hoặc đầu chuỗi chưa
    const needsPrefixSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
    const prefix = needsPrefixSpace ? `${before} ` : before;

    // Kiểm tra xem sau đó đã có khoảng trắng chưa
    const needsSuffixSpace = after.length === 0 || !after.startsWith(' ');
    const mentionText = `@${name}${needsSuffixSpace ? ' ' : ''}`;

    const nextDraft = `${prefix}${mentionText}${after}`;
    const nextCaret = prefix.length + mentionText.length;

    setDraft(nextDraft);
    setMention(undefined);
    announceTyping(nextDraft.trim().length > 0);

    requestAnimationFrame(() => {
      textEl?.focus();
      textEl?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    // `mentions` là id NGƯỜI DÙNG thật, rút bằng đúng bộ quét đã tô màu chữ xanh.
    onSend(body, extractMentionIds(body, participants), replyToId);
    setDraft('');
    setMention(undefined);
    setReplyToId(undefined);
    // Đã gửi: chữ "đang nhập" bên người khác phải tắt ngay, không chờ hết hạn.
    announceTyping(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Đang gõ dở bằng bộ gõ tiếng Việt (Telex/VNI): Enter chốt chữ, không phải lệnh.
    if (event.nativeEvent.isComposing) return;

    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const key = event.key;
        setActiveIndex((index) => nextActiveIndex(index, key, suggestions.length));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = suggestions[activeIndex] ?? suggestions[0];
        if (chosen) pickMention(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSuggestions();
        return;
      }
    }

    // Enter gửi, Shift+Enter xuống dòng — thói quen của mọi ứng dụng chat.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  // Chữ thật nằm ở lớp phản chiếu để tô màu được lượt nhắc; textarea trong suốt nằm đè lên để nhận phím.
  const draftParts = useMemo(
    () => splitByMentions(draft, scanMentions(draft, participants)),
    [draft, participants],
  );

  const nameOf = useCallback(
    (userId: string) =>
      participants.find((person) => person.id === userId)?.name ??
      instance.activity.find((entry) => entry.actorId === userId)?.actorName ??
      'Ai đó',
    [participants, instance.activity],
  );
  const typingNames = activeTypers(typers, Date.now()).map(nameOf);

  return (
    <article className={styles.panel}>
      <header className={styles.chatHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 className={styles.panelTitle}>Trao đổi &amp; Thảo luận</h3>
          <span
            className={styles.chatLive}
            data-state={live === undefined ? 'connecting' : live ? 'live' : 'offline'}
            role="status"
            title={
              live
                ? 'Đang nhận tin mới theo thời gian thực.'
                : live === undefined
                  ? 'Đang kết nối kênh thời gian thực.'
                  : 'Mất kết nối thời gian thực. Tin mới vẫn được cập nhật định kỳ khoảng 30 giây; sẽ tự nối lại.'
            }
          >
            <i aria-hidden />
            {live ? 'Trực tiếp' : live === undefined ? 'Đang kết nối' : 'Mất kết nối'}
          </span>
        </div>
        <span className={styles.chatSummaryBadge}>{comments.length} tin nhắn</span>
      </header>

      <div className={styles.chatFeed}>
        {entries.map((entry: ProcedureActivity, index) => {
          const previous = entries[index - 1];
          const showDay =
            index === 0 || dayLabel(previous.createdAt) !== dayLabel(entry.createdAt);
          return (
            <div key={entry.id} className={styles.chatFeedItem}>
              {showDay ? (
                <div className={styles.chatDayDivider}>
                  <span>{dayLabel(entry.createdAt)}</span>
                </div>
              ) : null}
              <ThreadNode
                entry={entry}
                depth={0}
                childrenOf={childrenOf}
                orphan={Boolean(entry.replyToId)}
                people={participants}
                canComment={canComment}
                onReply={(id) => {
                  setReplyToId(id);
                  textarea.current?.focus();
                }}
              />
            </div>
          );
        })}
        {comments.length === 0 ? (
          <div className={styles.chatEmpty}>
            <p>Chưa có trao đổi nào.</p>
          </div>
        ) : null}
      </div>

      {visible < roots.length ? (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setVisible((count) => count + PAGE)}
          >
            Xem tin nhắn cũ hơn ({roots.length - visible} mục)
          </button>
        </div>
      ) : null}

      {/* Luôn chiếm một dòng để chữ "đang nhập" hiện/tắt không làm bố cục nhảy. */}
      <p className={styles.chatTyping} role="status" aria-live="polite">
        {typingNames.length > 0 ? (
          <>
            {typingLabel(typingNames)}
            {/* Ba chấm nhấp nháy lần lượt; tắt hẳn khi người dùng chọn giảm chuyển động. */}
            <Ellipsis className={styles.typingDots} size={16} aria-hidden />
          </>
        ) : null}
      </p>

      {canComment ? (
        <div className={styles.composer}>
          {replyTo ? (
            <div className={styles.replyBar}>
              <span className={styles.replyBarText}>
                Trả lời <strong>{replyTo.actorName}</strong>: {replyTo.comment?.slice(0, 80)}
                {(replyTo.comment?.length ?? 0) > 80 ? '…' : ''}
              </span>
              <button
                type="button"
                className={styles.replyBarClose}
                aria-label="Bỏ trả lời"
                onClick={() => setReplyToId(undefined)}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className={styles.composerBox}>
            {/* Nổi ngay trên ô nhập, nên luôn sát chỗ đang gõ. */}
            {suggestions.length > 0 ? (
              <ul className={styles.mentionList} role="listbox" aria-label="Gợi ý nhắc người">
                {suggestions.map((person, index) => (
                  <li
                    key={person.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? styles.mentionActive : undefined}
                    ref={(element) => {
                      // Đi bằng phím tới mục nằm ngoài vùng cuộn thì kéo nó vào tầm nhìn.
                      if (index === activeIndex) element?.scrollIntoView({ block: 'nearest' });
                    }}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      className={styles.mentionItemBtn}
                      // Giữ focus ở ô nhập: nhấn nút không được làm mất vị trí con trỏ.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickMention(person);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span>{person.name}</span>
                      {person.hint ? <span className={styles.mentionHint}>{person.hint}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.composerInputWrap}>
              <div className={styles.composerMirror} ref={mirror} aria-hidden>
                {draftParts.map((part, index) =>
                  part.mention ? (
                    <span key={index} className={styles.mentionInline}>
                      {part.text}
                    </span>
                  ) : (
                    part.text
                  ),
                )}
                {/* Ký tự rộng 0 giữ chiều cao cho dòng trống cuối, như textarea. */}
                {'​'}
              </div>
              <textarea
                ref={textarea}
                rows={3}
                className={styles.composerTextarea}
                placeholder="Nhập trao đổi, gõ @ để nhắc một người…"
                value={draft}
                onChange={(event) =>
                  onDraftChange(event.target.value, event.target.selectionStart ?? event.target.value.length)
                }
                onKeyDown={onKeyDown}
                onBlur={closeSuggestions}
                onClick={onCaretMove}
                onSelect={onCaretMove}
                onScroll={(event) => {
                  if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
                }}
              />
            </div>
          </div>
          <div className={styles.composerFoot}>
            <span className={styles.composerHint}>
              {participants.length > 0 ? (
                <>
                  Có thể nhắc:{' '}
                  {participants.slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.mentionQuickChip}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => appendQuickMention(p.name)}
                    >
                      @{p.name}
                    </button>
                  ))}
                  {participants.length > 3 ? '…' : ''}
                </>
              ) : (
                ''
              )}
            </span>
            <button
              type="button"
              className={styles.composerSendBtn}
              disabled={busy === 'comment' || !draft.trim()}
              onClick={send}
            >
              Gửi tin nhắn
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.panelHint}>
          {instance.status === 'running'
            ? 'Bạn không có mặt trong hồ sơ này nên chỉ đọc được.'
            : 'Hồ sơ đã kết thúc — chỉ đọc lại được lịch sử trao đổi.'}
        </p>
      )}
    </article>
  );
}

/** Độ sâu tối đa còn thụt lề */
const MAX_INDENT = 3;

/**
 * Một mục trao đổi cùng toàn bộ nhánh trả lời bên dưới nó.
 */
function ThreadNode(props: {
  entry: ProcedureActivity;
  depth: number;
  childrenOf: ReadonlyMap<string, ProcedureActivity[]>;
  orphan: boolean;
  people: readonly ChatPerson[];
  canComment: boolean;
  onReply: (id: string) => void;
}) {
  const { entry, depth, childrenOf } = props;
  const replies = childrenOf.get(entry.id) ?? [];

  return (
    <div className={depth > 0 ? styles.threadChild : styles.threadRoot}>
      <div className={styles.chatMessageCard}>
        <div className={styles.chatMessageHead}>
          <div className={styles.chatSenderInfo}>
            <span className={styles.chatAvatar}>
              {entry.actorName.charAt(0).toUpperCase()}
            </span>
            <strong className={styles.chatSenderName}>{entry.actorName}</strong>
            <span className={styles.chatTimestamp}>
              {activityTime.format(new Date(entry.createdAt))}
            </span>
            {replies.length > 0 ? (
              <span className={styles.threadCount} title={`${replies.length} phản hồi`}>
                {replies.length}
              </span>
            ) : null}
          </div>

          {props.canComment ? (
            <button
              type="button"
              className={styles.replyIconButton}
              title="Trả lời"
              aria-label="Trả lời"
              onClick={() => props.onReply(entry.id)}
            >
              <Reply size={13} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>

        {props.orphan ? (
          <p className={styles.replyQuote}>
            <em>Trả lời một trao đổi không còn hiển thị.</em>
          </p>
        ) : null}

        {/* Message Body */}
        {entry.comment ? (
          <div className={styles.chatBubble}>
            {renderMentions(entry.comment, props.people)}
          </div>
        ) : null}
      </div>

      {replies.map((child) => (
        <ThreadNode
          key={child.id}
          entry={child}
          depth={Math.min(depth + 1, MAX_INDENT)}
          childrenOf={childrenOf}
          orphan={false}
          people={props.people}
          canComment={props.canComment}
          onReply={props.onReply}
        />
      ))}
    </div>
  );
}
