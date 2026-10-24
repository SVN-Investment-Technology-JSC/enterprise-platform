import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_IMAGE_CONTENT_TYPES,
  SOCIAL_MAX_ATTACHMENTS_PER_POST,
  SOCIAL_VIDEO_CONTENT_TYPES,
  SOCIAL_VIDEO_LIMITS,
  type SocialAttachmentPurpose,
} from '@enterprise-platform/contracts-social';

/** Ảnh gốc lớn hơn mức này bị từ chối ngay, không cố nén (tránh giải mã ảnh quá nặng trên trình duyệt). */
export const COMMENT_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** Cạnh dài tối đa sau khi thu nhỏ. */
const MAX_EDGE = 1600;
/** Ảnh nhỏ hơn mức này giữ nguyên, nén cũng không đáng kể. */
const SKIP_BELOW_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.82;

const VIDEO_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * Loại nội dung của video: lấy từ `type`; một số trình duyệt để trống `type` cho .mov nên suy từ đuôi tệp.
 * Trả `undefined` khi không phải video được phép.
 */
export function resolveVideoContentType(file: { readonly name?: string; readonly type: string }): string | undefined {
  if (SOCIAL_VIDEO_CONTENT_TYPES.includes(file.type)) return file.type;
  if (file.type) return undefined;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  return extension ? VIDEO_TYPE_BY_EXTENSION[extension] : undefined;
}

/** Tệp có phải video được phép đính kèm (MP4, WebM, MOV) hay không. */
export function isCommentVideo(file: { readonly name?: string; readonly type: string }): boolean {
  return resolveVideoContentType(file) !== undefined;
}

/**
 * Bảo đảm video có `type` đúng trước khi tải lên (lệnh PUT ký sẵn gắn theo loại này). Không sao chép dữ liệu:
 * `File` mới chỉ tham chiếu tệp gốc.
 */
