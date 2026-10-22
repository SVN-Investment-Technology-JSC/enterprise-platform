import { isExemptScheduled, statusOnPublish } from '../domain/social-publishing-rules.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { SocialSettingsPort } from './ports/social-settings.port.js';
import { postPendingEvent, type PublishedEventBuilder } from './social-publishing-events.js';
import type { DueDecision, SocialPublishingStore } from './social-publishing-store.port.js';

/** Số bài đến hạn xử lý tối đa trong một lần quét của một tenant. */
export const SOCIAL_SCHEDULER_BATCH = 50;

export interface SocialSchedulerDeps {
  readonly store: SocialPublishingStore;
  readonly groups: Pick<GroupMembershipPort, 'getGroup' | 'isMember'>;
  readonly settings: SocialSettingsPort;
  readonly events: PublishedEventBuilder;
}

export interface SocialSchedulerResult {
  /** Bài đã đăng (phát `social.post.published`, origin `scheduled`). */
  readonly published: number;
  /** Bài Tường công ty cần duyệt: vào `pending` (phát `social.post.pending`). */
  readonly pending: number;
  /** Bài không còn đăng được (nhóm đã xoá, tác giả đã rời nhóm): xoá mềm. */
  readonly discarded: number;
  /** Bài lỗi khi xử lý: để nguyên `scheduled`, lần quét sau thử lại. */
  readonly failures: readonly { readonly postId: string; readonly message: string }[];
}

/**
 * Quét bài `scheduled` đến hạn của một tenant và đăng chúng.
 *
 * Worker gọi `publishDueScheduled(tenantId)` định kỳ (mỗi phút) cho từng tenant đã bật phân hệ
 * social. Nhiều worker chạy song song vẫn an toàn: mỗi bài được khoá `FOR UPDATE SKIP LOCKED`
 * trên chỉ mục `idx_social_posts_due` và chỉ chuyển trạng thái một lần.
 */
export class SocialSchedulerService {
  constructor(private readonly deps: SocialSchedulerDeps) {}

  async publishDueScheduled(
    tenantId: string,
    options: { readonly now?: Date; readonly limit?: number } = {},
  ): Promise<SocialSchedulerResult> {
    const { store, groups, settings, events } = this.deps;
    const now = (options.now ?? new Date()).toISOString();
    const limit = Math.max(1, Math.min(options.limit ?? SOCIAL_SCHEDULER_BATCH, 500));

    let requireApproval: boolean | undefined;
    const approvalRequired = async (): Promise<boolean> => {
      requireApproval ??= (await settings.get(tenantId)).wallRequireApproval;
      return requireApproval;
    };

    let published = 0;
    let pending = 0;
    let discarded = 0;
    const failures: { postId: string; message: string }[] = [];
    const excluded: string[] = [];

    for (let handled = 0; handled < limit; handled += 1) {
      const current: { id?: string } = {};
      try {
        const done = await store.publishNextDue(tenantId, now, excluded, async (post): Promise<DueDecision> => {
          current.id = post.id;
          if (post.groupId) {
            const group = await groups.getGroup(tenantId, post.groupId);
            if (!group || group.deleted || !(await groups.isMember(tenantId, post.groupId, post.authorId))) {
              return { to: 'deleted', events: [] };
            }
          }
          // Chỉ bài công khai vào hàng chờ duyệt; bài quyền hẹp không ai ngoài đối tượng thấy.
          const isOpenWall = !post.groupId && (post.visibility ?? 'company') === 'company';
          const needsApproval = isOpenWall && !isExemptScheduled(post) && (await approvalRequired());
          const to = statusOnPublish({
            isWall: !post.groupId,
            requireApproval: needsApproval,
            exempt: false,
          });
          if (to === 'published') {
            return { to, events: await events.build(tenantId, post, 'scheduled') };
          }
          return { to, events: [postPendingEvent(post, await events.authorName(tenantId, post.authorId))] };
        });
        if (!done) break;
        if (done.outcome === 'published') published += 1;
        else if (done.outcome === 'pending') pending += 1;
        else discarded += 1;
      } catch (error) {
        const failedId = current.id;
        if (!failedId) throw error;
        excluded.push(failedId);
        failures.push({ postId: failedId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { published, pending, discarded, failures };
  }
}
