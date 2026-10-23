import { SOCIAL_COMMENT_IMAGE_MAX_BYTES, SOCIAL_COMMENT_MAX_ATTACHMENTS } from '@enterprise-platform/contracts-social';
import { COMMENT_IMAGE_INPUT_MAX_BYTES, exceedsCommentImageLimit, validateCommentImage } from './comment-image';

const image = (overrides: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'anh.png',
  type: 'image/png',
  size: 1000,
  ...overrides,
});

describe('validateCommentImage', () => {
  it('nhận ảnh JPEG, PNG, GIF, WebP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(validateCommentImage(image({ type }), 0)).toBeUndefined();
    }
  });

  it('từ chối tệp không phải ảnh, kể cả video và PDF', () => {
    expect(validateCommentImage(image({ name: 'a.pdf', type: 'application/pdf' }), 0)).toContain('không phải ảnh');
    expect(validateCommentImage(image({ name: 'a.mp4', type: 'video/mp4' }), 0)).toContain('không phải ảnh');
  });

  it('từ chối khi đã đủ số ảnh tối đa', () => {
    expect(validateCommentImage(image(), SOCIAL_COMMENT_MAX_ATTACHMENTS - 1)).toBeUndefined();
    expect(validateCommentImage(image(), SOCIAL_COMMENT_MAX_ATTACHMENTS)).toContain('tối đa');
  });

  it('từ chối ảnh gốc quá lớn trước khi nén', () => {
    expect(validateCommentImage(image({ size: COMMENT_IMAGE_INPUT_MAX_BYTES }), 0)).toBeUndefined();
    expect(validateCommentImage(image({ size: COMMENT_IMAGE_INPUT_MAX_BYTES + 1 }), 0)).toContain('quá lớn');
  });
});

describe('exceedsCommentImageLimit', () => {
  it('so với mức tối đa 10 MB của bình luận', () => {
    expect(exceedsCommentImageLimit(SOCIAL_COMMENT_IMAGE_MAX_BYTES)).toBe(false);
    expect(exceedsCommentImageLimit(SOCIAL_COMMENT_IMAGE_MAX_BYTES + 1)).toBe(true);
  });
});
