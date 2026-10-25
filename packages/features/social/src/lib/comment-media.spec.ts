import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_MAX_ATTACHMENTS_PER_POST,
  SOCIAL_VIDEO_LIMITS,
} from '@enterprise-platform/contracts-social';
import {
  COMMENT_IMAGE_INPUT_MAX_BYTES,
  exceedsCommentImageLimit,
  isCommentVideo,
  probeVideo,
  resolveVideoContentType,
  validateCommentMedia,
  validateVideoDuration,
  withVideoContentType,
  VIDEO_UNREADABLE_REASON,
} from './comment-media';

const file = (overrides: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'anh.png',
  type: 'image/png',
  size: 1000,
  ...overrides,
});
const video = (overrides: Partial<{ name: string; type: string; size: number }> = {}) =>
  file({ name: 'clip.mp4', type: 'video/mp4', ...overrides });
const none = { count: 0, videos: 0 };

describe('validateCommentMedia (ảnh)', () => {
  it('nhận ảnh JPEG, PNG, GIF, WebP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(validateCommentMedia(file({ type }), none)).toBeUndefined();
    }
  });

  it('từ chối tệp không phải ảnh hay video, kể cả PDF và AVI', () => {
    expect(validateCommentMedia(file({ name: 'a.pdf', type: 'application/pdf' }), none)).toContain('không phải ảnh');
    expect(validateCommentMedia(file({ name: 'a.avi', type: 'video/x-msvideo' }), none)).toContain('không phải ảnh');
  });

  it('từ chối khi đã đủ số tệp tối đa', () => {
    expect(validateCommentMedia(file(), { count: SOCIAL_COMMENT_MAX_ATTACHMENTS - 1, videos: 0 })).toBeUndefined();
    expect(validateCommentMedia(file(), { count: SOCIAL_COMMENT_MAX_ATTACHMENTS, videos: 0 })).toContain('tối đa');
  });

  it('từ chối ảnh gốc quá lớn trước khi nén', () => {
    expect(validateCommentMedia(file({ size: COMMENT_IMAGE_INPUT_MAX_BYTES }), none)).toBeUndefined();
    expect(validateCommentMedia(file({ size: COMMENT_IMAGE_INPUT_MAX_BYTES + 1 }), none)).toContain('quá lớn');
  });
});

describe('validateCommentMedia (video)', () => {
  const comment = SOCIAL_VIDEO_LIMITS.comment;
  const post = SOCIAL_VIDEO_LIMITS.post;

  it('nhận video MP4, WebM và MOV', () => {
    expect(validateCommentMedia(video(), none)).toBeUndefined();
    expect(validateCommentMedia(video({ name: 'clip.webm', type: 'video/webm' }), none)).toBeUndefined();
    expect(validateCommentMedia(video({ name: 'clip.mov', type: 'video/quicktime' }), none)).toBeUndefined();
  });

  it('nhận .mov khi trình duyệt để trống type (suy từ đuôi tệp)', () => {
    expect(validateCommentMedia(video({ name: 'IMG_0001.MOV', type: '' }), none)).toBeUndefined();
    expect(validateCommentMedia(file({ name: 'a.avi', type: '' }), none)).toContain('không phải ảnh');
  });

  it('dung lượng tối đa theo nơi gắn: bình luận 300 MB, bài viết 1 GB', () => {
    expect(validateCommentMedia(video({ size: comment.maxBytes }), none)).toBeUndefined();
    expect(validateCommentMedia(video({ size: comment.maxBytes + 1 }), none)).toContain('tối đa 300 MB');
    expect(validateCommentMedia(video({ size: post.maxBytes }), none, 'post')).toBeUndefined();
    expect(validateCommentMedia(video({ size: post.maxBytes + 1 }), none, 'post')).toContain('tối đa 1 GB');
  });

  it('bình luận chỉ 1 video', () => {
    expect(validateCommentMedia(video(), { count: 1, videos: 1 })).toContain('tối đa 1 video');
  });

  it('bài viết tối đa 3 video', () => {
    expect(validateCommentMedia(video(), { count: 2, videos: 2, images: 0 }, 'post')).toBeUndefined();
    expect(validateCommentMedia(video(), { count: 3, videos: 3, images: 0 }, 'post')).toContain('tối đa 3 video');
  });

  it('bài viết cho trộn ảnh với video, theo cả hai chiều', () => {
    expect(validateCommentMedia(video(), { count: 1, videos: 0, images: 1 }, 'post')).toBeUndefined();
    expect(validateCommentMedia(file(), { count: 1, videos: 1, images: 0 }, 'post')).toBeUndefined();
  });

  it('bài viết trộn ảnh và video vẫn chặn video thứ 4 và tệp thứ 11', () => {
    expect(validateCommentMedia(video(), { count: 5, videos: 3, images: 2 }, 'post')).toContain('tối đa 3 video');
    expect(validateCommentMedia(file(), { count: 10, videos: 3, images: 7 }, 'post')).toContain('tối đa 10 tệp');
  });

  it('bình luận vẫn cho thêm ảnh khi đã có video', () => {
    expect(validateCommentMedia(file(), { count: 1, videos: 1 })).toBeUndefined();
  });

  it('bài viết đủ số tệp thì từ chối', () => {
    expect(validateCommentMedia(video(), { count: SOCIAL_MAX_ATTACHMENTS_PER_POST, videos: 0, images: 0 }, 'post')).toContain('tối đa');
  });
});

