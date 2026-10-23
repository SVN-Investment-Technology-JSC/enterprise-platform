import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_COMMENT_VIDEO_MAX_BYTES,
} from '@enterprise-platform/contracts-social';
import {
  COMMENT_IMAGE_INPUT_MAX_BYTES,
  exceedsCommentImageLimit,
  probeVideo,
  validateCommentMedia,
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

  it('từ chối tệp không phải ảnh hay video, kể cả PDF, MOV (báo riêng) và AVI', () => {
    expect(validateCommentMedia(file({ name: 'a.pdf', type: 'application/pdf' }), none)).toContain('không phải ảnh');
    expect(validateCommentMedia(file({ name: 'a.mov', type: 'video/quicktime' }), none)).toContain('MOV chưa được hỗ trợ');
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
  it('nhận video MP4 và WebM', () => {
    expect(validateCommentMedia(video(), none)).toBeUndefined();
    expect(validateCommentMedia(video({ name: 'clip.webm', type: 'video/webm' }), none)).toBeUndefined();
  });

  it('từ chối video lớn hơn 50 MB', () => {
    expect(validateCommentMedia(video({ size: SOCIAL_COMMENT_VIDEO_MAX_BYTES }), none)).toBeUndefined();
    expect(validateCommentMedia(video({ size: SOCIAL_COMMENT_VIDEO_MAX_BYTES + 1 }), none)).toContain('quá lớn');
  });

  it('từ chối video thứ hai trong một bình luận', () => {
    expect(validateCommentMedia(video(), { count: 1, videos: 1 })).toContain('tối đa 1 video');
  });

  it('vẫn cho thêm ảnh khi đã có video', () => {
    expect(validateCommentMedia(file(), { count: 1, videos: 1 })).toBeUndefined();
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
