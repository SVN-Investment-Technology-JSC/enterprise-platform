import type { SocialActivityType } from '@enterprise-platform/contracts-social';

/** Token DI của store bài tự sinh (BE-3). */
export const SOCIAL_ACTIVITY_STORE = Symbol('SOCIAL_ACTIVITY_STORE');

export interface ActivityPostInsert {
  readonly id: string;
  readonly authorId: string;
  readonly type: SocialActivityType;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Múi giờ để tính "một ngày". */
  readonly timeZone: string;
  /** Tên tác giả, đưa vào sự kiện `social.post.published` (chỉ để realtime; không tạo thông báo). */
  readonly authorName: string;
}

export interface SocialActivityStore {
  /**
   * Tạo bài tự sinh `kind='activity'` đã `published`, không nhóm, nội dung rỗng, trừ khi người này đã có
   * bài cùng loại trong ngày (theo `timeZone`). Ghi sự kiện outbox `social.post.published` trong cùng
   * transaction. Trả `true` nếu đã tạo, `false` nếu bị giới hạn một bài mỗi loại mỗi người mỗi ngày.
   */
  insertDaily(tenantId: string, input: ActivityPostInsert): Promise<boolean>;
}
