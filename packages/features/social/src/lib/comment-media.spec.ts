import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_COMMENT_VIDEO_MAX_BYTES,
} from '@enterprise-platform/contracts-social';
import { COMMENT_IMAGE_INPUT_MAX_BYTES, exceedsCommentImageLimit, validateCommentMedia } from './comment-media';

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

  it('từ chối tệp không phải ảnh hay video, kể cả PDF, MOV và AVI', () => {
    expect(validateCommentMedia(file({ name: 'a.pdf', type: 'application/pdf' }), none)).toContain('không phải ảnh');
    expect(validateCommentMedia(file({ name: 'a.mov', type: 'video/quicktime' }), none)).toContain('không phải ảnh');
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
