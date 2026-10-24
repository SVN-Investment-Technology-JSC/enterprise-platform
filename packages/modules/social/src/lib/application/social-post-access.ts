import { mayManage, mayModerate } from '../domain/social-principal.js';
import { requireUuid } from '../domain/social-rules.js';
import { SocialPostStateError } from '../domain/social-publishing.error.js';
import { SocialPostNotFoundError } from '../domain/social.error.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPublishingStore, WritablePostRow } from './social-publishing-store.port.js';

/**
 * Cửa vào chung của mọi thao tác trên một bài: tìm bài ở mọi trạng thái, áp luật nhìn thấy
 * (`PostVisibilityPort`, nguồn sự thật `post-visibility.port.ts`) và tính các quyền theo vai trò.
 * Bài không thấy được trả `POST_NOT_FOUND` để không lộ sự tồn tại.
 */
export class SocialPostAccess {
  constructor(
    private readonly store: Pick<SocialPublishingStore, 'findForWrite'>,
    private readonly visibility: PostVisibilityPort,
    private readonly groups: GroupMembershipPort,
  ) {}

  /** Bài ở trạng thái bất kỳ (trừ đã xoá) mà người gọi thấy. */
  async requireVisible(actor: SocialActor, postId: string): Promise<WritablePostRow> {
    requireUuid(postId, 'Mã bài viết');
    const row = await this.store.findForWrite(actor.tenantId, postId);
    if (!row || !(await this.visibility.canView(actor, row))) throw new SocialPostNotFoundError();
    return row;
  }

  /** Bài đã đăng mà người gọi thấy; bài chưa đăng thì 409 `POST_STATE` (phản ứng, bình luận, bình chọn... chỉ cho bài đã đăng). */
  async requirePublished(actor: SocialActor, postId: string): Promise<WritablePostRow> {
    const row = await this.requireVisible(actor, postId);
    if (row.status !== 'published') {
      throw new SocialPostStateError('Bài viết chưa được đăng nên chưa thể tương tác.');
    }
    return row;
  }

  /** Admin của nhóm, hoặc quản trị toàn hệ thống (quản trị tenant, `social.manage`). Bài Tường công ty: `false`. */
  async isGroupAdmin(actor: SocialActor, row: Pick<ExtendedPostRow, 'groupId'>): Promise<boolean> {
    if (!row.groupId) return false;
    if (mayManage(actor)) return true;
    return this.groups.isAdmin(actor.tenantId, row.groupId, actor.userId);
  }

  /**
   * Xoá bài: tác giả; moderator (Tường công ty hoặc nhóm công khai); admin nhóm. Moderator không
   * vì thế mà xoá được bài trong nhóm riêng tư.
   */
  async mayDelete(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    if (row.authorId.toLowerCase() === actor.userId.toLowerCase()) return true;
    if (await this.isGroupAdmin(actor, row)) return true;
    return mayModerate(actor) && row.groupPrivacy !== 'private';
  }

  /** Ghim: moderator với bài Tường công ty, admin nhóm với bài nhóm. */
  async mayPin(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    return row.groupId ? this.isGroupAdmin(actor, row) : mayModerate(actor);
  }
  /**
   * Bật/tắt bình luận (đợt 2): tác giả, moderator, admin nhóm. Bài tự sinh không có nút này. Moderator
   * chỉ tới được bài công khai (luật nhìn thấy đã loại bài hẹp), nên không cần kiểm lại ở đây.
   */
  async mayToggleComments(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    if (row.activityType) return false;
    if (row.authorId.toLowerCase() === actor.userId.toLowerCase()) return true;
    return mayModerate(actor) || (await this.isGroupAdmin(actor, row));
  }

  /** Đổi chủ đề của nhóm cho bài (đợt 2): tác giả, admin nhóm. */
  async mayChangeGroupTopic(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    if (!row.groupId || row.activityType) return false;
    return row.authorId.toLowerCase() === actor.userId.toLowerCase() || (await this.isGroupAdmin(actor, row));
  }

  /**
   * Xem lịch sử sửa (đợt 2): tác giả; moderator với bài Tường công ty; admin nhóm với bài nhóm. Moderator
   * không xem được lịch sử bài nhóm nếu không phải admin nhóm.
   */
  async mayViewHistory(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    if (row.authorId.toLowerCase() === actor.userId.toLowerCase()) return true;
    if (row.groupId) return this.isGroupAdmin(actor, row);
    return mayModerate(actor);
  }

  /** Xem danh sách xác nhận đã đọc: tác giả, moderator, admin nhóm. */
  async mayViewReadConfirmations(actor: SocialActor, row: ExtendedPostRow): Promise<boolean> {
    if (row.authorId.toLowerCase() === actor.userId.toLowerCase()) return true;
    if (row.groupId) return (await this.isGroupAdmin(actor, row)) || mayModerate(actor);
    return mayModerate(actor);
  }
}