describe('resolveVideoContentType / withVideoContentType', () => {
  it('ưu tiên type hợp lệ, chỉ suy từ đuôi khi type trống', () => {
    expect(resolveVideoContentType({ name: 'a.mov', type: 'video/quicktime' })).toBe('video/quicktime');
    expect(resolveVideoContentType({ name: 'a.mov', type: '' })).toBe('video/quicktime');
    expect(resolveVideoContentType({ name: 'a.mp4', type: 'application/octet-stream' })).toBeUndefined();
    expect(isCommentVideo({ name: 'a.pdf', type: '' })).toBe(false);
  });

  it('gắn type cho tệp .mov không có type, giữ nguyên tệp đã có type', () => {
    const bare = new File(['x'], 'a.mov', { type: '' });
    expect(withVideoContentType(bare).type).toBe('video/quicktime');
    const typed = new File(['x'], 'a.mp4', { type: 'video/mp4' });
    expect(withVideoContentType(typed)).toBe(typed);
  });
});

describe('validateVideoDuration', () => {
  const ok = (durationSeconds: number) => ({ ok: true as const, durationSeconds, width: 1280, height: 720 });

  it('theo thời lượng tối đa của từng nơi gắn', () => {
    expect(validateVideoDuration(ok(SOCIAL_VIDEO_LIMITS.comment.maxSeconds), 'a.mp4', 'comment')).toBeUndefined();
    expect(validateVideoDuration(ok(SOCIAL_VIDEO_LIMITS.comment.maxSeconds + 1), 'a.mp4', 'comment')).toContain('3 phút');
    expect(validateVideoDuration(ok(SOCIAL_VIDEO_LIMITS.post.maxSeconds), 'a.mp4', 'post')).toBeUndefined();
    expect(validateVideoDuration(ok(SOCIAL_VIDEO_LIMITS.post.maxSeconds + 1), 'a.mp4', 'post')).toContain('10 phút');
  });

  it('không đọc được (HEVC) thì không chặn để server quyết định', () => {
    expect(validateVideoDuration({ ok: false, reason: VIDEO_UNREADABLE_REASON }, 'a.mov', 'comment')).toBeUndefined();
  });

  it('thời lượng vô hạn hoặc không xác định thì không chặn', () => {
    expect(validateVideoDuration(ok(Infinity), 'a.mp4')).toBeUndefined();
    expect(validateVideoDuration(ok(NaN), 'a.mp4')).toBeUndefined();
  });
});

describe('exceedsCommentImageLimit', () => {
  it('so với mức tối đa 10 MB của bình luận', () => {
    expect(exceedsCommentImageLimit(SOCIAL_COMMENT_IMAGE_MAX_BYTES)).toBe(false);
    expect(exceedsCommentImageLimit(SOCIAL_COMMENT_IMAGE_MAX_BYTES + 1)).toBe(true);
  });
});

describe('probeVideo', () => {
  interface FakeVideo {
    onloadedmetadata: (() => void) | null;
    onerror: (() => void) | null;
    preload: string;
    muted: boolean;
    duration: number;
    videoWidth: number;
    videoHeight: number;
    src: string;
    removeAttribute: () => void;
    load: () => void;
  }
  const fake = (onSrc: (video: FakeVideo) => void, size = { w: 1280, h: 720 }): FakeVideo => {
    const video: FakeVideo = {
      onloadedmetadata: null,
      onerror: null,
      preload: '',
      muted: false,
      duration: 12.5,
      videoWidth: size.w,
      videoHeight: size.h,
      removeAttribute: () => undefined,
      load: () => undefined,
      set src(_value: string) {
        onSrc(video);
      },
    } as unknown as FakeVideo;
    return video;
  };
  const blob = new Blob(['x'], { type: 'video/mp4' });

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    URL.revokeObjectURL = jest.fn();
  });

  it('đọc được metadata thì trả thời lượng và kích thước', async () => {
    const result = await probeVideo(blob, () => fake((v) => queueMicrotask(() => v.onloadedmetadata?.())) as unknown as HTMLVideoElement);
    expect(result).toEqual({ ok: true, durationSeconds: 12.5, width: 1280, height: 720 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('metadata không có khung hình (codec không giải mã được) thì báo không đọc được', async () => {
    const result = await probeVideo(
      blob,
      () => fake((v) => queueMicrotask(() => v.onloadedmetadata?.()), { w: 0, h: 0 }) as unknown as HTMLVideoElement,
    );
    expect(result).toEqual({ ok: false, reason: VIDEO_UNREADABLE_REASON });
  });

  it('lỗi từ trình duyệt thì báo không đọc được', async () => {
    const result = await probeVideo(blob, () => fake((v) => queueMicrotask(() => v.onerror?.())) as unknown as HTMLVideoElement);
    expect(result).toEqual({ ok: false, reason: VIDEO_UNREADABLE_REASON });
  });

  it('quá hạn thì báo không đọc được', async () => {
    const result = await probeVideo(blob, () => fake(() => undefined) as unknown as HTMLVideoElement, 10);
    expect(result).toEqual({ ok: false, reason: VIDEO_UNREADABLE_REASON });
  });
});
