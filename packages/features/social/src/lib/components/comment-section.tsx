'use client';

import {
  SOCIAL_COMMENT_MAX,
  type SocialComment,
  type SocialMe,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { AtSign, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import extras from '../post-extras.module.scss';
import {
  createComment,
  deleteComment,
  errorMessage,
  loadComments,
  updateComment,
} from '../social-api';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  formatFullTime,
  formatRelativeTime,
  mergePages,
  parseCommentBody,
  type MentionPick,
} from '../social.model';
import styles from '../social.module.scss';
import { PeopleList, usePeopleSearch } from './people-picker';
import { Avatar, ConfirmDialog, userSubtitle } from './ui';

/* ------------------------------------------------------------- ô nhập */

interface CommentInputProps {
  readonly initialText?: string;
  readonly initialPicks?: readonly MentionPick[];
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly autoFocus?: boolean;
  /** Hiện ảnh người đang nhập ở đầu thanh (ô bình luận chính). */
  readonly avatar?: SocialUserRef;
  readonly onSubmit: (body: string, mentionUserIds: readonly string[]) => Promise<void>;
  readonly onCancel?: () => void;
}

function CommentInput({
  initialText = '',
  initialPicks = [],
  placeholder,
  submitLabel,
  autoFocus = false,
  avatar,
  onSubmit,
  onCancel,
}: CommentInputProps) {
  const [text, setText] = useState(initialText);
  const [picks, setPicks] = useState<readonly MentionPick[]>(initialPicks);
  const [caret, setCaret] = useState(initialText.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);

  const mention = activeMentionQuery(text, caret);
  const { people, loading } = usePeopleSearch(mention?.query ?? '', Boolean(mention));

  useEffect(() => {
    if (autoFocus && area.current) {
      area.current.focus();
      area.current.setSelectionRange(initialText.length, initialText.length);
    }
  }, [autoFocus, initialText.length]);

  const pick = (user: SocialUserRef) => {
    if (!mention) return;
    const insert = `@${user.name} `;
    const next = `${text.slice(0, mention.start)}${insert}${text.slice(caret)}`;
    const position = mention.start + insert.length;
    setText(next);
    setCaret(position);
    setPicks((list) => (list.some((item) => item.id === user.id) ? list : [...list, { id: user.id, name: user.name }]));
    window.requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const encoded = encodeMentions(trimmed, picks);
    if (encoded.body.length > SOCIAL_COMMENT_MAX) {
      setError(`Bình luận tối đa ${SOCIAL_COMMENT_MAX.toLocaleString('vi-VN')} ký tự.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(encoded.body, encoded.userIds);
      setText('');
      setPicks([]);
      setCaret(0);
      if (area.current) area.current.style.height = 'auto';
    } catch (cause) {
      setError(errorMessage(cause, 'Không gửi được bình luận.'));
    } finally {
      setBusy(false);
    }
  };

  const grow = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  };

  const insertAt = () => {
    const position = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, position)}@${text.slice(position)}`;
    setText(next);
    setCaret(position + 1);
    window.requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position + 1, position + 1);
    });
  };

  const canSend = !busy && text.trim().length > 0;

  return (
    <div className={styles.commentInput}>
      <div className={extras.commentBar}>
        {avatar ? <Avatar user={avatar} size={28} /> : null}
        <div className={extras.commentField}>
          <textarea
            ref={area}
            className={extras.commentTextarea}
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setCaret(event.target.selectionStart);
              grow(event.target);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
              if (event.key === 'Escape' && mention) {
                event.stopPropagation();
                setCaret(0);
              }
            }}
          />
          <button
            type="button"
            className={extras.commentTool}
            aria-label="Nhắc đến một người"
            title="Nhắc đến (@)"
            disabled={busy}
            onClick={insertAt}
          >
            <AtSign size={16} />
          </button>
          <button
            type="button"
            className={extras.commentSend}
            aria-label={submitLabel}
            title={`${submitLabel} (Ctrl+Enter)`}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
      {mention ? (
        <div className={styles.suggestPanel}>
          <PeopleList people={people} loading={loading} onPick={pick} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={styles.fieldError}>
          {error}
        </p>
      ) : null}
      {onCancel ? (
        <div className={styles.commentActions}>
          <button type="button" className={styles.buttonSmall} onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- một dòng */

interface CommentRowProps {
  readonly comment: SocialComment;
  readonly canComment: boolean;
  readonly onReply: (comment: SocialComment) => void;
  readonly onChanged: (comment: SocialComment) => void;
  readonly onRemoved: (comment: SocialComment) => void;
  /** Bình luận đích từ liên kết thông báo: làm nổi và cuộn tới. */
  readonly highlight?: boolean;
}

function CommentRow({ comment, canComment, onReply, onChanged, onRemoved, highlight = false }: CommentRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const decoded = editing ? decodeMentions(comment.body, comment.mentions) : undefined;

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await deleteComment(comment.id);
      setConfirming(false);
      onRemoved(comment);
    } catch (cause) {
      setError(errorMessage(cause, 'Không xoá được bình luận.'));
    } finally {
      setBusy(false);
    }
  };

  if (comment.deleted) {
    return (
      <div className={styles.comment}>
        <Avatar user={comment.author} size={30} />
        <div className={styles.commentMain}>
          <p className={styles.commentDeleted}>Bình luận đã bị xoá.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.comment} ref={rowRef} data-highlight={highlight}>
      <Avatar user={comment.author} size={30} />
      <div className={styles.commentMain}>
        {editing && decoded ? (
          <CommentInput
            initialText={decoded.text}
            initialPicks={decoded.picks}
            placeholder="Sửa bình luận"
            submitLabel="Lưu"
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (body, mentionUserIds) => {
              const saved = await updateComment(comment.id, { body, mentionUserIds });
              setEditing(false);
              onChanged(saved);
            }}
          />
        ) : (
          <>
            <div className={styles.commentBubble}>
              <span className={styles.commentAuthor} title={userSubtitle(comment.author) || undefined}>
                {comment.author.name}
              </span>
              <p className={styles.commentBody}>
                {parseCommentBody(comment.body, comment.mentions).map((part, index) =>
                  part.type === 'mention' ? (
                    <span key={`${part.userId}-${index}`} className={styles.mention}>
                      @{part.name}
                    </span>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </p>
            </div>
            <div className={styles.commentMeta}>
              <time dateTime={comment.createdAt} title={formatFullTime(comment.createdAt)}>
                {formatRelativeTime(comment.createdAt)}
              </time>
              {comment.editedAt ? <span title={formatFullTime(comment.editedAt)}>Đã sửa</span> : null}
              {canComment ? (
                <button type="button" className={styles.linkButton} onClick={() => onReply(comment)}>
                  Trả lời
                </button>
              ) : null}
              {comment.capabilities.canEdit ? (
                <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>
                  Sửa
                </button>
              ) : null}
              {comment.capabilities.canDelete ? (
                <button type="button" className={styles.linkButton} onClick={() => setConfirming(true)}>
                  Xoá
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Xoá bình luận"
        message="Bình luận sẽ bị xoá và không khôi phục được. Bạn có chắc chắn?"
        confirmLabel="Xoá"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------ bình luận gốc + trả lời */

interface RootCommentProps {
  readonly postId: string;
  readonly comment: SocialComment;
  readonly canComment: boolean;
  readonly onChanged: (comment: SocialComment) => void;
  readonly onRemoved: (comment: SocialComment) => void;
  readonly onCountChange: (delta: number) => void;
  readonly focusId?: string;
}

function RootComment({ postId, comment, canComment, onChanged, onRemoved, onCountChange, focusId }: RootCommentProps) {
  const [replies, setReplies] = useState<readonly SocialComment[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [replyTo, setReplyTo] = useState<SocialUserRef>();
  const [replying, setReplying] = useState(false);

  const fetchReplies = useCallback(
    async (from?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await loadComments(postId, { parentId: comment.id, cursor: from });
        setReplies((list) => (from ? mergePages(list, page.items) : page.items));
        setCursor(page.nextCursor);
      } catch (cause) {
        setError(errorMessage(cause, 'Không tải được các trả lời.'));
      } finally {
        setLoading(false);
      }
    },
    [postId, comment.id],
  );

  const showReplies = () => {
    setExpanded(true);
    void fetchReplies();
  };

  // Đích là một trả lời thì mở sẵn các trả lời để tìm thấy nó.
  const needsReplies = Boolean(focusId && focusId !== comment.id && comment.replyCount > 0);
  useEffect(() => {
    if (needsReplies) {
      setExpanded(true);
      void fetchReplies();
    }
  }, [needsReplies, fetchReplies]);

  const startReply = (target: SocialComment) => {
    setReplyTo(target.author);
    setReplying(true);
    if (!expanded && comment.replyCount > 0) showReplies();
  };

  const replyDraft: MentionPick[] =
    replyTo && replyTo.id !== comment.author.id ? [{ id: replyTo.id, name: replyTo.name }] : [];
  // Trả lời bình luận gốc thì không cần nhắc tên; trả lời một trả lời thì nhắc người đó.
  const replyKey = `${comment.id}-${replyTo?.id ?? 'root'}`;

  return (
    <li className={styles.thread}>
      <CommentRow
        comment={comment}
        canComment={canComment}
        onReply={startReply}
        onChanged={onChanged}
        onRemoved={onRemoved}
        highlight={focusId === comment.id}
      />
      <div className={styles.replies}>
        {comment.replyCount > 0 && !expanded ? (
          <button type="button" className={styles.linkButton} onClick={showReplies}>
            Xem {comment.replyCount.toLocaleString('vi-VN')} trả lời
          </button>
        ) : null}
        {expanded ? (
          <>
            <ul className={styles.commentList}>
              {replies.map((reply) => (
                <li key={reply.id}>
                  <CommentRow
                    comment={reply}
                    canComment={canComment}
                    highlight={focusId === reply.id}
                    onReply={startReply}
                    onChanged={(next) => setReplies((list) => list.map((item) => (item.id === next.id ? next : item)))}
                    onRemoved={(removed) => {
                      setReplies((list) => list.filter((item) => item.id !== removed.id));
                      onChanged({ ...comment, replyCount: Math.max(0, comment.replyCount - 1) });
                      onCountChange(-1);
                    }}
                  />
                </li>
              ))}
            </ul>
            {loading ? <p className={styles.muted}>Đang tải…</p> : null}
            {error ? (
              <p role="alert" className={styles.fieldError}>
                {error}{' '}
                <button type="button" className={styles.linkButton} onClick={() => void fetchReplies(cursor)}>
                  Thử lại
                </button>
              </p>
            ) : null}
            {cursor && !loading ? (
              <button type="button" className={styles.linkButton} onClick={() => void fetchReplies(cursor)}>
                Xem thêm trả lời
              </button>
            ) : null}
          </>
        ) : null}
        {replying && canComment ? (
          <CommentInput
            key={replyKey}
            initialText={replyDraft.length > 0 ? `@${replyDraft[0]?.name} ` : ''}
            initialPicks={replyDraft}
            placeholder="Viết trả lời…"
            submitLabel="Trả lời"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={async (body, mentionUserIds) => {
              const created = await createComment(postId, { body, parentId: comment.id, mentionUserIds });
              if (!expanded) {
                setExpanded(true);
                await fetchReplies();
              } else {
                setReplies((list) => mergePages(list, [created]));
              }
              onChanged({ ...comment, replyCount: comment.replyCount + 1 });
              onCountChange(1);
              setReplying(false);
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

/* ----------------------------------------------------------------- cả luồng */

export interface CommentSectionProps {
  readonly postId: string;
  readonly me: SocialMe;
  readonly canComment: boolean;
  /** Bài đã tắt bình luận: ẩn ô nhập, hiện ghi chú; bình luận cũ vẫn đọc được. */
  readonly commentsDisabled?: boolean;
  /** Số bình luận của bài đổi (thêm +1, xoá −1) để thẻ bài cập nhật con số. */
  readonly onCountChange: (delta: number) => void;
  /** Bình luận đích từ liên kết thông báo. */
  readonly focusCommentId?: string;
}

/** Luồng bình luận hai cấp của một bài: tải khi mở, phân trang bằng con trỏ. */
export function CommentSection({ postId, me, canComment, commentsDisabled = false, onCountChange, focusCommentId }: CommentSectionProps) {
  const [items, setItems] = useState<readonly SocialComment[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const fetchPage = useCallback(
    async (from?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await loadComments(postId, { cursor: from });
        setItems((list) => (from ? mergePages(list, page.items) : page.items));
        setCursor(page.nextCursor);
      } catch (cause) {
        setError(errorMessage(cause, 'Không tải được bình luận.'));
      } finally {
        setLoading(false);
      }
    },
    [postId],
  );

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // Đích chưa thấy trong trang đầu thì nạp thêm vài trang (đích có thể là trả lời nên không chắc có ở bình luận gốc).
  const autoPages = useRef(0);
  useEffect(() => {
    if (!focusCommentId || loading || !cursor || autoPages.current >= 3) return;
    if (items.some((item) => item.id === focusCommentId)) return;
    autoPages.current += 1;
    void fetchPage(cursor);
  }, [focusCommentId, loading, cursor, items, fetchPage]);

  return (
    <section className={styles.comments} aria-label="Bình luận">
      {commentsDisabled ? (
        <p className={extras.commentsOff} role="note">
          Tính năng bình luận của bài viết này đã bị tắt.
        </p>
      ) : null}
      {canComment ? (
        <CommentInput
          avatar={me.user}
          placeholder="Viết bình luận… (gõ @ để nhắc tên)"
          submitLabel="Gửi"
          onSubmit={async (body, mentionUserIds) => {
            const created = await createComment(postId, { body, mentionUserIds });
            setItems((list) => mergePages(list, [created]));
            onCountChange(1);
          }}
        />
      ) : null}
      {items.length > 0 ? (
        <ul className={styles.commentList}>
          {items.map((comment) => (
            <RootComment
              key={comment.id}
              postId={postId}
              comment={comment}
              canComment={canComment}
              focusId={focusCommentId}
              onCountChange={onCountChange}
              onChanged={(next) => setItems((list) => list.map((item) => (item.id === next.id ? next : item)))}
              onRemoved={(removed) => {
                onCountChange(-1);
                setItems((list) =>
                  removed.replyCount > 0
                    ? list.map((item) => (item.id === removed.id ? { ...item, deleted: true, body: '' } : item))
                    : list.filter((item) => item.id !== removed.id),
                );
              }}
            />
          ))}
        </ul>
      ) : null}
      {loading ? <p className={styles.muted}>Đang tải bình luận…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className={styles.muted}>Chưa có bình luận nào.</p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}{' '}
          <button type="button" className={styles.linkButton} onClick={() => void fetchPage(cursor)}>
            Thử lại
          </button>
        </p>
      ) : null}
      {cursor && !loading ? (
        <button type="button" className={styles.linkButton} onClick={() => void fetchPage(cursor)}>
          Xem thêm bình luận
        </button>
      ) : null}
    </section>
  );
}
