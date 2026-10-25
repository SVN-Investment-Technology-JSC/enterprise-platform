'use client';

import {
  SOCIAL_ACTIVITY_LABELS,
  SOCIAL_REACTION_LABELS,
  SOCIAL_REACTION_TYPES,
  type SocialAttachment,
  type SocialMe,
  type SocialPost,
  type SocialReactionType,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import {
  Bookmark,
  Download,
  File as FileIcon,
  MessageSquare,
  MessageSquareOff,
  ThumbsUp,
} from 'lucide-react';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  deletePost,
  errorMessage,
  loadPost,
  loadReactors,
  pinPost,
  setReaction,
  updatePost,
} from '../social-api';
import {
  formatBytes,
  formatFullTime,
  formatRelativeTime,
} from '../social.model';
import { isPublished } from '../post-extras.model';
import extras from '../post-extras.module.scss';
import {
  buildPostMenu,
  type PostMenuAction,
} from '../post-visibility.model';
import { SocialLink } from '../social-navigation';
import { setBookmark } from '../social-posts-api';
import styles from '../social.module.scss';
import { CommentSection } from './comment-section';
import { PostPoll } from './poll/post-poll';
import { galleryItemsFromAttachments, MediaGallery } from './media-gallery';
import { PostEditHistoryDialog } from './post-edit-history-dialog';
import { ReactorsDialog } from './reactors-dialog';
import { PostMenu } from './post-menu';
import {
  GroupTag,
  PostStatusBadges,
  VisibilityBadge,
} from './post-status-badge';
import { ReadConfirmationBlock } from './read-confirmation';
import {
  Avatar,
  ConfirmDialog,
  Dialog,
  REACTION_ICONS,
  userSubtitle,
} from './ui';

/** Chiều cao tối đa của nội dung khi chưa bấm "Xem thêm" (px). */
const CLAMP_HEIGHT = 168;

/* ------------------------------------------------------------ nội dung HTML */

