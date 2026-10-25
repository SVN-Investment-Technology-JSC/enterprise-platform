'use client';

import {
  SOCIAL_MAX_ATTACHMENTS_PER_POST,
  SOCIAL_MEDIA_LAYOUT_DEFAULT,
  SOCIAL_POST_VISIBILITY_LABELS,
  SOCIAL_POST_BODY_MAX,
  SOCIAL_POST_KIND_LABELS,
  SOCIAL_POST_KINDS,
  SOCIAL_POST_TITLE_MAX,
  type SocialAttachment,
  type SocialGroupSummary,
  type SocialMe,
  type SocialMediaLayout,
  type SocialPost,
  type SocialPostKind,
  type SocialPostVisibility,
  type SocialSettings,
  type SocialTopic,
  type SocialUnitRef,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  Building2,
  ChevronDown,
  File as FileIcon,
  Globe,
  ImageIcon,
  Paperclip,
  UserLock,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  buildPollRequest,
  emptyPollDraft,
  isoToVnParts,
  pollCloseIso,
  validatePollDraft,
  validateSchedule,
  vnPartsToIso,
  vnToday,
  type PollDraft,
} from '../post-extras.model';
import extras from '../post-extras.module.scss';
import {
  attachmentErrorMessage,
  attachmentStatusApi,
  createPost,
  discardAttachment,
  discardAttachmentKeepalive,
  updatePost,
  uploadAttachment,
} from '../social-api';
import { isUploadAborted } from '../attachment-upload';
import {
  isCommentVideo,
  probeVideo,
  validateCommentMedia,
  validateVideoDuration,
  withVideoContentType,
} from '../comment-media';
import {
  buildGalleryItems,
  buildMediaPayload,
  canMoveItem,
  countLayoutMedia,
  isMediaFile,
  moveItem,
  type MoveDirection,
} from '../composer-media';
import { useAttachmentStatuses } from '../use-attachment-statuses';
import { useUnsentAttachments } from '../use-unsent-attachments';
import { loadAllMyGroups, loadSettings } from '../social-posts-api';
import type { SocialComposerMode } from '../social-context';
import { formatBytes, isEmptyHtml, validateAttachment } from '../social.model';
import {
  allowsCompanyOnlyExtras,
  buildAudienceInput,
  describeVisibility,
  lockedToCompanyReason,
  sameIds,
  validateVisibility,
} from '../post-visibility.model';
import styles from '../social.module.scss';
import { AudienceDialog } from './composer/audience-dialog';
import { PeoplePicker } from './people-picker';
import { PollBuilder } from './poll/poll-builder';
import { RichEditor } from './rich-editor';
import { TimeSelect } from './time-select';
import { ComposerVideoTile } from './composer-video-tile';
import { MediaGallery } from './media-gallery';
import layoutStyles from './media-layout.module.scss';
import { MediaLayoutPicker, MediaMoveButtons } from './media-layout-picker';
import { Avatar, ConfirmDialog, Dialog, Field, SelectField } from './ui';
import {
  buildVideoWarning,
  collectUnfinishedVideos,
  hasFailedVideo,
  hasNonVideoUploading,
  hasUnfinishedVideos,
  isVideoPending,
} from '../video-publish-gate';

/** Cách bỏ tệp chưa gửi: lời gọi thường khi gỡ tệp hay đóng hộp, `keepalive` khi đóng tab. */
const UNSENT_DEPS = { discard: discardAttachment, discardKeepalive: discardAttachmentKeepalive };

interface UploadItem {
  readonly key: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly isImage: boolean;
  readonly status: 'uploading' | 'done' | 'error';
  readonly attachment?: SocialAttachment;
  readonly error?: string;
  readonly isVideo?: boolean;
  /** URL tạm của ảnh hoặc video vừa chọn (xem trước); thu hồi khi gỡ hoặc đóng hộp. */
  readonly objectUrl?: string;
  /** Tiến trình tải lên, 0 đến 1. */
  readonly progress?: number;
  /** Mã tệp do server cấp ngay sau `initiate` (khi còn đang tải). */
  readonly ticketId?: string;
  /** Tệp gốc để thử lại tải lên (chỉ video). */
  readonly original?: File;
  readonly retryable?: boolean;
}

const KIND_OPTIONS = SOCIAL_POST_KINDS.map((kind) => ({
  value: kind,
  label: SOCIAL_POST_KIND_LABELS[kind],
}));

