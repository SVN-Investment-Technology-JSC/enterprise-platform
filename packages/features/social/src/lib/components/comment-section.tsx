'use client';

import {
  SOCIAL_COMMENT_MAX,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_REACTION_LABELS,
  type SocialAttachment,
  type SocialComment,
  type SocialMe,
  type SocialReactionType,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { Ellipsis, ImagePlus, PenLine, Pencil, RotateCw, SendHorizontal, ThumbsUp, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import extras from '../post-extras.module.scss';
import {
  attachmentErrorMessage,
  attachmentStatusApi,
  createComment,
  deleteComment,
  discardAttachment,
  discardAttachmentKeepalive,
  errorMessage,
  loadCommentReactors,
  loadComments,
  reactToComment,
  updateComment,
  uploadAttachment,
} from '../social-api';
import { isUploadAborted } from '../attachment-upload';
import { EmojiButton } from '../emoji/emoji-button';
import { insertAtSelection } from '../emoji/emoji-text';
import {
  exceedsCommentImageLimit,
  isCommentVideo,
  prepareCommentImage,
  probeVideo,
  validateCommentMedia,
  validateVideoDuration,
  withVideoContentType,
} from '../comment-media';
import { shouldSubmitOnEnter } from '../comment-keys';
import { findFreshComment } from '../comment-refresh';
import { useAttachmentStatuses } from '../use-attachment-statuses';
import { useUnsavedWork } from '../unsaved-work';
import { useUnsentAttachments } from '../use-unsent-attachments';
import {
  buildVideoWarning,
  collectUnfinishedVideos,
  hasFailedVideo,
  hasNonVideoUploading,
  hasUnfinishedVideos,
  isVideoPending,
  publishableAttachmentIds,
  VIDEO_NOTHING_LEFT_NOTE,
} from '../video-publish-gate';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  isMentionComplete,
  splitMentionTokens,
  formatFullTime,
  formatRelativeTime,
  mergePages,
  parseCommentBody,
  type MentionPick,
} from '../social.model';
import styles from '../social.module.scss';
import { ComposerVideoTile } from './composer-video-tile';
import { MentionLink } from './mention-link';
import { ImageGrid } from './image-grid';
import { PeopleList, usePeopleSearch } from './people-picker';
import { ReactionSummary } from './reaction-summary';
import { Popover, PopoverContent } from '../ui/popover';
import { ReactionIcon } from './reaction-icon';
import { ReactionPicker } from './reaction-picker';
import { Avatar, ConfirmDialog, userSubtitle } from './ui';
import { UserAvatar } from './user-avatar';
import { VideoAttachment } from './video-attachment';

/** Cách bỏ tệp chưa gửi: lời gọi thường khi gỡ tệp hay đóng ô, `keepalive` khi đóng tab. */
const UNSENT_DEPS = { discard: discardAttachment, discardKeepalive: discardAttachmentKeepalive };

/** Mã tác giả của bài đang xem: để gắn nhãn "Tác giả" cho bình luận của chính họ. */
const PostAuthorContext = createContext<string | undefined>(undefined);

/* ------------------------------------------------------------- ô nhập */

/** Một ảnh trong dải xem trước của ô nhập: đang tải, đã xong (có `attachment`) hoặc lỗi. */
interface PendingFile {
  readonly key: string;
  readonly fileName: string;
  readonly preview?: string;
  /** URL tạm của ảnh vừa chọn, phải thu hồi khi bỏ ảnh hoặc rời ô nhập. */
  readonly objectUrl?: string;
  readonly status: 'uploading' | 'done' | 'error';
  readonly isVideo?: boolean;
  readonly attachment?: SocialAttachment;
  readonly error?: string;
  /** Tiến trình tải lên, 0 đến 1. */
  readonly progress?: number;
  /** Mã tệp do server cấp ngay sau `initiate` (khi còn đang tải): để dọn khi gỡ hoặc đóng tab. */
  readonly ticketId?: string;
  /** Tệp gốc người dùng chọn; có thì ô lỗi mới thử lại được. */
  readonly original?: File;
  /** Bản đã nén (ảnh) hoặc đã kiểm đọc được (video): thử lại tải đúng bản này, khỏi nén lại. */
  readonly prepared?: File;
  /** Lỗi do tệp (không đọc được, quá lớn) thì không thử lại được, chỉ bỏ. */
  readonly retryable?: boolean;
}

const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Vòng tròn tiến trình kèm phần trăm, đặt giữa ô xem trước. */
function UploadProgress({ fraction }: { readonly fraction: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <span
      className={styles.commentProgress}
      role="progressbar"
      aria-label="Đang tải lên"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg viewBox="0 0 38 38" aria-hidden="true">
        <circle className={styles.commentProgressTrack} cx="19" cy="19" r={RING_RADIUS} />
        <circle
          className={styles.commentProgressValue}
          cx="19"
          cy="19"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
        />
      </svg>
      <span className={styles.commentProgressText}>{percent}%</span>
    </span>
  );
}

interface CommentInputProps {
  readonly initialText?: string;
  readonly initialPicks?: readonly MentionPick[];
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly autoFocus?: boolean;
  /** Hiện ảnh người đang nhập ở đầu thanh (ô bình luận chính). */
  readonly avatar?: SocialUserRef;
  /** Ảnh đã đính kèm sẵn (khi sửa bình luận). */
  readonly initialFiles?: readonly SocialAttachment[];
  readonly onSubmit: (
    body: string,
    mentionUserIds: readonly string[],
    attachmentIds: readonly string[],
  ) => Promise<void>;
  readonly onCancel?: () => void;
}

export function CommentInput({
  initialText = '',
  initialPicks = [],
  placeholder,
  submitLabel,
  autoFocus = false,
  avatar,
  initialFiles = [],
  onSubmit,
  onCancel,
}: CommentInputProps) {
  const [text, setText] = useState(initialText);
  const [picks, setPicks] = useState<readonly MentionPick[]>(initialPicks);
  const [caret, setCaret] = useState(initialText.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileCounter = useRef(0);
  const [dragging, setDragging] = useState(false);
  const mirror = useRef<HTMLDivElement>(null);
  const mirrorProbe = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<PendingFile[]>(() =>
    initialFiles.map((file) => ({
      key: file.id,
      fileName: file.fileName,
      preview: file.url,
      isVideo: file.isVideo === true,
      status: 'done' as const,
      attachment: file,
    })),
  );
  // Giữ danh sách mới nhất để thu hồi URL xem trước khi rời khỏi ô nhập.
  const filesRef = useRef(files);
  filesRef.current = files;
  // Tệp chưa gửi: cảnh báo khi rời trang, bỏ khi đóng tab hoặc gỡ ô nhập (chỉ tệp tải trong ô này, không phải tệp sửa).
  const unsent = useUnsentAttachments(UNSENT_DEPS);
  // Mỗi tệp đang tải có một AbortController để huỷ khi người dùng bỏ ô hoặc rời ô nhập.
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
      for (const file of filesRef.current) if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
    };
  }, []);

  const patchFile = (key: string, patch: Partial<PendingFile>) =>
    setFiles((list) => list.map((file) => (file.key === key ? { ...file, ...patch } : file)));

  const removeFile = (key: string) => {
    const target = filesRef.current.find((file) => file.key === key);
    const uploadingNow = controllers.current.has(key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    // Đang tải: huỷ tải đã kèm `abort` phía server. Đã tải xong (kể cả đang xử lý hay lỗi xử lý): bỏ ngay.
    if (key.startsWith('new-')) {
      const id = target?.attachment?.id ?? target?.ticketId;
      if (id) {
        if (uploadingNow && !target?.attachment) unsent.forget(id);
        else unsent.discard(id);
      }
    }
    setFiles((list) => {
      const target = list.find((file) => file.key === key);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      return list.filter((file) => file.key !== key);
    });
  };

  /**
   * Chuẩn bị (ảnh: nén; video: kiểm trình duyệt đọc được) rồi tải lên với tiến trình thật.
   * Tệp đã chuẩn bị thì dùng lại khi thử lại. Bị huỷ thì im lặng (ô đã được bỏ).
   */
  const startUpload = (key: string, original: File, isVideo: boolean, prepared?: File) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    const noun = isVideo ? 'video' : 'ảnh';
    let lastPercent = -1;
    const run = async () => {
      let ready = prepared;
      if (!ready) {
        if (isVideo) {
          // Trình duyệt không đọc được (HEVC, MOV) thì vẫn tải: server chuyển mã và quyết định.
          const probe = await probeVideo(original);
          const tooLong = validateVideoDuration(probe, original.name, 'comment');
          if (tooLong) {
            patchFile(key, { status: 'error', error: tooLong, retryable: false });
            return;
          }
          ready = withVideoContentType(original);
        } else {
          ready = await prepareCommentImage(original);
          if (exceedsCommentImageLimit(ready.size)) {
            patchFile(key, {
              status: 'error',
              error: `Ảnh "${original.name}" vẫn quá lớn sau khi nén.`,
              retryable: false,
            });
            return;
          }
        }
        if (controller.signal.aborted) return;
        patchFile(key, { prepared: ready });
      }
      const attachment = await uploadAttachment(ready, 'comment', {
        signal: controller.signal,
        onInitiated: ({ attachmentId, uploadId }) => {
          unsent.track(attachmentId, uploadId);
          patchFile(key, { ticketId: attachmentId });
        },
        onProgress: (fraction) => {
          const percent = Math.round(fraction * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          patchFile(key, { progress: fraction });
        },
      });
      // Người dùng đã gỡ ô hoặc đóng ô nhập trong lúc chờ `complete`: tệp tải xong muộn thì bỏ luôn.
      if (controller.signal.aborted) {
        unsent.discard(attachment.id);
        return;
      }
      patchFile(key, { status: 'done', attachment, progress: 1, original: undefined, prepared: undefined });
    };
    void run()
      .catch((cause) => {
        if (isUploadAborted(cause) || controller.signal.aborted) return;
        // Lần tải lỗi đã được `uploadAttachment` huỷ phía server: thôi theo dõi tệp này.
        const ticketId = filesRef.current.find((file) => file.key === key)?.ticketId;
        if (ticketId) unsent.forget(ticketId);
        patchFile(key, {
          status: 'error',
          retryable: true,
          ticketId: undefined,
          error: attachmentErrorMessage(cause, `Không tải được ${noun} "${original.name}".`),
        });
      })
      .finally(() => {
        if (controllers.current.get(key) === controller) controllers.current.delete(key);
      });
  };

  const retryFile = (key: string) => {
    const target = filesRef.current.find((file) => file.key === key);
    if (!target?.original || target.retryable === false || controllers.current.has(key)) return;
    patchFile(key, { status: 'uploading', error: undefined, progress: 0 });
    startUpload(key, target.original, target.isVideo === true, target.prepared);
  };

  /** Kiểm rồi tải từng tệp lên (ảnh được nén, video tải thẳng); tệp lỗi giữ lại trong dải xem trước để người dùng gỡ. */
  const addFiles = (incoming: readonly File[]) => {
    const rejected: string[] = [];
    let count = files.length;
    let videos = files.filter((file) => file.isVideo).length;
    for (const original of incoming) {
      const problem = validateCommentMedia(original, { count, videos }, 'comment');
      if (problem) {
        rejected.push(problem);
        continue;
      }
      const isVideo = isCommentVideo(original);
      count += 1;
      if (isVideo) videos += 1;
      fileCounter.current += 1;
      const key = `new-${fileCounter.current}`;
      const objectUrl = URL.createObjectURL(original);
      setFiles((list) => [
        ...list,
        { key, fileName: original.name, preview: objectUrl, objectUrl, isVideo, status: 'uploading', progress: 0, original },
      ]);
      startUpload(key, original, isVideo);
    }
    setError(rejected.length > 0 ? rejected.join(' ') : undefined);
  };

  // Video đã tải xong nhưng chưa `ready`: hỏi định kỳ trạng thái chuyển mã.
  const unfinishedVideoIds = files.flatMap((file) =>
    file.status === 'done' && file.isVideo && file.attachment && isVideoPending(file.attachment)
      ? [file.attachment.id]
      : [],
  );
  const latestStatus = useAttachmentStatuses(unfinishedVideoIds, attachmentStatusApi.status);
  const shown: readonly PendingFile[] = files.map((file) => {
    const latest = file.attachment ? latestStatus.get(file.attachment.id) : undefined;
    return file.attachment && latest ? { ...file, attachment: { ...file.attachment, ...latest } } : file;
  });
  // Video chưa xong KHÔNG chặn gửi: bấm gửi thì hỏi lại (hộp cảnh báo). Ảnh đang tải và video lỗi vẫn chặn.
  const unfinished = collectUnfinishedVideos(shown);
  const unfinishedAny = hasUnfinishedVideos(unfinished);
  const nonVideoUploading = hasNonVideoUploading(shown);
  const videoFailed = hasFailedVideo(shown);
  const failed = files.find((file) => file.status === 'error');
  const attachmentIds = publishableAttachmentIds(shown);
  // Đang soạn dở (khác nội dung ban đầu, hoặc đổi số tệp) thì chuyển trang qua tên được nhắc phải hỏi lại.
  useUnsavedWork(text !== initialText || files.length !== initialFiles.length);
  const segments = splitMentionTokens(text, picks);
  const hasMention = segments.some((segment) => segment.mention);
  const [warning, setWarning] = useState(false);
  // Video xong hoặc bị gỡ trong lúc hộp đang mở: không còn gì để cảnh báo.
  useEffect(() => {
    if (warning && !unfinishedAny) setWarning(false);
  }, [warning, unfinishedAny]);

  const mention = activeMentionQuery(text, caret);
  // Chưa gõ gì sau `@` thì không gọi server (server trả rỗng cho từ khoá rỗng) mà chỉ nhắc cách dùng.
  // Tên đã chọn xong (bấm "Trả lời" tự gắn tên, hoặc vừa chọn từ gợi ý) thì không mở bảng gợi ý nữa.
  const mentionDone = mention !== undefined && isMentionComplete(mention.query, picks);
  // Esc đóng bảng gợi ý cho đoạn `@` này (nhớ vị trí `@`), đến khi người dùng bắt đầu một `@` khác.
  const [dismissedStart, setDismissedStart] = useState<number>();
  useEffect(() => {
    if (mention === undefined) setDismissedStart(undefined);
  }, [mention]);
  const mentionOpen = mention !== undefined && !mentionDone && mention.start !== dismissedStart;
  const mentionQuery = mention?.query.trim() ?? '';
  const [active, setActive] = useState(0);
  const marker = useRef<HTMLSpanElement>(null);
  const { people, loading } = usePeopleSearch(mentionQuery, mentionOpen && mentionQuery.length > 0);
  // Danh sách đổi (gõ thêm chữ) thì quay về mục đầu.
  useEffect(() => setActive(0), [people, mentionQuery]);

  useEffect(() => {
    if (autoFocus && area.current) {
      area.current.focus();
      area.current.setSelectionRange(initialText.length, initialText.length);
    }
  }, [autoFocus, initialText.length]);

  const mentionStart = mention?.start;
  // Đổi `key` khi `@` mới bắt đầu để bộ định vị tính lại neo. Chỉ đổi lúc đang mở: đổi đúng lúc đóng sẽ dựng lại hộp
  // ở trạng thái đóng và hộp không bao giờ được gỡ khỏi trang.
  const popoverKey = useRef(0);
  if (mentionOpen && mentionStart !== undefined) popoverKey.current = mentionStart;
  // Lớp đo ẩn cuộn cùng ô nhập để dấu mốc (neo của bảng gợi ý) luôn nằm đúng chỗ `@`.
  useLayoutEffect(() => {
    if (mentionOpen && mirrorProbe.current && area.current) mirrorProbe.current.scrollTop = area.current.scrollTop;
  }, [mentionOpen, mentionStart, text]);
  const suggestible = mentionOpen && mentionQuery.length > 0 && people.length > 0;
  const activeIndex = Math.min(active, Math.max(people.length - 1, 0));

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

  const submit = async (confirmed = false) => {
    const trimmed = text.trim();
    if (busy || nonVideoUploading) return;
    if (!trimmed && attachmentIds.length === 0 && unfinished.uploading.length === 0) return;
    if (videoFailed) {
      setError('Có video xử lý lỗi. Hãy gỡ video đó rồi gửi lại.');
      return;
    }
    if (failed) {
      setError('Có tệp tải lên bị lỗi. Hãy bỏ tệp đó rồi gửi lại.');
      return;
    }
    const encoded = encodeMentions(trimmed, picks);
    if (encoded.body.length > SOCIAL_COMMENT_MAX) {
      setError(`Bình luận tối đa ${SOCIAL_COMMENT_MAX.toLocaleString('vi-VN')} ký tự.`);
      return;
    }
    if (!confirmed && unfinishedAny) {
      setWarning(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(encoded.body, encoded.userIds, attachmentIds);
      // Đã gắn vào bình luận: không còn là tệp chưa gửi, đừng bỏ khi ô nhập bị gỡ.
      unsent.forget(attachmentIds);
      setText('');
      setPicks([]);
      setCaret(0);
      for (const file of files) if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
      setFiles([]);
      if (area.current) area.current.style.height = 'auto';
    } catch (cause) {
      setError(attachmentErrorMessage(cause, 'Không gửi được bình luận.'));
    } finally {
      setBusy(false);
    }
  };

  const grow = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  };

  const insertEmoji = (emoji: string) => {
    const field = area.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? start;
    const result = insertAtSelection(text, start, end, emoji);
    setText(result.text);
    setCaret(result.caret);
    window.requestAnimationFrame(() => {
      if (!area.current) return;
      area.current.focus();
      area.current.setSelectionRange(result.caret, result.caret);
      grow(area.current);
    });
  };

  const canSend =
    !busy &&
    !nonVideoUploading &&
    !videoFailed &&
    (text.trim().length > 0 || attachmentIds.length > 0 || unfinished.uploading.length > 0);
  const sendHint = videoFailed
    ? 'Hãy gỡ video lỗi trước khi gửi.'
    : unfinished.processing.length > 0
      ? 'Video đang xử lý; bạn vẫn có thể gửi, video sẽ hiện khi xử lý xong.'
      : undefined;
  const nothingLeft = text.trim().length === 0 && attachmentIds.length === 0;
  const warningText = buildVideoWarning(unfinished, 'comment');

  /** "Vẫn gửi": huỷ và bỏ các video đang tải (đường huỷ sẵn có), rồi gửi kèm các tệp đã tải xong. */
  const sendAnyway = () => {
    setWarning(false);
    for (const file of filesRef.current) if (file.isVideo && file.status === 'uploading') removeFile(file.key);
    void submit(true);
  };

  return (
    <div
      className={styles.commentInput}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className={extras.commentBar}>
        {avatar ? <Avatar user={avatar} size={28} /> : null}
        <div className={extras.commentField}>
          <div className={extras.commentTextWrap}>
          {hasMention ? (
            // Lớp phía sau ô nhập: vẽ cùng chữ với tên được nhắc màu xanh; chữ của ô nhập được làm trong suốt.
            <div ref={mirror} className={extras.commentMirror} aria-hidden="true">
              {segments.map((segment, index) =>
                segment.mention ? (
                  <span key={index} className={extras.commentMirrorMention}>
                    {segment.text}
                  </span>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
              {'​'}
            </div>
          ) : null}
          {mentionOpen && mentionStart !== undefined ? (
            // Lớp đo ẩn: cùng chữ đến trước dấu `@`, rồi một dấu mốc để biết `@` nằm ở đâu (kể cả khi ô xuống dòng).
            <div ref={mirrorProbe} className={extras.commentMirror} style={{ visibility: 'hidden' }} aria-hidden="true">
              {text.slice(0, mentionStart)}
              <span ref={marker}>{'\u200b'}</span>
            </div>
          ) : null}
          <textarea
            ref={area}
            className={extras.commentTextarea}
            data-mirrored={hasMention || undefined}
            // Gạch đỏ chính tả vẽ theo chữ của ô nhập (đang trong suốt) sẽ lệch khỏi lớp tô màu.
            spellCheck={hasMention ? false : undefined}
            onScroll={(event) => {
              if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
            }}
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
            onPaste={(event) => {
              const media = Array.from(event.clipboardData.files).filter(
                (file) => file.type.startsWith('image/') || isCommentVideo(file),
              );
              if (media.length === 0) return;
              event.preventDefault();
              addFiles(media);
            }}
            onKeyDown={(event) => {
              // Bảng gợi ý đang mở và có người: lên/xuống chọn, Enter hoặc Tab nhận người đang chọn.
              if (suggestible) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setActive((current) => (current + step + people.length) % people.length);
                  return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  pick(people[activeIndex] as SocialUserRef);
                  return;
                }
              }
              if (shouldSubmitOnEnter(event.nativeEvent)) {
                event.preventDefault();
                void submit();
              }
              if (event.key === 'Escape' && mentionOpen) {
                event.stopPropagation();
                setDismissedStart(mention?.start);
              }
            }}
          />
          </div>
          <EmojiButton className={extras.commentTool} disabled={busy} onPick={insertEmoji} />
          <button
            type="button"
            className={extras.commentTool}
            aria-label="Đính kèm ảnh hoặc video"
            title="Đính kèm ảnh hoặc video (hoặc dán, kéo thả)"
            disabled={busy || files.length >= SOCIAL_COMMENT_MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={16} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov"
            multiple
            hidden
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={extras.commentSend}
            aria-label={submitLabel}
            title={sendHint ?? `${submitLabel} (Enter; Shift+Enter để xuống dòng)`}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
      {files.length > 0 ? (
        <ul className={styles.commentFiles} aria-label="Tệp đính kèm">
          {shown.map((file) =>
            file.isVideo ? (
              <li key={file.key}>
                <ComposerVideoTile
                  fileName={file.fileName}
                  previewUrl={file.preview}
                  status={file.status}
                  progress={file.progress}
                  attachment={file.attachment}
                  error={file.error}
                  retryable={Boolean(file.original) && file.retryable !== false}
                  disabled={busy}
                  onRemove={() => removeFile(file.key)}
                  onRetry={() => retryFile(file.key)}
                />
              </li>
            ) : (
            <li key={file.key} className={styles.commentFile} data-status={file.status} title={file.error}>
              {file.preview ? (
                <img src={file.preview} alt={file.fileName} />
              ) : null}
              {file.status === 'uploading' ? <UploadProgress fraction={file.progress ?? 0} /> : null}
              {file.status === 'error' && file.original && file.retryable !== false ? (
                <button
                  type="button"
                  className={styles.commentFileRetry}
                  aria-label="Thử lại tải lên"
                  title="Thử lại tải lên"
                  disabled={busy}
                  onClick={() => retryFile(file.key)}
                >
                  <RotateCw size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className={styles.commentFileRemove}
                aria-label={`${file.status === 'uploading' ? 'Huỷ tải' : 'Bỏ'} ảnh ${file.fileName}`}
                disabled={busy}
                onClick={() => removeFile(file.key)}
              >
                <X size={12} />
              </button>
            </li>
          )
          )}
        </ul>
      ) : null}
      {failed?.error && !failed.isVideo ? (
        <p role="alert" className={styles.fieldError}>
          {failed.error}
        </p>
      ) : null}
      {/* Mở/đóng do ô nhập quyết định; chỉ Esc được chuyển thành "đóng bảng gợi ý" (ghi nhớ đã đóng cho đoạn `@` này). */}
      <Popover
        open={mentionOpen && mentionStart !== undefined}
        onOpenChange={(next, details) => {
          if (!next && details.reason === 'escape-key') setDismissedStart(mention?.start);
        }}
      >
        <PopoverContent
          key={popoverKey.current}
          anchor={marker}
          side="top"
          align="start"
          initialFocus={false}
          finalFocus={false}
          className={extras.mentionPopover}
          // Giữ tiêu điểm trong ô nhập khi bấm chọn người.
          onMouseDown={(event) => event.preventDefault()}
        >
          {mentionQuery.length > 0 ? (
            <PeopleList people={people} loading={loading} onPick={pick} activeIndex={activeIndex} fullText />
          ) : (
            <p className={styles.suggestEmpty}>Gõ tên để tìm người cần nhắc.</p>
          )}
        </PopoverContent>
      </Popover>
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
      <ConfirmDialog
        open={warning}
        title={warningText.title}
        message={warningText.paragraphs}
        confirmLabel={warningText.confirmLabel}
        cancelLabel={warningText.cancelLabel}
        submittingLabel="Đang gửi…"
        danger={false}
        busy={busy}
        confirmDisabled={nothingLeft}
        note={nothingLeft ? VIDEO_NOTHING_LEFT_NOTE : undefined}
        onConfirm={sendAnyway}
        onClose={() => setWarning(false)}
      />
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
  /** Tải lại bình luận để lấy URL video ký mới khi URL cũ hết hạn hoặc khi video đang xử lý đã xong. */
  readonly onRefreshMedia?: () => Promise<void>;
}

function CommentRow({
  comment,
  canComment,
  onReply,
  onChanged,
  onRemoved,
  highlight = false,
  onRefreshMedia,
}: CommentRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const postAuthorId = useContext(PostAuthorContext);
  const isPostAuthor = postAuthorId !== undefined && comment.author.id === postAuthorId;

  const react = async (type: SocialReactionType | null) => {
    try {
      const summary = await reactToComment(comment.id, type);
      onChanged({
        ...comment,
        reactionCounts: summary.reactionCounts,
        reactionTotal: summary.reactionTotal,
        myReaction: summary.myReaction,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được phản ứng.'));
    }
  };
  // Menu "⋯" (Sửa, Xoá): đóng khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const canEdit = comment.capabilities.canEdit;
  const canDelete = comment.capabilities.canDelete;

  const commentImages = comment.attachments.filter((item) => !item.isVideo);
  const commentVideos = comment.attachments.filter((item) => item.isVideo);

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
        <UserAvatar user={comment.author} size={30} />
        <div className={styles.commentMain}>
          <p className={styles.commentDeleted}>Bình luận đã bị xoá.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.comment} ref={rowRef} data-highlight={highlight}>
      <UserAvatar user={comment.author} size={30} />
      <div className={styles.commentMain}>
        {editing && decoded ? (
          <CommentInput
            initialText={decoded.text}
            initialPicks={decoded.picks}
            initialFiles={comment.attachments}
            placeholder="Sửa bình luận"
            submitLabel="Lưu"
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (body, mentionUserIds, attachmentIds) => {
              const saved = await updateComment(comment.id, { body, mentionUserIds, attachmentIds });
              setEditing(false);
              onChanged(saved);
            }}
          />
        ) : (
          <>
            <div className={styles.commentBubbleWrap}>
              <div className={styles.commentBubble}>
                <div className={styles.commentHead}>
                  <span className={styles.commentAuthor} title={userSubtitle(comment.author) || undefined}>
                    {comment.author.name}
                  </span>
                  <time
                    className={styles.commentTime}
                    dateTime={comment.createdAt}
                    title={formatFullTime(comment.createdAt)}
                  >
                    {formatRelativeTime(comment.createdAt)}
                  </time>
                  {isPostAuthor ? (
                    <span className={styles.commentAuthorBadge} title="Người đăng bài viết này">
                      <PenLine size={11} aria-hidden="true" />
                      Tác giả
                    </span>
                  ) : null}
                </div>
                {comment.body ? (
                  <p className={styles.commentBody}>
                    {parseCommentBody(comment.body, comment.mentions).map((part, index) =>
                      part.type === 'mention' ? (
                        <MentionLink key={`${part.userId}-${index}`} userId={part.userId} name={part.name} />
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </p>
                ) : null}
              </div>
              {canEdit || canDelete ? (
                <div className={styles.commentMenu} ref={menuRef} data-open={menuOpen}>
                  <button
                    type="button"
                    className={styles.commentMenuButton}
                    aria-label="Tuỳ chọn bình luận"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((value) => !value)}
                  >
                    <Ellipsis size={16} aria-hidden="true" />
                  </button>
                  {menuOpen ? (
                    <div className={extras.postMenu} role="menu">
                      {canEdit ? (
                        <button
                          type="button"
                          role="menuitem"
                          className={extras.postMenuItem}
                          onClick={() => {
                            setMenuOpen(false);
                            setEditing(true);
                          }}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          Sửa bình luận
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          role="menuitem"
                          className={`${extras.postMenuItem} ${extras.postMenuDanger}`}
                          onClick={() => {
                            setMenuOpen(false);
                            setConfirming(true);
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          Xoá bình luận
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {commentImages.length > 0 ? (
              <div className={styles.commentImages}>
                <ImageGrid images={commentImages} />
              </div>
            ) : null}
            {commentVideos.map((video) => (
              <div key={video.id} className={styles.commentVideo}>
                <VideoAttachment attachment={video} fit className={styles.commentVideoFit} onRequestRefresh={onRefreshMedia} />
              </div>
            ))}
            <div className={styles.commentMeta}>
              {canComment ? (
                <span className={styles.commentReactWrap}>
                  <button
                    type="button"
                    className={styles.commentReactButton}
                    data-active={Boolean(comment.myReaction)}
                    data-type={comment.myReaction}
                    aria-label={comment.myReaction ? SOCIAL_REACTION_LABELS[comment.myReaction] : 'Thích'}
                    title={comment.myReaction ? SOCIAL_REACTION_LABELS[comment.myReaction] : 'Thích'}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      void react(comment.myReaction ? null : 'like');
                    }}
                  >
                    {comment.myReaction ? <ReactionIcon type={comment.myReaction} size={17} /> : <ThumbsUp size={17} aria-hidden="true" />}
                  </button>
                  <ReactionPicker
                    value={comment.myReaction}
                    onSelect={(type) => void react(comment.myReaction === type ? null : type)}
                  />
                </span>
              ) : null}
              {comment.editedAt ? <span title={formatFullTime(comment.editedAt)}>Đã sửa</span> : null}
              {canComment ? (
                <button type="button" className={`${styles.linkButton} ${styles.commentReplyButton}`} onClick={() => onReply(comment)}>
                  Trả lời
                </button>
              ) : null}
              <ReactionSummary
                counts={comment.reactionCounts}
                total={comment.reactionTotal}
                load={() => loadCommentReactors(comment.id)}
                iconSize={17}
                className={styles.commentReactionSummary}
              />
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
  /** Người đang đăng nhập: hiện ảnh và tên ở ô trả lời, và không tự nhắc tên chính mình. */
  readonly me?: SocialUserRef;
}

function RootComment({ postId, comment, canComment, onChanged, onRemoved, onCountChange, focusId, me }: RootCommentProps) {
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

  // Bấm "Trả lời" bình luận của ai thì tự nhắc tên người đó (trừ khi đó là chính mình).
  const replyDraft: MentionPick[] =
    replyTo && replyTo.id !== me?.id ? [{ id: replyTo.id, name: replyTo.name }] : [];
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
        onRefreshMedia={async () => {
          const fresh = await findFreshComment(loadComments, postId, comment.id);
          if (fresh) onChanged(fresh);
        }}
      />
      <div className={styles.replies}>
        {comment.replyCount > 0 && !expanded ? (
          <button type="button" className={`${styles.linkButton} ${styles.repliesToggle}`} onClick={showReplies}>
            Xem {comment.replyCount.toLocaleString('vi-VN')} phản hồi
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
                    onRefreshMedia={async () => {
                      const fresh = await findFreshComment(loadComments, postId, reply.id, comment.id);
                      if (fresh) setReplies((list) => list.map((item) => (item.id === fresh.id ? fresh : item)));
                    }}
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
                Xem thêm phản hồi
              </button>
            ) : null}
          </>
        ) : null}
        {replying && canComment ? (
          <CommentInput
            key={replyKey}
            initialText={replyDraft.length > 0 ? `@${replyDraft[0]?.name} ` : ''}
            initialPicks={replyDraft}
            placeholder={me ? `Trả lời với vai trò ${me.name}` : 'Viết trả lời…'}
            avatar={me}
            submitLabel="Trả lời"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={async (body, mentionUserIds, attachmentIds) => {
              const created = await createComment(postId, { body, parentId: comment.id, mentionUserIds, attachmentIds });
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
  /** Người đăng bài: bình luận của họ được gắn nhãn "Tác giả". */
  readonly postAuthorId?: string;
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
export function CommentSection({ postId, postAuthorId, me, canComment, commentsDisabled = false, onCountChange, focusCommentId }: CommentSectionProps) {
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
    <PostAuthorContext.Provider value={postAuthorId}>
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
          onSubmit={async (body, mentionUserIds, attachmentIds) => {
            const created = await createComment(postId, { body, mentionUserIds, attachmentIds });
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
              me={me.user}
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
    </PostAuthorContext.Provider>
  );
}