function ClampedHtml({ html }: { readonly html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Liên kết trong bài luôn mở sang thẻ mới.
    for (const anchor of Array.from(element.querySelectorAll('a'))) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    setOverflowing(element.scrollHeight > CLAMP_HEIGHT + 6);
  }, [html]);

  return (
    <div>
      <div
        ref={ref}
        className={`${styles.richBody} ${styles.postBody}`}
        style={expanded ? undefined : { maxHeight: CLAMP_HEIGHT }}
        data-clamped={!expanded && overflowing}
        // HTML đã được server làm sạch (hợp đồng `SocialPost.bodyHtml`).
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflowing ? (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Thu gọn' : 'Xem thêm'}
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- ảnh và tệp */

function FileList({ files }: { readonly files: readonly SocialAttachment[] }) {
  return (
    <ul className={styles.fileList}>
      {files.map((file) => {
        const content = (
          <>
            <FileIcon size={16} />
            <span className={styles.fileName}>{file.fileName}</span>
            <span className={styles.fileSize}>
              {formatBytes(file.sizeBytes)}
            </span>
            {file.url ? <Download size={14} /> : null}
          </>
        );
        return (
          <li key={file.id}>
            {file.url ? (
              <a
                className={styles.fileItem}
                href={file.url}
                download={file.fileName}
                rel="noopener noreferrer"
              >
                {content}
              </a>
            ) : (
              <span className={styles.fileItem}>{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- phản ứng */

function MentionsDialog({
  mentions,
  mentionsAll,
  onClose,
}: {
  readonly mentions?: readonly SocialUserRef[];
  readonly mentionsAll?: boolean;
  readonly onClose: () => void;
}) {
  const items = mentions ?? [];
  return (
    <Dialog open title="Người được nhắc đến" onClose={onClose}>
      {mentionsAll ? (
        <div className={extras.mentionAllBanner}>
          <strong>@Tất cả</strong>: Bài viết nhắc đến toàn bộ thành viên trong công ty.
        </div>
      ) : null}
      {items.length === 0 && !mentionsAll ? (
        <p className={styles.muted}>Không có người được nhắc đến.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className={styles.reactorList}>
          {items.map((user) => (
            <li key={user.id} className={styles.reactor}>
              <Avatar user={user} size={32} />
              <span className={styles.suggestText}>
                <SocialLink
                  to={{ name: 'profile', userId: user.id }}
                  className={styles.suggestName}
                  onClick={onClose}
                >
                  {user.name}
                </SocialLink>
                {userSubtitle(user) ? (
                  <span className={styles.suggestMeta}>{userSubtitle(user)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

function PostMentions({
  mentions,
  mentionsAll,
  onOpenMentions,
}: {
  readonly mentions?: readonly SocialUserRef[];
  readonly mentionsAll?: boolean;
  readonly onOpenMentions: () => void;
}) {
  const items = mentions ?? [];
  const hasMentionsAll = Boolean(mentionsAll);
  if (!hasMentionsAll && items.length === 0) return null;

  return (
    <span className={extras.mentionInline}>
      <span className={extras.mentionPrefix}> cùng với </span>
      {hasMentionsAll ? (
        <>
          <span className={extras.mentionAllBadge} title="Tất cả thành viên trong công ty">
            @Tất cả
          </span>
          {items.length > 0 ? <span className={extras.mentionPrefix}>, </span> : null}
        </>
      ) : null}
      {items.length === 1 ? (
        <SocialLink
          to={{ name: 'profile', userId: items[0].id }}
          className={extras.mentionLink}
        >
          {items[0].name}
        </SocialLink>
      ) : items.length === 2 ? (
        <>
          <SocialLink
            to={{ name: 'profile', userId: items[0].id }}
            className={extras.mentionLink}
          >
            {items[0].name}
          </SocialLink>
          <span className={extras.mentionPrefix}> và </span>
          <SocialLink
            to={{ name: 'profile', userId: items[1].id }}
            className={extras.mentionLink}
          >
            {items[1].name}
          </SocialLink>
        </>
      ) : items.length > 2 ? (
        <>
          <SocialLink
            to={{ name: 'profile', userId: items[0].id }}
            className={extras.mentionLink}
          >
            {items[0].name}
          </SocialLink>
          <span className={extras.mentionPrefix}> và </span>
          <button
            type="button"
            className={extras.mentionMoreBtn}
            onClick={onOpenMentions}
          >
            {items.length - 1} người khác
          </button>
        </>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ thẻ bài */

export interface PostCardProps {
  readonly post: SocialPost;
  readonly me: SocialMe;
  readonly onChange: (post: SocialPost) => void;
  readonly onEdit: (post: SocialPost) => void;
  readonly onDeleted: (postId: string) => void;
  readonly onOpenTopic: (topicId: string) => void;
  /** Báo lỗi thao tác nhanh (ghim, phản ứng) cho màn hình hiện thông báo. */
  readonly onError: (message: string) => void;
  /** Mở sẵn luồng bình luận (liên kết từ thông báo). */
  readonly defaultCommentsOpen?: boolean;
  readonly focusCommentId?: string;
  /** Đang ở trang chính bài này: ẩn mục "Xem chi tiết" trong menu. */
  readonly isDetailPage?: boolean;
}

export function PostCard({
  post,
  me,
  onChange,
  onEdit,
  onDeleted,
  onOpenTopic,
  onError,
  defaultCommentsOpen = false,
  focusCommentId,
  isDetailPage = false,
}: PostCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const { capabilities } = post;
  const canReact = me.permissions.includes('social.post.write');
  const published = isPublished(post);
  const activity = post.activity;
  const menuItems = buildPostMenu(post).filter((item) => !(isDetailPage && item.action === 'detail'));
  const commentsDisabled = Boolean(post.commentsDisabled);
  const mediaItems = galleryItemsFromAttachments(post.attachments);
  const files = post.attachments.filter((item) => !item.isImage && !item.isVideo);

  /**
   * Tải lại bài để lấy URL video mới (URL sống 1 giờ) hoặc khi video đang xử lý đã xong. Trả Promise để nơi gọi
   * không gọi chồng; lần làm mới nền (`silent`) không báo lỗi.
   */
  const refreshPost = useCallback(
    async (options?: { readonly silent?: boolean }) => {
      try {
        onChange(await loadPost(post.id));
      } catch (cause) {
        if (!options?.silent) onError(errorMessage(cause, 'Không tải lại được video.'));
      }
    },
    [post.id, onChange, onError],
  );

  const react = useCallback(
    async (type: SocialReactionType | null) => {
      try {
        const summary = await setReaction(post.id, type);
        onChange({ ...post, ...summary });
      } catch (cause) {
        onError(errorMessage(cause, 'Không gửi được phản ứng.'));
      }
    },
    [post, onChange, onError],
  );

  const toggleBookmark = async () => {
    const next = !post.bookmarked;
    try {
      const state = await setBookmark(post.id, next);
      onChange({ ...post, bookmarked: state.bookmarked });
    } catch (cause) {
      onError(
        errorMessage(
          cause,
          next ? 'Không lưu được bài.' : 'Không bỏ lưu được bài.',
        ),
      );
    }
  };

  const togglePin = async () => {
    try {
      onChange(await pinPost(post.id, !post.pinned));
    } catch (cause) {
      onError(
        errorMessage(
          cause,
          post.pinned ? 'Không bỏ ghim được bài.' : 'Không ghim được bài.',
        ),
      );
    }
  };

  const toggleComments = async () => {
    try {
      onChange(await updatePost(post.id, { commentsDisabled: !commentsDisabled }));
    } catch (cause) {
      onError(
        errorMessage(
          cause,
          commentsDisabled
            ? 'Không bật được bình luận.'
            : 'Không tắt được bình luận.',
        ),
      );
    }
  };

  const onMenuAction = (action: Exclude<PostMenuAction, 'detail'>) => {
    if (action === 'pin') void togglePin();
    else if (action === 'toggleComments') void toggleComments();
    else if (action === 'history') setHistoryOpen(true);
    else if (action === 'edit') onEdit(post);
    else setConfirming(true);
  };

  const remove = async () => {
    setBusy(true);
    setDeleteError(undefined);
    try {
      await deletePost(post.id);
      setConfirming(false);
      onDeleted(post.id);
    } catch (cause) {
      setDeleteError(errorMessage(cause, 'Không xoá được bài viết.'));
    } finally {
      setBusy(false);
    }
  };

  const reactionTypes = SOCIAL_REACTION_TYPES.filter(
    (type) => (post.reactionCounts[type] ?? 0) > 0,
  ).sort(
    (a, b) => (post.reactionCounts[b] ?? 0) - (post.reactionCounts[a] ?? 0),
  );
  const MyIcon = post.myReaction ? REACTION_ICONS[post.myReaction] : ThumbsUp;

  return (
    <article
      className={`${styles.post} ${extras.postCompact}`}
      data-pinned={post.pinned}
      data-status={post.status ?? 'published'}
    >
      <header className={styles.postHead}>
        <Avatar user={post.author} size={38} />
        <div className={styles.postWho}>
          <div className={extras.authorLine}>
            <SocialLink
              to={{ name: 'profile', userId: post.author.id }}
              className={`${styles.postAuthor} ${extras.authorLink}`}
            >
              {post.author.name}
            </SocialLink>
            <PostMentions
              mentions={post.mentions}
              mentionsAll={post.mentionsAll}
              onOpenMentions={() => setMentionsOpen(true)}
            />
          </div>
          <span className={extras.metaLine}>
            {userSubtitle(post.author) ? (
              <span className={extras.metaRole}>
                {userSubtitle(post.author)}
              </span>
            ) : null}
            <time
              dateTime={post.publishedAt}
              title={formatFullTime(post.publishedAt)}
            >
              {formatRelativeTime(post.publishedAt)}
            </time>
            {post.editedAt ? (
              <span title={formatFullTime(post.editedAt)}>Đã chỉnh sửa</span>
            ) : null}
            <VisibilityBadge post={post} />
          </span>
        </div>
        <div className={styles.postBadges}>
          <PostStatusBadges post={post} />
        </div>
        <PostMenu
          postId={post.id}
          items={menuItems}
          pinned={post.pinned}
          commentsDisabled={commentsDisabled}
          onAction={onMenuAction}
        />
      </header>

      {post.group ? <GroupTag group={post.group} /> : null}
      {post.topic ? (
        <button
          type="button"
          className={styles.topicTag}
          onClick={() => onOpenTopic(post.topic?.id ?? '')}
        >
          {post.topic.name}
        </button>
      ) : null}
      {post.status === 'rejected' && post.rejectReason ? (
        <div className={extras.rejectNote} role="note">
          <strong>Lý do từ chối</strong>
          <p>{post.rejectReason}</p>
        </div>
      ) : null}
      {post.status === 'pending' ? (
        <p className={extras.stateNote}>
          Bài đang chờ kiểm duyệt viên xem xét. Sau khi được duyệt, bài sẽ hiện
          trên bảng tin.
        </p>
      ) : null}
      {activity ? (
        <div className={extras.activity}>
          <span className={extras.activityText}>
            <span>
              <strong>{post.author.name}</strong>{' '}
              {SOCIAL_ACTIVITY_LABELS[activity.type] ?? 'có hoạt động mới'}
            </span>
          </span>
          {activity.type === 'avatar.updated' && post.author.avatarUrl ? (
            <img
              className={extras.activityPreview}
              src={post.author.avatarUrl}
              alt=""
            />
          ) : null}
        </div>
      ) : (
        <>
          {post.title ? (
            <h3 className={styles.postTitle}>{post.title}</h3>
          ) : null}
          {post.bodyHtml ? <ClampedHtml html={post.bodyHtml} /> : null}
        </>
      )}

      {mediaItems.length > 0 ? (
        <MediaGallery
          items={mediaItems}
          layout={post.mediaLayout ?? 'auto'}
          onRequestRefresh={refreshPost}
        />
      ) : null}
      {files.length > 0 ? <FileList files={files} /> : null}
      {post.poll ? (
        <PostPoll
          postId={post.id}
          poll={post.poll}
          readOnly={!published}
          canClose={Boolean(capabilities.canClosePoll)}
          onChange={(poll) => onChange({ ...post, poll })}
          onError={onError}
        />
      ) : null}
      {post.readConfirmation ? (
        <ReadConfirmationBlock
          post={post}
          summary={post.readConfirmation}
          published={published}
          onChange={(readConfirmation) =>
            onChange({ ...post, readConfirmation })
          }
          onError={onError}
        />
      ) : null}

      {published && (post.reactionTotal > 0 || post.commentCount > 0) ? (
        <div className={styles.postStats}>
          {post.reactionTotal > 0 ? (
            <button
              type="button"
              className={styles.reactionSummary}
              onClick={() => setReactorsOpen(true)}
            >
              <span className={styles.reactionIcons}>
                {reactionTypes.map((type) => {
                  const Icon = REACTION_ICONS[type];
                  return (
                    <span
                      key={type}
                      className={styles.reactionDot}
                      data-type={type}
                    >
                      <Icon size={11} />
                    </span>
                  );
                })}
              </span>
              {post.reactionTotal.toLocaleString('vi-VN')}
            </button>
          ) : (
            <span />
          )}
          {post.commentCount > 0 ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setCommentsOpen((value) => !value)}
            >
              {post.commentCount.toLocaleString('vi-VN')} bình luận
            </button>
          ) : null}
        </div>
      ) : null}

      {published ? (
        <div className={styles.postActions}>
          <div className={styles.reactWrap}>
            <button
              type="button"
              className={styles.actionButton}
              data-active={Boolean(post.myReaction)}
              data-type={post.myReaction}
              disabled={!canReact}
              onClick={() => void react(post.myReaction ? null : 'like')}
            >
              <MyIcon size={16} />
              {post.myReaction
                ? SOCIAL_REACTION_LABELS[post.myReaction]
                : 'Thích'}
            </button>
            {canReact ? (
              <div
                className={styles.reactPicker}
                role="group"
                aria-label="Chọn phản ứng"
              >
                {SOCIAL_REACTION_TYPES.map((type) => {
                  const Icon = REACTION_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      className={styles.reactOption}
                      data-type={type}
                      data-selected={post.myReaction === type}
                      title={SOCIAL_REACTION_LABELS[type]}
                      aria-label={SOCIAL_REACTION_LABELS[type]}
                      onClick={() =>
                        void react(post.myReaction === type ? null : type)
                      }
                    >
                      <Icon size={18} />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.actionButton}
            data-active={commentsOpen}
            aria-expanded={commentsOpen}
            disabled={commentsDisabled && post.commentCount === 0}
            title={commentsDisabled ? 'Bình luận đã bị tắt' : undefined}
            onClick={() => setCommentsOpen((value) => !value)}
          >
            {commentsDisabled ? (
              <MessageSquareOff size={16} />
            ) : (
              <MessageSquare size={16} />
            )}{' '}
            Bình luận
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${post.bookmarked ? extras.bookmarkActive : ''}`}
            data-active={Boolean(post.bookmarked)}
            aria-pressed={Boolean(post.bookmarked)}
            onClick={() => void toggleBookmark()}
          >
            <Bookmark
              size={16}
              fill={post.bookmarked ? 'currentColor' : 'none'}
            />
            {post.bookmarked ? 'Đã lưu' : 'Lưu bài'}
          </button>
        </div>
      ) : null}

      {published && commentsOpen ? (
        <CommentSection
          postId={post.id}
          postAuthorId={post.author.id}
          me={me}
          canComment={capabilities.canComment && !commentsDisabled}
          commentsDisabled={commentsDisabled}
          focusCommentId={focusCommentId}
          onCountChange={(delta) =>
            onChange({
              ...post,
              commentCount: Math.max(0, post.commentCount + delta),
            })
          }
        />
      ) : null}

      {historyOpen ? (
        <PostEditHistoryDialog
          postId={post.id}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {reactorsOpen ? (
        <ReactorsDialog
          load={() => loadReactors(post.id)}
          onClose={() => setReactorsOpen(false)}
        />
      ) : null}
      {mentionsOpen ? (
        <MentionsDialog
          mentions={post.mentions}
          mentionsAll={post.mentionsAll}
          onClose={() => setMentionsOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Xoá bài viết"
        message="Bài viết cùng bình luận và phản ứng sẽ bị xoá. Bạn có chắc chắn?"
        confirmLabel="Xoá bài"
        busy={busy}
        error={deleteError}
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}
