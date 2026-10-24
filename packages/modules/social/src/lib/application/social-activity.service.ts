import { randomUUID } from 'node:crypto';
import { SOCIAL_ACTIVITY_SOURCE_EVENTS, type SocialActivityType } from '@enterprise-platform/contracts-social';
import { SOCIAL_COMPANY_TIME_ZONE } from '../domain/social-birthday-rules.js';
import { isUuid } from '../domain/social-rules.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActivityStore } from './social-activity-store.port.js';

/** Sự kiện của phân hệ khác mà Mạng nội bộ nghe; dùng làm `bindings` của hàng đợi. */
export const SOCIAL_ACTIVITY_EVENT_TYPES: readonly string[] = [SOCIAL_ACTIVITY_SOURCE_EVENTS.avatarUpdated];

/** Loại bài tự sinh ứng với từng sự kiện nguồn. */
const ACTIVITY_OF_EVENT: Readonly<Record<string, SocialActivityType>> = {
  [SOCIAL_ACTIVITY_SOURCE_EVENTS.avatarUpdated]: 'avatar.updated',
};

/**
 * Sinh bài tự sinh (`kind='activity'`) từ sự kiện của phân hệ khác. Tác giả là chính người trong sự
 * kiện, không nhóm, không thông báo; mỗi loại mỗi người một bài mỗi ngày (xem
 * `SocialActivityStore.insertDaily`). Handler chịu được nhận trùng và bỏ qua sự kiện sai hoặc không
 * biết thay vì ném lỗi, để không đẩy sự kiện vô nghĩa vào hàng đợi lỗi.
 */
export class SocialActivityService {
  constructor(
    private readonly store: SocialActivityStore,
    private readonly directory: OrganizationDirectory,
    private readonly timeZone: string = SOCIAL_COMPANY_TIME_ZONE,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Trả `true` nếu đã tạo bài. */
  async handleEvent(tenantId: string, type: string, payload: unknown): Promise<boolean> {
    const activity = ACTIVITY_OF_EVENT[type];
    if (!activity) return false;
    const userId = userIdOf(payload);
    if (!userId) return false;

    // Người đã nghỉ việc (không còn trong danh bạ) thì không đăng bài tự sinh.
    const author = (await this.directory.resolve(tenantId, [userId])).get(userId.toLowerCase());
    if (!author) return false;

    return this.store.insertDaily(tenantId, {
      id: this.newId(),
      authorId: author.id,
      type: activity,
      payload: {},
      timeZone: this.timeZone,
      authorName: author.name,
    });
  }
}

function userIdOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const userId = (payload as { userId?: unknown }).userId;
  return isUuid(userId) ? userId : undefined;
}