const VISIBILITY_ICONS: Readonly<Record<SocialPostVisibility, LucideIcon>> = {
  company: Globe,
  unit: Building2,
  custom: Users,
  private: UserLock,
};

/** Giá trị của ô "Nơi đăng" cho Tường công ty (không phải mã nhóm). */
const WALL = '';

export interface ComposerDialogProps {
  readonly me: SocialMe;
  readonly topics: readonly SocialTopic[];
  /** Có thì đang sửa bài này. */
  readonly editing?: SocialPost;
  /** Chuyên mục chọn sẵn khi đang xem một chuyên mục. */
  readonly defaultTopicId?: string;
  readonly defaultKind?: SocialPostKind;
  /** Mở sẵn đúng phần: chọn tệp, trình dựng bình chọn, hoặc loại Thông báo (nếu có quyền). */
  readonly defaultMode?: SocialComposerMode;
  /** Nhóm chọn sẵn khi soạn bài từ trang một nhóm. */
  readonly defaultGroupId?: string;
  readonly onClose: () => void;
  readonly onSaved: (post: SocialPost) => void;
}

/** Hộp thoại soạn bài hoặc sửa bài. Dựng mới mỗi lần mở nên không cần đặt lại trạng thái. */
export function ComposerDialog({
  me,
  topics,
  editing,
  defaultTopicId,
  defaultKind,
  defaultMode,
  defaultGroupId,
  onClose,
  onSaved,
}: ComposerDialogProps) {
  const canModerate = me.permissions.includes('social.post.moderate');
  const scheduledParts = editing?.scheduledAt
    ? isoToVnParts(editing.scheduledAt)
    : undefined;
  const editingScheduled = editing?.status === 'scheduled';
  const editingPoll = editing?.poll;
  const editingCloseParts = editingPoll?.closesAt
    ? isoToVnParts(editingPoll.closesAt)
    : undefined;

  const [groups, setGroups] = useState<readonly SocialGroupSummary[]>([]);
  const [settings, setSettings] = useState<SocialSettings>();
  const [destination, setDestination] = useState(
    editing?.group?.id ?? defaultGroupId ?? WALL,
  );
  const [title, setTitle] = useState(editing?.title ?? '');
  const [html, setHtml] = useState(editing?.bodyHtml ?? '');
  const [kind, setKind] = useState<SocialPostKind>(
    editing?.kind ??
      (defaultMode === 'announcement' ? 'announcement' : defaultKind) ??
      'post',
  );
  const [topicId, setTopicId] = useState(
    editing?.topic?.id ?? defaultTopicId ?? '',
  );
  const [mentions, setMentions] = useState(editing?.mentions ?? []);
  const [mentionsAll, setMentionsAll] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pollOn, setPollOn] = useState(
    Boolean(editingPoll) || (!editing && defaultMode === 'poll'),
  );
  const [pollDraft, setPollDraft] = useState<PollDraft>({
    ...emptyPollDraft(),
    closeDate: editingCloseParts?.date ?? '',
    closeTime: editingCloseParts?.time ?? '',
  });
  const [requireRead, setRequireRead] = useState(
    Boolean(editing?.readConfirmation),
  );
  const [scheduleOn, setScheduleOn] = useState(editingScheduled);
  const [scheduleDate, setScheduleDate] = useState(scheduledParts?.date ?? '');
  const [scheduleTime, setScheduleTime] = useState(scheduledParts?.time ?? '');
  const [uploads, setUploads] = useState<readonly UploadItem[]>(() =>
    (editing?.attachments ?? []).map((attachment) => ({
      key: attachment.id,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      isImage: attachment.isImage,
      isVideo: attachment.isVideo === true,
      status: 'done' as const,
      attachment,
    })),
  );
  const [mediaLayout, setMediaLayout] = useState<SocialMediaLayout>(
    editing?.mediaLayout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
  );
  const [visibility, setVisibility] = useState<SocialPostVisibility>(
    editing?.visibility ?? 'company',
  );
  const [audUsers, setAudUsers] = useState<readonly SocialUserRef[]>(
    editing?.audience?.users ?? [],
  );
  const [audUnits, setAudUnits] = useState<readonly SocialUnitRef[]>(
    editing?.audience?.units ?? [],
  );
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  // Tệp chưa gửi: cảnh báo khi rời trang, bỏ khi đóng tab hoặc đóng hộp (chỉ tệp tải trong hộp này, không phải tệp của bài đang sửa).
  const unsent = useUnsentAttachments(UNSENT_DEPS);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
      for (const item of uploadsRef.current) if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    };
  }, []);

  // Lối tắt "Ảnh/File": mở sẵn hộp chọn tệp ngay khi hộp thoại hiện.
  useEffect(() => {
    if (!editing && defaultMode === 'media') fileInput.current?.click();
  }, [editing, defaultMode]);

  // Danh sách nhóm của tôi và cài đặt duyệt bài; lỗi thì bỏ qua (chỉ mất phần gợi ý).
  useEffect(() => {
    let alive = true;
    loadAllMyGroups()
      .then((items) => alive && setGroups(items))
      .catch(() => undefined);
    loadSettings()
      .then((value) => alive && setSettings(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const group = destination
    ? groups.find((item) => item.id === destination)
    : undefined;
  const inGroup = Boolean(destination);
  // Quyền xem chỉ áp cho Tường công ty; bài nhóm luôn theo nhóm.
  const effectiveVisibility: SocialPostVisibility = inGroup
    ? 'company'
    : visibility;
  const companyOnly = allowsCompanyOnlyExtras(effectiveVisibility);
  const canPickVisibility =
    !inGroup && (!editing || Boolean(editing.capabilities.canChangeVisibility));
  const visibilityLock = editing ? lockedToCompanyReason(editing) : undefined;
  const canAnnounce =
    companyOnly &&
    (inGroup ? group?.myMembership?.role === 'admin' : canModerate);
  const effectiveKind: SocialPostKind = canAnnounce ? kind : 'post';
  const needsApproval =
    !inGroup &&
    companyOnly &&
    !canModerate &&
    Boolean(settings?.wallRequireApproval);
  const lockedRead = Boolean(
    editing?.readConfirmation &&
      (editing.readConfirmation.confirmedCount ?? 0) > 0,
  );
  const canSchedule = !editing || editingScheduled;

  // Video đã tải xong nhưng chưa `ready`: hỏi định kỳ trạng thái chuyển mã.
  const unfinishedVideoIds = uploads.flatMap((item) =>
    item.status === 'done' && item.isVideo && item.attachment && isVideoPending(item.attachment)
      ? [item.attachment.id]
      : [],
  );
  const latestStatus = useAttachmentStatuses(unfinishedVideoIds, attachmentStatusApi.status);
  const shownUploads: readonly UploadItem[] = uploads.map((item) => {
    const latest = item.attachment ? latestStatus.get(item.attachment.id) : undefined;
    return item.attachment && latest ? { ...item, attachment: { ...item.attachment, ...latest } } : item;
  });
  // Video chưa xong KHÔNG chặn đăng: bấm đăng thì hỏi lại (hộp cảnh báo). Ảnh/tệp đang tải và video lỗi vẫn chặn.
  const unfinished = collectUnfinishedVideos(shownUploads);
  const unfinishedAny = hasUnfinishedVideos(unfinished);
  const nonVideoUploading = hasNonVideoUploading(shownUploads);
  const videoFailed = hasFailedVideo(shownUploads);
  const [videoWarning, setVideoWarning] = useState(false);
  // Video xong hoặc bị gỡ trong lúc hộp đang mở: không còn gì để cảnh báo.
  useEffect(() => {
    if (videoWarning && !unfinishedAny) setVideoWarning(false);
  }, [videoWarning, unfinishedAny]);
  const activeUploads = uploads.filter(
    (item) => item.status !== 'error',
  ).length;
  const layoutMediaCount = countLayoutMedia(shownUploads);
  const showLayout = layoutMediaCount >= 2;
  const moveUpload = (key: string, direction: MoveDirection) =>
    setUploads((list) => moveItem(list, key, direction));
  const moveProps = (item: UploadItem) =>
    showLayout && isMediaFile(item)
      ? {
          canEarlier: canMoveItem(shownUploads, item.key, 'earlier'),
          canLater: canMoveItem(shownUploads, item.key, 'later'),
          onMove: (direction: MoveDirection) => moveUpload(item.key, direction),
        }
      : undefined;
  const empty = isEmptyHtml(html);
  const hasPoll = pollOn && !editingPoll;
  const noContent = empty && !pollOn;

  const topicOptions = topics
    .filter((topic) => topic.isActive || topic.id === topicId)
    .map((topic) => ({ value: topic.id, label: topic.name }));

  const destinationOptions = [
    { value: WALL, label: 'Tường công ty' },
    ...groups.map((item) => ({ value: item.id, label: `Nhóm: ${item.name}` })),
  ];
  // Bài sửa từ nhóm mà danh sách nhóm chưa tải xong vẫn hiện đúng tên.
  if (editing?.group && !groups.some((item) => item.id === editing.group?.id)) {
    destinationOptions.push({
      value: editing.group.id,
      label: `Nhóm: ${editing.group.name}`,
    });
  }

  const patch = (key: string, next: Partial<UploadItem>) =>
    setUploads((list) =>
      list.map((item) => (item.key === key ? { ...item, ...next } : item)),
    );

  /** Video: đọc thử trong trình duyệt (chỉ để kiểm thời lượng), rồi tải lên với tiến trình thật. */
  const startVideoUpload = (key: string, original: File) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    let lastPercent = -1;
    const run = async () => {
      // Trình duyệt không đọc được (HEVC, MOV) thì vẫn tải: server chuyển mã và quyết định.
      const probe = await probeVideo(original);
      const tooLong = validateVideoDuration(probe, original.name, 'post');
      if (tooLong) {
        patch(key, { status: 'error', error: tooLong, retryable: false });
        return;
      }
      if (controller.signal.aborted) return;
      const attachment = await uploadAttachment(withVideoContentType(original), 'post', {
        signal: controller.signal,
        onInitiated: ({ attachmentId, uploadId }) => {
          unsent.track(attachmentId, uploadId);
          patch(key, { ticketId: attachmentId });
        },
        onProgress: (fraction) => {
          const percent = Math.round(fraction * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          patch(key, { progress: fraction });
        },
      });
      // Đã gỡ hoặc đóng hộp trong lúc chờ `complete`: tệp tải xong muộn thì bỏ luôn.
      if (controller.signal.aborted) {
        unsent.discard(attachment.id);
        return;
      }
      patch(key, { status: 'done', attachment, progress: 1, original: undefined });
    };
    void run()
      .catch((cause) => {
        if (isUploadAborted(cause) || controller.signal.aborted) return;
        // Lần tải lỗi đã được `uploadAttachment` huỷ phía server: thôi theo dõi tệp này.
        const ticketId = uploadsRef.current.find((item) => item.key === key)?.ticketId;
        if (ticketId) unsent.forget(ticketId);
        patch(key, {
          status: 'error',
          retryable: true,
          ticketId: undefined,
          error: attachmentErrorMessage(cause, `Không tải được video "${original.name}".`),
        });
      })
      .finally(() => {
        if (controllers.current.get(key) === controller) controllers.current.delete(key);
      });
  };

  /** Tệp thường (ảnh, tài liệu): tải một lần, huỷ được khi gỡ. */
  const startFileUpload = (key: string, file: File) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    uploadAttachment(file, 'post', {
      signal: controller.signal,
      onInitiated: ({ attachmentId, uploadId }) => {
        unsent.track(attachmentId, uploadId);
        patch(key, { ticketId: attachmentId });
      },
    })
      .then((attachment) => {
        if (controller.signal.aborted) {
          unsent.discard(attachment.id);
          return;
        }
        patch(key, { status: 'done', attachment });
      })
      .catch((cause) => {
        if (isUploadAborted(cause) || controller.signal.aborted) return;
        const ticketId = uploadsRef.current.find((item) => item.key === key)?.ticketId;
        if (ticketId) unsent.forget(ticketId);
        patch(key, {
          status: 'error',
          ticketId: undefined,
          error: attachmentErrorMessage(cause, 'Không tải được tệp lên.'),
        });
      })
      .finally(() => {
        if (controllers.current.get(key) === controller) controllers.current.delete(key);
      });
  };

  const retryVideo = (key: string) => {
    const target = uploadsRef.current.find((item) => item.key === key);
    if (!target?.original || target.retryable === false || controllers.current.has(key)) return;
    patch(key, { status: 'uploading', error: undefined, progress: 0 });
    startVideoUpload(key, target.original);
  };

  /** Gỡ một tệp khỏi danh sách: huỷ tải nếu đang tải, bỏ ngay nếu đã tải lên mà chưa gửi. */
  const removeUpload = (key: string) => {
    const target = uploadsRef.current.find((item) => item.key === key);
    const uploadingNow = controllers.current.has(key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    if (key.startsWith('new-')) {
      const id = target?.attachment?.id ?? target?.ticketId;
      if (id) {
        if (uploadingNow && !target?.attachment) unsent.forget(id);
        else unsent.discard(id);
      }
    }
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
    setUploads((list) => list.filter((entry) => entry.key !== key));
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    let count = activeUploads;
    let videos = uploads.filter((item) => item.isVideo && item.status !== 'error').length;
    let images = uploads.filter((item) => item.isImage && item.status !== 'error').length;
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const isVideo = isCommentVideo(file);
      const isImage = !isVideo && file.type.startsWith('image/');
      // Ảnh, video và tài liệu đi chung một bài; chỉ còn giới hạn số lượng, dung lượng và loại tệp.
      const problem = isVideo
        ? validateCommentMedia(file, { count, videos, images }, 'post')
        : validateAttachment(file, count);
      if (problem) {
        rejected.push(problem);
        continue;
      }
      count += 1;
      if (isVideo) videos += 1;
      if (isImage) images += 1;
      counter.current += 1;
      const key = `new-${counter.current}`;
      const objectUrl = isVideo || isImage ? URL.createObjectURL(file) : undefined;
      setUploads((list) => [
        ...list,
        {
          key,
          fileName: file.name,
          sizeBytes: file.size,
          isImage,
          isVideo,
          objectUrl,
          progress: 0,
          original: isVideo ? file : undefined,
          status: 'uploading',
        },
      ]);
      if (isVideo) startVideoUpload(key, file);
      else startFileUpload(key, file);
    }
    setError(rejected.length > 0 ? rejected.join(' ') : undefined);
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async (confirmed = false) => {
    if (noContent) {
      setError('Hãy nhập nội dung bài viết.');
      return;
    }
    const visibilityProblem = inGroup
      ? undefined
      : validateVisibility(visibility, audUsers, audUnits);
    if (visibilityProblem) {
      setError(visibilityProblem);
      return;
    }
    if (html.length > SOCIAL_POST_BODY_MAX) {
      setError('Nội dung bài viết quá dài.');
      return;
    }
    if (pollOn) {
      const closeOnly = Boolean(editingPoll);
      const problem = closeOnly
        ? pollCloseIso(pollDraft) === undefined
          ? 'Hãy chọn đủ ngày và giờ đóng bình chọn.'
          : undefined
        : validatePollDraft(pollDraft);
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (scheduleOn && canSchedule) {
      const problem = validateSchedule(scheduleDate, scheduleTime);
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (videoFailed) {
      setError('Có video xử lý lỗi. Hãy gỡ video đó rồi đăng lại.');
      return;
    }
    if (!confirmed && unfinishedAny) {
      setVideoWarning(true);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    // Tệp đã tải xong và không lỗi (gồm video đang xử lý); video đang tải dở đã bị huỷ ở bước xác nhận.
    const { attachmentIds, mediaLayout: layoutToSend } = buildMediaPayload(shownUploads, mediaLayout);
    const mentionUserIds = mentions.map((user) => user.id);
    const scheduledAt =
      scheduleOn && canSchedule
        ? vnPartsToIso(scheduleDate, scheduleTime)
        : undefined;
    try {
      let saved: SocialPost;
      if (editing) {
        const closeIso = pollCloseIso(pollDraft);
        const closeChanged =
          editingPoll && (closeIso ?? undefined) !== editingPoll.closesAt;
        const visibilityChanged =
          canPickVisibility &&
          (visibility !== (editing.visibility ?? 'company') ||
            (visibility === 'custom' &&
              !(
                sameIds(audUsers, editing.audience?.users ?? []) &&
                sameIds(audUnits, editing.audience?.units ?? [])
              )));
        saved = await updatePost(editing.id, {
          title: title.trim() || null,
          bodyHtml: html,
          topicId: inGroup ? null : topicId || null,
          attachmentIds,
          mediaLayout: layoutToSend,
          mentionUserIds,
          ...(editingScheduled && scheduledAt ? { scheduledAt } : {}),
          ...(companyOnly &&
          requireRead !== Boolean(editing.readConfirmation)
            ? { requiresReadConfirmation: requireRead }
            : {}),
          ...(visibilityChanged
            ? {
                visibility,
                ...(visibility === 'custom'
                  ? { audience: buildAudienceInput(audUsers, audUnits) }
                  : {}),
              }
            : {}),
          ...(closeChanged ? { poll: { closesAt: closeIso } } : {}),
        });
      } else {
        saved = await createPost({
          kind: effectiveKind,
          title: title.trim() || undefined,
          bodyHtml: html,
          topicId: !inGroup && topicId ? topicId : undefined,
          attachmentIds,
          mediaLayout: layoutToSend,
          mentionUserIds,
          ...(inGroup ? { groupId: destination } : {}),
          ...(canAnnounce ? { mentionsAll, pinned } : {}),
          ...(hasPoll ? { poll: buildPollRequest(pollDraft) } : {}),
          ...(requireRead && companyOnly
            ? { requiresReadConfirmation: true }
            : {}),
          ...(!inGroup && visibility !== 'company'
            ? {
                visibility,
                ...(visibility === 'custom'
                  ? { audience: buildAudienceInput(audUsers, audUnits) }
                  : {}),
              }
            : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        });
      }
      // Đã gắn vào bài: không còn là tệp chưa gửi, đừng bỏ khi hộp thoại đóng.
      unsent.forget(attachmentIds);
      onSaved(saved);
    } catch (cause) {
      setError(
        attachmentErrorMessage(
          cause,
          editing ? 'Không lưu được bài viết.' : 'Không đăng được bài viết.',
        ),
      );
      setSubmitting(false);
    }
  };

  const videoWarningText = buildVideoWarning(unfinished, 'post');

  /** "Vẫn đăng": huỷ và bỏ các video đang tải (đường huỷ sẵn có), rồi đăng kèm các tệp đã tải xong. */
  const postAnyway = () => {
    setVideoWarning(false);
    for (const item of uploadsRef.current) {
      if (item.isVideo && item.status === 'uploading') removeUpload(item.key);
    }
    void submit(true);
  };

  const resubmit = editing?.status === 'rejected';
  const submitLabel = editing
    ? resubmit
      ? 'Gửi duyệt lại'
      : 'Lưu thay đổi'
    : scheduleOn
      ? 'Hẹn giờ đăng'
      : needsApproval
        ? 'Gửi duyệt'
        : 'Đăng bài';

  return (
    <>
    <Dialog
      open
      wide
      title={
        editing
          ? 'Sửa bài viết'
          : effectiveKind === 'announcement'
            ? 'Đăng thông báo'
            : 'Đăng bài viết mới'
      }
      submitLabel={submitLabel}
      submittingLabel={editing ? 'Đang lưu…' : 'Đang đăng…'}
      submitting={submitting}
      submitDisabled={noContent || nonVideoUploading || videoFailed}
      error={error}
      onSubmit={() => void submit()}
      onClose={() => {
        // Esc trong hộp quyền xem chỉ đóng hộp đó.
        if (!audienceOpen && !videoWarning) onClose();
      }}
    >
      <div className={extras.composerWho}>
        <Avatar user={me.user} size={36} />
        <div className={extras.composerWhoText}>
          <span className={extras.composerName}>{me.user.name}</span>
          {!inGroup ? (
            <span className={extras.composerSummary}>
              {describeVisibility(visibility, audUsers, audUnits)}
            </span>
          ) : null}
        </div>
        {!inGroup && (canPickVisibility || visibility !== 'company') ? (
          <VisibilityControl
            visibility={visibility}
            interactive={canPickVisibility}
            onOpen={() => setAudienceOpen(true)}
          />
        ) : null}
      </div>

      <div className={styles.fieldRow}>
        <SelectField label="Nơi đăng">
          <SearchableSelect
            options={destinationOptions}
            value={destination}
            disabled={Boolean(editing)}
            onChange={(value) => {
              setDestination(value);
              if (value) setTopicId('');
            }}
          />
        </SelectField>
        {canAnnounce && !editing ? (
          <SelectField label="Loại bài">
            <SearchableSelect
              options={KIND_OPTIONS}
              value={kind}
              onChange={(value) => setKind(value as SocialPostKind)}
            />
          </SelectField>
        ) : null}
      </div>

      {needsApproval || resubmit ? (
        <p className={extras.notice} role="note">
          {scheduleOn
            ? 'Bài sẽ vào hàng chờ duyệt khi đến giờ hẹn; chỉ hiện trên Tường công ty sau khi được duyệt.'
            : 'Bài trên Tường công ty cần được kiểm duyệt viên duyệt. Bài sẽ vào hàng chờ duyệt và chỉ hiện sau khi được duyệt.'}
        </p>
      ) : null}

      <Field label="Tiêu đề" hint="Không bắt buộc.">
        <input
          className={styles.input}
          value={title}
          maxLength={SOCIAL_POST_TITLE_MAX}
          placeholder="Nhập tiêu đề bài viết"
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      {!inGroup ? (
        <SelectField label="Chuyên mục">
          <SearchableSelect
            options={topicOptions}
            value={topicId}
            placeholder="Chọn chuyên mục"
            emptyText="Không có chuyên mục"
            clearable
            onChange={setTopicId}
          />
        </SelectField>
      ) : null}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          Nội dung<span className={styles.fieldRequired}> *</span>
        </span>
        <RichEditor
          initialHtml={editing?.bodyHtml}
          placeholder="Bạn muốn chia sẻ điều gì?"
          onChange={setHtml}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Nhắc đến</span>
        <PeoplePicker selected={mentions} onChange={setMentions} />
      </div>

      <div className={styles.checkRow}>
        {canAnnounce && !editing ? (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={mentionsAll}
                onChange={(event) => setMentionsAll(event.target.checked)}
              />
              <span>Nhắc tất cả mọi người (@all)</span>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              <span>Ghim lên đầu bảng tin</span>
            </label>
          </>
        ) : null}
        {companyOnly ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={requireRead}
              disabled={lockedRead}
              onChange={(event) => setRequireRead(event.target.checked)}
            />
            <span>
              Yêu cầu xác nhận đã đọc
              {lockedRead ? ' (đã có người xác nhận)' : ''}
            </span>
          </label>
        ) : null}
        {!editing || editingPoll ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={pollOn}
              disabled={Boolean(editingPoll)}
              onChange={(event) => setPollOn(event.target.checked)}
            />
            <span>Thêm bình chọn</span>
          </label>
        ) : null}
        {canSchedule ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={scheduleOn}
              onChange={(event) => {
                setScheduleOn(event.target.checked);
                if (event.target.checked && !scheduleTime)
                  setScheduleTime('08:00');
              }}
            />
            <span>Hẹn giờ đăng</span>
          </label>
        ) : null}
      </div>

      {pollOn ? (
        <PollBuilder
          draft={pollDraft}
          onChange={setPollDraft}
          lockedOptions={Boolean(editingPoll)}
        />
      ) : null}

      {scheduleOn && canSchedule ? (
        <div className={extras.section}>
          <div className={extras.sectionHead}>
            Đăng vào lúc (giờ Việt Nam, UTC+7)
          </div>
          <div className={extras.dateTimeRow}>
            <div className={styles.field} role="group" aria-label="Ngày đăng">
              <DatePickerInput
                value={scheduleDate}
                min={vnToday()}
                height={38}
                aria-label="Ngày đăng"
                onChange={setScheduleDate}
              />
            </div>
            <TimeSelect
              value={scheduleTime}
              label="Giờ đăng"
              onChange={setScheduleTime}
            />
          </div>
          <span className={styles.fieldHint}>
            Giờ hẹn phải cách hiện tại ít nhất 1 phút và không quá 365 ngày.
          </span>
        </div>
      ) : null}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          Tệp đính kèm{' '}
          <span className={styles.muted}>
            ({activeUploads}/{SOCIAL_MAX_ATTACHMENTS_PER_POST})
          </span>
        </span>
        {shownUploads.length > 0 ? (
          <ul className={styles.uploadList}>
            {shownUploads.map((item) =>
              item.isVideo ? (
                <li key={item.key}>
                  <ComposerVideoTile
                    fileName={item.fileName}
                    previewUrl={item.objectUrl}
                    status={item.status}
                    progress={item.progress}
                    attachment={item.attachment}
                    error={item.error}
                    retryable={Boolean(item.original) && item.retryable !== false}
                    disabled={submitting}
                    onRemove={() => removeUpload(item.key)}
                    onRetry={() => retryVideo(item.key)}
                    move={moveProps(item)}
                  />
                </li>
              ) : (
                <li
                  key={item.key}
                  className={styles.uploadItem}
                  data-status={item.status}
                >
                  {item.isImage ? (
                    <ImageIcon size={15} />
                  ) : (
                    <FileIcon size={15} />
                  )}
                  <span className={styles.uploadName}>{item.fileName}</span>
                  <span className={styles.uploadMeta}>
                    {item.status === 'uploading'
                      ? 'Đang tải lên…'
                      : item.status === 'error'
                        ? (item.error ?? 'Lỗi')
                        : formatBytes(item.sizeBytes)}
                  </span>
                  {moveProps(item) && item.status !== 'error' ? (
                    <MediaMoveButtons
                      fileName={item.fileName}
                      disabled={submitting}
                      canEarlier={moveProps(item)?.canEarlier ?? false}
                      canLater={moveProps(item)?.canLater ?? false}
                      onMove={(direction) => moveUpload(item.key, direction)}
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Bỏ tệp ${item.fileName}`}
                    onClick={() => removeUpload(item.key)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {showLayout ? (
          <div className={layoutStyles.section}>
            <span className={layoutStyles.sectionHead}>Bố cục hiển thị</span>
            <MediaLayoutPicker value={mediaLayout} disabled={submitting} onChange={setMediaLayout} />
            <p className={layoutStyles.sectionHint}>
              Dùng nút mũi tên trên từng ảnh hoặc video để đổi thứ tự hiển thị.
            </p>
            <div className={layoutStyles.previewFrame}>
              <MediaGallery items={buildGalleryItems(shownUploads)} layout={mediaLayout} preview />
            </div>
            <p className={layoutStyles.previewCaption}>
              Xem trước: đây là cách bài viết hiển thị với mọi người.
            </p>
          </div>
        ) : null}
        {videoFailed ? (
          <span className={styles.fieldHint} role="status">
            Hãy gỡ video xử lý lỗi trước khi đăng.
          </span>
        ) : unfinished.processing.length > 0 ? (
          <span className={styles.fieldHint} role="status">
            Video đang xử lý; bạn vẫn có thể đăng, video sẽ hiện khi xử lý xong.
          </span>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
          onChange={(event) => addFiles(event.target.files)}
        />
        <button
          type="button"
          className={`${styles.buttonGhost} ${styles.attachButton}`}
          disabled={activeUploads >= SOCIAL_MAX_ATTACHMENTS_PER_POST}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={15} /> Thêm ảnh, video hoặc tệp
        </button>
      </div>
    </Dialog>
    <ConfirmDialog
      open={videoWarning}
      title={videoWarningText.title}
      message={videoWarningText.paragraphs}
      confirmLabel={videoWarningText.confirmLabel}
      cancelLabel={videoWarningText.cancelLabel}
      submittingLabel="Đang đăng…"
      danger={false}
      busy={submitting}
      onConfirm={postAnyway}
      onClose={() => setVideoWarning(false)}
    />
    {audienceOpen ? (
      <AudienceDialog
        value={{ visibility, users: audUsers, units: audUnits }}
        lockedReason={visibilityLock}
        onClose={() => setAudienceOpen(false)}
        onApply={(next) => {
          setVisibility(next.visibility);
          setAudUsers(next.users);
          setAudUnits(next.units);
          if (next.visibility !== 'company') {
            // Các tùy chọn chỉ đi với Công khai thì bỏ khi thu hẹp quyền xem.
            setKind('post');
            setPinned(false);
            setMentionsAll(false);
            setRequireRead(false);
          }
          setError(undefined);
          setAudienceOpen(false);
        }}
      />
    ) : null}
    </>
  );
}

/** Nút quyền xem ở đầu hộp soạn; bài không đổi được quyền xem thì chỉ hiện nhãn. */
function VisibilityControl({
  visibility,
  interactive,
  onOpen,
}: {
  readonly visibility: SocialPostVisibility;
  readonly interactive: boolean;
  readonly onOpen: () => void;
}) {
  const Icon = VISIBILITY_ICONS[visibility];
  const content = (
    <>
      <Icon size={14} aria-hidden="true" />
      {SOCIAL_POST_VISIBILITY_LABELS[visibility]}
      {interactive ? <ChevronDown size={14} aria-hidden="true" /> : null}
    </>
  );
  return interactive ? (
    <button
      type="button"
      className={extras.audienceButton}
      aria-haspopup="dialog"
      title="Tùy chỉnh quyền xem"
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <span className={extras.audienceButton} data-static="true">
      {content}
    </span>
  );
}