export function withVideoContentType(file: File): File {
  const type = resolveVideoContentType(file);
  if (!type || file.type === type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

/** Bài viết không đi chung ảnh và video (tài liệu thì được). */
export const POST_HAS_IMAGES_MESSAGE = 'Bài viết đã có ảnh nên không thêm video được. Hãy đăng ảnh và video thành các bài riêng.';
export const POST_HAS_VIDEOS_MESSAGE = 'Bài viết đã có video nên không thêm ảnh được. Hãy đăng ảnh và video thành các bài riêng.';

const MB = 1024 * 1024;
const formatLimitBytes = (bytes: number) =>
  bytes >= 1024 * MB ? `${Math.floor(bytes / (1024 * MB))} GB` : `${Math.floor(bytes / MB)} MB`;
const formatLimitSeconds = (seconds: number) =>
  seconds % 60 === 0 && seconds >= 60 ? `${seconds / 60} phút` : `${seconds} giây`;

/** Số tệp đã có trong ô soạn; `images` chỉ cần khi kiểm cho bài viết (không trộn ảnh và video). */
export interface CommentMediaCount {
  readonly count: number;
  readonly videos: number;
  readonly images?: number;
}

/**
 * Kiểm một ảnh hoặc video định đính kèm; trả thông báo lỗi tiếng Việt hoặc `undefined` khi hợp lệ.
 * Video không nén nên chỉ kiểm loại, dung lượng và số lượng theo `SOCIAL_VIDEO_LIMITS[purpose]`; thời lượng
 * kiểm riêng bằng `validateVideoDuration` sau khi đọc thử. Với bài viết ('post'), ảnh và video không đi chung một bài.
 */
export function validateCommentMedia(
  file: { readonly name: string; readonly type: string; readonly size: number },
  current: CommentMediaCount,
  purpose: SocialAttachmentPurpose = 'comment',
): string | undefined {
  const isPost = purpose === 'post';
  const noun = isPost ? 'bài viết' : 'bình luận';
  const maxCount = isPost ? SOCIAL_MAX_ATTACHMENTS_PER_POST : SOCIAL_COMMENT_MAX_ATTACHMENTS;
  if (current.count >= maxCount) {
    return `Mỗi ${noun} đính kèm tối đa ${maxCount} tệp.`;
  }
  if (isCommentVideo(file)) {
    const limits = SOCIAL_VIDEO_LIMITS[purpose];
    if (isPost && (current.images ?? 0) > 0) {
      return POST_HAS_IMAGES_MESSAGE;
    }
    if (current.videos >= limits.maxVideos) {
      return `Mỗi ${noun} chỉ đính kèm tối đa ${limits.maxVideos} video.`;
    }
    if (file.size <= 0) return `Video "${file.name}" không có nội dung.`;
    if (file.size > limits.maxBytes) {
      return `Video "${file.name}" quá lớn (tối đa ${formatLimitBytes(limits.maxBytes)}).`;
    }
    return undefined;
  }
  if (!SOCIAL_IMAGE_CONTENT_TYPES.includes(file.type)) {
    return `"${file.name}" không phải ảnh JPEG, PNG, GIF, WebP hoặc video MP4, WebM, MOV.`;
  }
  if (isPost && current.videos > 0) {
    return POST_HAS_VIDEOS_MESSAGE;
  }
  if (file.size > COMMENT_IMAGE_INPUT_MAX_BYTES) {
    return `Ảnh "${file.name}" quá lớn (tối đa ${Math.floor(COMMENT_IMAGE_INPUT_MAX_BYTES / MB)} MB).`;
  }
  return undefined;
}

/**
 * Kiểm thời lượng theo kết quả đọc thử. Trình duyệt không đọc được (HEVC, MOV...) thì KHÔNG chặn: để server
 * chuyển mã và quyết định. Thời lượng không hữu hạn (luồng trực tiếp) cũng bỏ qua.
 */
export function validateVideoDuration(
  probe: VideoProbeResult,
  fileName: string,
  purpose: SocialAttachmentPurpose = 'comment',
): string | undefined {
  if (!probe.ok || !Number.isFinite(probe.durationSeconds)) return undefined;
  const { maxSeconds } = SOCIAL_VIDEO_LIMITS[purpose];
  if (probe.durationSeconds > maxSeconds) {
    return `Video "${fileName}" quá dài (tối đa ${formatLimitSeconds(maxSeconds)}).`;
  }
  return undefined;
}

/** Sau khi nén, ảnh còn vượt mức của bình luận thì không tải được. */
export function exceedsCommentImageLimit(sizeBytes: number): boolean {
  return sizeBytes > SOCIAL_COMMENT_IMAGE_MAX_BYTES;
}

/**
 * Thu nhỏ (cạnh dài ≤ 1600px) và đổi sang WebP trước khi tải lên: thường giảm 5–10 lần dung lượng lưu trữ.
 * GIF giữ nguyên để không mất ảnh động; ảnh nhỏ hoặc không nén được nhỏ hơn thì giữ bản gốc; lỗi giải mã
 * (trình duyệt cũ) cũng giữ bản gốc.
 */
export async function prepareCommentImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.size <= SKIP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export type VideoProbeResult =
  | { readonly ok: true; readonly durationSeconds: number; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string };

export const VIDEO_UNREADABLE_REASON =
  'Trình duyệt không đọc được video này (thường là H.265/HEVC); máy chủ sẽ tự chuyển mã sau khi tải lên.';
const VIDEO_PROBE_TIMEOUT_MS = 8000;

/**
 * Kiểm trình duyệt có đọc được video không (codec, vùng chứa) trước khi tải lên: nạp metadata bằng thẻ
 * `<video>` ẩn, tối đa 8 giây. `createVideo` tiêm được để test.
 */
export function probeVideo(
  file: Blob,
  createVideo: () => HTMLVideoElement = () => document.createElement('video'),
  timeoutMs = VIDEO_PROBE_TIMEOUT_MS,
): Promise<VideoProbeResult> {
  return new Promise<VideoProbeResult>((resolve) => {
    let video: HTMLVideoElement;
    let url: string;
    try {
      video = createVideo();
      url = URL.createObjectURL(file);
    } catch {
      resolve({ ok: false, reason: VIDEO_UNREADABLE_REASON });
      return;
    }
    const finish = (result: VideoProbeResult) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load?.();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { ok: true, durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight }
          : { ok: false, reason: VIDEO_UNREADABLE_REASON },
      );
    video.onerror = () => finish({ ok: false, reason: VIDEO_UNREADABLE_REASON });
    const timer = setTimeout(() => finish({ ok: false, reason: VIDEO_UNREADABLE_REASON }), timeoutMs);
    video.src = url;
  });
}
