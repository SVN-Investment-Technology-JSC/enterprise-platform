import type { SocialPost, SocialReactionSummary } from '@enterprise-platform/contracts-social';
import { applyReactionSummary } from './post-reaction';

const post = {
  id: 'p1',
  bodyHtml: '<p>x</p>',
  reactionCounts: { like: 1 },
  reactionTotal: 1,
  myReaction: 'like',
} as unknown as SocialPost;

describe('applyReactionSummary', () => {
  it('thả phản ứng: cập nhật số đếm và phản ứng của tôi', () => {
    const next = applyReactionSummary(
      { ...post, reactionCounts: {}, reactionTotal: 0, myReaction: undefined },
      { reactionCounts: { love: 1 }, reactionTotal: 1, myReaction: 'love' } as SocialReactionSummary,
    );
    expect(next).toMatchObject({ reactionCounts: { love: 1 }, reactionTotal: 1, myReaction: 'love' });
  });

  it('bỏ phản ứng: tóm tắt không có myReaction thì phản ứng của tôi phải bị xoá, không giữ giá trị cũ', () => {
    const next = applyReactionSummary(post, { reactionCounts: {}, reactionTotal: 0 });
    expect(next.myReaction).toBeUndefined();
    expect(next.reactionTotal).toBe(0);
    expect(next.reactionCounts).toEqual({});
  });

  it('đổi loại phản ứng: lấy loại mới', () => {
    const next = applyReactionSummary(post, { reactionCounts: { celebrate: 1 }, reactionTotal: 1, myReaction: 'celebrate' });
    expect(next.myReaction).toBe('celebrate');
  });

  it('không đổi các trường khác của bài', () => {
    const next = applyReactionSummary(post, { reactionCounts: {}, reactionTotal: 0 });
    expect(next.id).toBe('p1');
    expect(next.bodyHtml).toBe('<p>x</p>');
  });
});
