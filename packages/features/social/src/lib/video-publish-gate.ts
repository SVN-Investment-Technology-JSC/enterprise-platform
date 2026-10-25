import type { SocialAttachment } from '@enterprise-platform/contracts-social';

/** Đăng bài hay gửi bình luận: chỉ khác nhau ở câu chữ của hộp cảnh báo. */
export type PublishTarget = 'post' | 'comment';

/** Phần tối thiểu của một tệp trong ô soạn mà việc kiểm video cần. */
export interface PublishGateFile {
  readonly fileName: string;
  readonly status: 'uploading' | 'done' | 'error';
  readonly isVideo?: boolean;
  /** Tiến trình tải lên, 0 đến 1. */
  readonly progress?: number;
  readonly attachment?: Pick<SocialAttachment, 'processingStatus'>;
}

export interface UnfinishedVideos {
  /** Video còn đang truyền lên (kể cả đang thử lại): chưa có mã tệp hoàn tất, sẽ bị bỏ nếu đăng ngay. */
  readonly uploading: readonly { readonly fileName: string; readonly percent: number }[];
  /** Video đã tải xong nhưng đang chờ hoặc đang chuyển mã: đăng được, hiện khi xong. */
  readonly processing: readonly { readonly fileName: string }[];
}

export interface VideoWarning {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

export const VIDEO_WARNING_TITLE = 'Video chưa xử lý xong';
export const VIDEO_WARNING_CANCEL_LABEL = 'Chờ video xong';
export const VIDEO_NOTHING_LEFT_NOTE = 'Không còn nội dung để đăng nếu bỏ video đang tải.';

export const isVideoPending = (attachment: Pick<SocialAttachment, 'processingStatus'>): boolean =>
  attachment.processingStatus === 'queued' || attachment.processingStatus === 'processing';

const toPercent = (progress: number | undefined) => Math.round(Math.max(0, Math.min(1, progress ?? 0)) * 100);

/** Video chưa xong của danh sách tệp: đang tải lên, và đã tải xong nhưng chưa `ready`. Tệp lỗi tải không tính. */
export function collectUnfinishedVideos(files: readonly PublishGateFile[]): UnfinishedVideos {
  const uploading: { fileName: string; percent: number }[] = [];
  const processing: { fileName: string }[] = [];
  for (const file of files) {
    if (!file.isVideo) continue;
    if (file.status === 'uploading') uploading.push({ fileName: file.fileName, percent: toPercent(file.progress) });
    else if (file.status === 'done' && file.attachment && isVideoPending(file.attachment)) {
      processing.push({ fileName: file.fileName });
    }
  }
  return { uploading, processing };
}

export const hasUnfinishedVideos = (unfinished: UnfinishedVideos): boolean =>
  unfinished.uploading.length > 0 || unfinished.processing.length > 0;

/** Có video đã tải xong nhưng xử lý lỗi (khi đó phải gỡ video mới đăng được). */
export const hasFailedVideo = (files: readonly PublishGateFile[]): boolean =>
  files.some((file) => file.isVideo === true && file.status === 'done' && file.attachment?.processingStatus === 'failed');

/** Có tệp KHÔNG phải video còn đang tải (ảnh, tài liệu): vẫn chặn đăng như trước. */
export const hasNonVideoUploading = (files: readonly PublishGateFile[]): boolean =>
  files.some((file) => !file.isVideo && file.status === 'uploading');

/** Mã các tệp đã tải xong và không lỗi xử lý (gồm video đang `queued`/`processing`), theo thứ tự trong ô soạn. */
export function publishableAttachmentIds(
  files: readonly {
    readonly status: PublishGateFile['status'];
    readonly attachment?: Pick<SocialAttachment, 'id' | 'processingStatus'>;
  }[],
): string[] {
  return files.flatMap((file) =>
    file.status === 'done' && file.attachment && file.attachment.processingStatus !== 'failed'
      ? [file.attachment.id]
      : [],
  );
}

const nameList = (names: readonly string[]) => names.join(', ');

/** Nội dung hộp cảnh báo theo tổ hợp video chưa xong; ghép đoạn "đang xử lý" rồi đoạn "đang tải lên". */
export function buildVideoWarning(unfinished: UnfinishedVideos, target: PublishTarget): VideoWarning {
  const isPost = target === 'post';
  const verb = isPost ? 'đăng' : 'gửi';
  const paragraphs: string[] = [];
  const { processing, uploading } = unfinished;

  if (processing.length > 0) {
    const subject =
      processing.length === 1
        ? 'Video đang được xử lý.'
        : `${processing.length} video đang được xử lý (${nameList(processing.map((item) => item.fileName))}).`;
    paragraphs.push(
      `${subject} Bạn vẫn có thể ${verb} ngay: mọi người sẽ thấy khung "Đang xử lý" và video tự hiện khi xong, thường chỉ sau vài phút.`,
    );
  }
  if (uploading.length > 0) {
    const what = isPost ? 'bài viết sẽ được đăng' : 'bình luận sẽ được gửi';
    if (uploading.length === 1) {
      paragraphs.push(
        `Video đang tải lên (${uploading[0].percent}%). Nếu ${verb} ngay, ${what} không kèm video này.`,
      );
    } else {
      const list = uploading.map((item) => `${item.fileName} (${item.percent}%)`).join(', ');
      paragraphs.push(`Các video đang tải lên: ${list}. Nếu ${verb} ngay, ${what} không kèm các video này.`);
    }
  }

  return {
    title: VIDEO_WARNING_TITLE,
    paragraphs,
    confirmLabel: isPost ? 'Vẫn đăng' : 'Vẫn gửi',
    cancelLabel: VIDEO_WARNING_CANCEL_LABEL,
  };
}

/** Bấm đăng mà còn video chưa xong thì phải hỏi người dùng trước. */
export const needsVideoConfirmation = (files: readonly PublishGateFile[]): boolean =>
  hasUnfinishedVideos(collectUnfinishedVideos(files));
