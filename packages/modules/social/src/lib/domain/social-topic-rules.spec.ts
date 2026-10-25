import { SOCIAL_POST_TOPICS_MAX } from '@enterprise-platform/contracts-social';
import { randomUUID } from 'node:crypto';
import { SocialValidationError } from './social.error.js';
import { normalizeTopicIds } from './social-rules.js';

describe('normalizeTopicIds', () => {
  const [a, b] = [randomUUID(), randomUUID()];

  it('khong nhac toi chuyen muc thi tra undefined (giu nguyen khi sua bai)', () => {
    expect(normalizeTopicIds(undefined, undefined)).toBeUndefined();
  });

  it('mang topicIds duoc uu tien, bo trung va giu thu tu', () => {
    expect(normalizeTopicIds([b, a, b], a)).toEqual([b, a]);
    expect(normalizeTopicIds([], a)).toEqual([]);
  });

  it('topicId don (cach cu): null hoac rong la bo het', () => {
    expect(normalizeTopicIds(undefined, a)).toEqual([a]);
    expect(normalizeTopicIds(undefined, null)).toEqual([]);
    expect(normalizeTopicIds(undefined, '')).toEqual([]);
  });

  it('tu choi ma khong hop le va qua so luong toi da', () => {
    expect(() => normalizeTopicIds(['khong-phai-uuid'], undefined)).toThrow(SocialValidationError);
    expect(() => normalizeTopicIds('a', undefined)).toThrow(SocialValidationError);
    const many = Array.from({ length: SOCIAL_POST_TOPICS_MAX + 1 }, () => randomUUID());
    expect(() => normalizeTopicIds(many, undefined)).toThrow(SocialValidationError);
    expect(normalizeTopicIds(many.slice(0, SOCIAL_POST_TOPICS_MAX), undefined)).toHaveLength(SOCIAL_POST_TOPICS_MAX);
  });
});
