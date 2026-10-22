import type { SocialGroupPrivacy, SocialPostStatus, SocialPostVisibility } from '@enterprise-platform/contracts-social';
import type { SocialActor } from '../social-actor.js';

/**
 * Luật nhìn thấy bài (P2). Nguồn sự thật duy nhất; mọi truy vấn trả bài về cho người dùng phải
 * tuân theo: bảng tin, bài của nhóm, trang cá nhân, tìm kiếm, đã lưu, chi tiết bài, bình luận,
 * phản ứng, bình chọn, xác nhận đã đọc.
 *
 * Luật:
 * 1. Bài `deleted`: không ai thấy.
 * 2. Bài thuộc nhóm: nhóm đã xoá thì không ai thấy; nhóm `public` ai cũng thấy; nhóm `private`
 *    chỉ thành viên và "quản trị toàn hệ thống" (quản trị tenant hoặc `social.manage`) thấy.
 * 3. Bài `published`: qua luật 2 là thấy.
 * 4. Bài `pending`, `scheduled`, `rejected`: chỉ tác giả và moderator
 *    (`social.post.moderate` hoặc quản trị tenant) thấy, và vẫn phải qua luật 2. Đợt 2: moderator
 *    chỉ thấy bài chưa đăng có quyền xem `company` (bài hẹn giờ `private|unit|custom` chỉ tác giả thấy).
 * 5. (Đợt 2) Bài Tường công ty `published` theo `visibility`: `company` ai cũng thấy; `unit` người có
 *    `authorUnitId` trong `scope.unitIds`; `custom` người trong `audienceUserIds` hoặc có nút trong
 *    `audienceUnitIds` thuộc `scope.unitIds`; `private` chỉ tác giả. Tác giả luôn thấy bài của mình.
 *    Moderator và quản trị tenant KHÔNG được ưu tiên ở luật này. Bài nhóm bỏ qua luật 5.
 *
 * Phần SQL tương ứng: `infrastructure/post-visibility-sql.ts`. Hàm thuần dưới đây và SQL phải
 * cho cùng kết quả (có spec kèm theo).
 */
export const POST_VISIBILITY = Symbol('SOCIAL_POST_VISIBILITY');

/** Những gì luật cần biết về một người xem; tính một lần cho mỗi request. */
export interface PostVisibilityScope {
  readonly viewerId: string;
  /** Quản trị tenant hoặc `social.manage`: thấy mọi nhóm kể cả riêng tư. */
  readonly seesAllGroups: boolean;
  /** `social.post.moderate` hoặc quản trị tenant: thấy bài `pending/scheduled/rejected` của người khác. */
  readonly canModerate: boolean;
  /** Nhóm chưa xoá mà người xem là thành viên. */
  readonly memberGroupIds: readonly string[];
  /**
   * Đợt 2: `ViewerScope.unitIds` của người xem (nút tổ chức gồm cả tổ tiên). Thiếu hoặc rỗng nghĩa là
   * người xem không thuộc phòng ban nào đã biết. `scopeFor` PHẢI điền (BE-V); optional để mã đợt 1
   * và spec cũ vẫn biên dịch.
   */
  readonly unitIds?: readonly string[];
}

/** Phần của một bài mà luật cần. */
export interface PostVisibilitySubject {
  readonly authorId: string;
  readonly status: SocialPostStatus;
  readonly groupId?: string;
  readonly groupPrivacy?: SocialGroupPrivacy;
  readonly groupDeleted?: boolean;
  /** Đợt 2. Thiếu là `company`. */
  readonly visibility?: SocialPostVisibility;
  /** Đợt 2. Phòng ban của tác giả (khi `visibility = 'unit'`). */
  readonly authorUnitId?: string;
  /** Đợt 2. Danh sách chia sẻ khi `visibility = 'custom'` (đã nạp từ `post_audience`). */
  readonly audienceUserIds?: readonly string[];
  readonly audienceUnitIds?: readonly string[];
}

export interface PostVisibilityPort {
  /**
   * Dựng `PostVisibilityScope` cho người gọi: `memberGroupIds` qua `GroupMembershipPort`, `unitIds` qua
   * `ViewerScopePort` (đợt 2). Hiện thực đợt 1 do BE-2 viết; đợt 2 BE-V sửa để điền `unitIds`.
   */
  scopeFor(actor: SocialActor): Promise<PostVisibilityScope>;

  /** Tiện lợi: dựng scope rồi áp `canViewPostInScope`. */
  canView(actor: SocialActor, subject: PostVisibilitySubject): Promise<boolean>;
}

/** Luật nhìn thấy bài dạng hàm thuần, để service, SQL và spec đối chiếu nhau. */
export function canViewPostInScope(scope: PostVisibilityScope, post: PostVisibilitySubject): boolean {
  if (post.status === 'deleted') return false;
  if (post.groupId !== undefined) {
    if (post.groupDeleted) return false;
    const member = scope.memberGroupIds.includes(post.groupId);
    if (post.groupPrivacy === 'private' && !member && !scope.seesAllGroups) return false;
  }
  if (post.authorId === scope.viewerId) return true;
  const visibility = post.visibility ?? 'company';
  // Bài nhóm theo nhóm; quyền xem riêng chỉ có ở Tường công ty (CHECK ở DB bảo đảm bài nhóm là 'company').
  const restricted = post.groupId === undefined && visibility !== 'company';
  if (post.status === 'published') return !restricted || matchesVisibility(scope, post, visibility);
  // Chưa đăng: moderator chỉ thấy bài công khai (hàng đợi duyệt); bài giới hạn quyền xem chỉ tác giả thấy.
  return scope.canModerate && !restricted;
}

function matchesVisibility(
  scope: PostVisibilityScope,
  post: PostVisibilitySubject,
  visibility: SocialPostVisibility,
): boolean {
  const unitIds = scope.unitIds ?? [];
  switch (visibility) {
    case 'unit':
      return post.authorUnitId !== undefined && unitIds.includes(post.authorUnitId);
    case 'custom':
      return (
        (post.audienceUserIds?.includes(scope.viewerId) ?? false) ||
        (post.audienceUnitIds?.some((unitId) => unitIds.includes(unitId)) ?? false)
      );
    case 'private':
      return false;
    case 'company':
      return true;
  }
}
